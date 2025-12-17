// comparison.js

// ----------- Configuration: Paths to data files ------------
const GEOJSON_URL = "data/CanadaProvincesCartoBoundary_EPSG4326.geojson";
const DATA_URL = "data/CanadianAnti-FraudCentreReportingData-EN-CA-only.json";

// ----------- Global Variables ------------
let geojson, fraudData;
let perProvYearMetrics = {};  // { year: { province: { cases: ..., loss: ... } } }
let allProvinces = [];        // Sorted list of provinces for dropdowns
let selectedYear = 2021;
let showAllYears = false;


// ----------- Data Loading ------------
Promise.all([
    d3.json(GEOJSON_URL),
    d3.json(DATA_URL)
])
.then(([gjson, data]) => {
    geojson = gjson;
    fraudData = data;
    preprocessData();
    populateProvinceSelectors();
    initYearControls();
    drawMaps();  // Initial draw
})
.catch(err => {
    console.error("Error loading data:", err);
});

// ----------- Preprocess the fraud data ------------
function preprocessData() {
  fraudData.forEach(d => {
    const prov = d.region;
    const year = d.year;
    if (!prov || prov === "Not Specified") return;

    if (!perProvYearMetrics[year]) perProvYearMetrics[year] = {};
    if (!perProvYearMetrics[year][prov]) perProvYearMetrics[year][prov] = { cases: 0, loss: 0 };

    perProvYearMetrics[year][prov].cases += 1;
    perProvYearMetrics[year][prov].loss += d.dollarLoss;
  });

  // Extract list of provinces from GeoJSON (used for dropdowns and to ensure completeness)
  const provSet = new Set();
  geojson.features.forEach(f => {
    const name = f.properties["PRENAME"] || f.properties["name"] || f.properties["NAME"] || f.properties["province"];
    if (name) provSet.add(name);
  });

  allProvinces = Array.from(provSet).sort();
}

// ----------- Populate dropdowns for province selection ------------
function populateProvinceSelectors() {
  const sel1 = d3.select("#provinceSelect1");
  const sel2 = d3.select("#provinceSelect2");

  allProvinces.forEach(prov => {
    sel1.append("option").attr("value", prov).text(prov);
    sel2.append("option").attr("value", prov).text(prov);
  });

  // Default provinces
  sel1.property("value", "Ontario");
  sel2.property("value", "Quebec");

  // Add event listeners
  sel1.on("change", drawMaps);
  sel2.on("change", drawMaps);
  d3.selectAll("input[name=metricRadio]").on("change", drawMaps);
}


// ----------- Create year controls ------------
function initYearControls() {
  const slider = d3.select("#yearSlider");
  const label = d3.select("#yearLabel");
  const btn = d3.select("#allYearsBtn");

  const defaultYear = 2021;

  // ---- Initial state on page load ----
  selectedYear = defaultYear;
  showAllYears = false;

  slider.property("value", defaultYear);
  slider.property("disabled", false);
  label.text(defaultYear);
  btn.classed("active", false);

  // ---- Slider interaction ----
  slider.on("input", function () {
    selectedYear = +this.value;
    showAllYears = false;

    label.text(selectedYear);
    btn.classed("active", false);
    slider.property("disabled", false);

    drawMaps();
    drawProvinceCharts();
  });

  // ---- All-years toggle button ----
  btn.on("click", function () {
    if (showAllYears) {
      // 🔄 TURN OFF all-years → reset to 2021
      showAllYears = false;
      selectedYear = defaultYear;

      slider.property("value", defaultYear);
      slider.property("disabled", false);
      label.text(defaultYear);
      btn.classed("active", false);
    } else {
      // 🔘 TURN ON all-years
      showAllYears = true;

      const maxYear = +slider.attr("max");
      slider.property("value", maxYear);
      slider.property("disabled", true);
      label.text("All Years");
      btn.classed("active", true);
    }

    drawMaps();
    drawProvinceCharts();
  });
}





// ----------- Main draw function (rebuilds both maps) ------------
function drawMaps() {
  const prov1 = d3.select("#provinceSelect1").property("value");
  const prov2 = d3.select("#provinceSelect2").property("value");
  const metric = d3.select("input[name=metricRadio]:checked").property("value");

  // Update metric toggle button styles
  d3.selectAll(".btn-outline-primary")
    .classed("metric-cases", false)
    .classed("metric-loss", false);

  // Apply correct class to active one
  const activeMetric = d3.select("input[name=metricRadio]:checked").attr("id");
  const activeLabel = d3.select(`label[for=${activeMetric}]`);
  activeLabel.classed("metric-cases", metric === "cases");
  activeLabel.classed("metric-loss", metric === "loss");


  // Process years available in data
  let metrics = {};

  if (showAllYears) {
    // Aggregate across all years
    Object.values(perProvYearMetrics).forEach(yearObj => {
      Object.entries(yearObj).forEach(([prov, vals]) => {
        if (!metrics[prov]) metrics[prov] = { cases: 0, loss: 0 };
        metrics[prov].cases += vals.cases;
        metrics[prov].loss += vals.loss;
      });
    });
  } else {
  metrics = perProvYearMetrics[selectedYear] || {};
  }


  // Create value mapping: province → value (cases/loss)
  const valueByProv = {};
  allProvinces.forEach(prov => {
    const rec = metrics[prov];
    valueByProv[prov] = rec ? rec[metric] : 0;
  });

  // Color scale based on max metric value
  const maxVal = d3.max(Object.values(valueByProv));
  const color = d3.scaleSequential()
    .domain([0, maxVal])
    .interpolator(metric === "cases" ? d3.interpolateGreens : d3.interpolatePurples);

  // Draw both maps
  drawMap("#map1", "#legend1", [prov1, prov2], metric, valueByProv, color);

  // Update summaries
  updateSummary("#summary1", prov1, metric, valueByProv[prov1], prov2, valueByProv[prov2]);

  // Draw charts for selected provinces
  drawProvinceCharts();

}

// ----------- Render a single province map ------------
function drawMap(svgSelector, legendSelector, highlightProvs, metric, valueByProv, colorScale) {
  const svg = d3.select(svgSelector);
  const container = svg.node().parentNode;
  const width = container.clientWidth;
  const height = container.clientHeight;
  // const height = 150; // fixed height for each map frame

  svg.selectAll("*").remove(); // Clear previous render
  svg.attr("width", width).attr("height", height);

  // Map projection: centered with north up
  // const projection = d3.geoConicConformal()
  //   .center([-115, 43])
  //   .rotate([45, 35, 30]) // no tilt so north is up
  //   .scale(width * 1)
  //   .translate([width / 2, height / 2]);
  const projection = d3.geoTransverseMercator()
    .rotate([96, 0])
    .fitSize([width, height], geojson);

  const path = d3.geoPath().projection(projection);

  // Tooltip
  d3.select(container).selectAll(".province-tooltip").remove();
  const tooltip = d3.select(container)
    .append("div")
    .attr("class", "province-tooltip");

  // Draw each province
  svg.selectAll("path")
    .data(geojson.features)
    .enter()
    .append("path")
    .attr("d", path)
    .attr("fill", d => {
      const name =
        d.properties["PRENAME"] ||
        d.properties["NAME"] ||
        d.properties["name"] ||
        d.properties["province"];
      return colorScale(valueByProv[name] || 0);
    })
    .attr("stroke", d => {
      const name =
        d.properties["PRENAME"] ||
        d.properties["NAME"] ||
        d.properties["name"] ||
        d.properties["province"];
      return highlightProvs.includes(name) ? "#ea63ffff" : "rgba(0, 0, 0, 0.1)"; //Highlight and boarderline color
    })
    .attr("stroke-width", d => {
      const name =
        d.properties["PRENAME"] ||
        d.properties["NAME"] ||
        d.properties["name"] ||
        d.properties["province"];
      highlightProvs.includes(name) ? 2 : 0.5;
    })
    .on("mouseover", (event, d) => {
      const name = d.properties["PRENAME"] || d.properties["NAME"] || d.properties["province"];
      const val = valueByProv[name] || 0;

      tooltip.style("visibility", "visible")
        .html(`<strong>${name}</strong><br>${metric === "cases" ? "Total Cases this Year" : "Total Amount Lost this Year"}: ${
          metric === "cases" ? val : "$" + val.toLocaleString()
        }`)
        .style("left", (event.offsetX + 12) + "px")
        .style("top", (event.offsetY + 12) + "px");
    })
    .on("mousemove", event => {
      tooltip.style("left", (event.offsetX + 12) + "px")
             .style("top", (event.offsetY + 12) + "px");
    })
    .on("mouseout", () => tooltip.style("visibility", "hidden"));

  // Draw legend INSIDE the map frame
  buildLegend(legendSelector, metric, colorScale);
}

// ----------- Build dynamic color legend ------------
function buildLegend(selector, metric, colorScale) {
  const legendContainer = d3.select(selector);
  legendContainer.selectAll("*").remove();

  // --- Toggle button ---
  const button = legendContainer.append("button")
    .attr("class", "legend-toggle-btn")
    .text("Legend");

  // --- Legend content wrapper (hidden by default) ---
  const legendBox = legendContainer.append("div")
    .attr("class", "legend-inner-box")
    .style("display", "none");

  // Create a wrapper div to hold button + year label
  const headerRow = legendContainer.append("div")
    .style("display", "flex")
    .style("justify-content", "space-between")
    .style("align-items", "center")
    .style("gap", "8px");

  // Add year label
  const yearLabel = headerRow.append("div")
    .attr("class", "legend-year-label")
    .text(showAllYears ? "All Years" : selectedYear);

  // Move button into this row
  headerRow.node().appendChild(button.node());

  // Toggle behavior
  let isOpen = false;

  button.on("click", () => {
    isOpen = !isOpen;
    legendBox.style("display", isOpen ? "block" : "none");
    button.style("display", isOpen ? "none" : "block");
  });

  // Clicking legend closes it
  legendBox.on("click", () => {
    isOpen = false;
    legendBox.style("display", "none");
    button.style("display", "block");
  });

  // --- Build legend content ---
  const steps = 6;
  const domainMin = colorScale.domain()[0];
  const domainMax = colorScale.domain()[1];
  const stepSize = (domainMax - domainMin) / steps;

  const legendRanges = d3.range(steps).map(i => {
    const from = domainMin + i * stepSize;
    const to = i === steps - 1 ? domainMax : from + stepSize;
    return { from, to, color: colorScale(to) };
  });

  legendBox.append("div")
    .attr("class", `legend-title metric-${metric}`)
    .text(metric === "cases" ? "Number of Cases" : "Total Loss ($)");



  const row = legendBox.append("div")
    .attr("class", "legend-row");

  row.selectAll(".legend-item")
    .data(legendRanges)
    .enter()
    .append("div")
    .attr("class", "legend-item")
    .html(d => {
      const label = metric === "cases"
        ? `${Math.round(d.from)}–${Math.round(d.to)}`
        : `$${Math.round(d.from).toLocaleString()}–$${Math.round(d.to).toLocaleString()}`;

      return `
        <span class="legend-color-box" style="background:${d.color}"></span>
        ${label}
      `;
    });
}




// ----------- Update the summary stats below each map ------------
function updateSummary(summarySelector, prov1, metric, val1, prov2, val2) {
  const label = metric === "cases" ? "Cases" : "Loss";
  const format = v => metric === "cases" ? v : "$" + v.toLocaleString();

  const html = `
    <div>${prov1}: <strong>${format(val1)}</strong></div>
    <div>${prov2}: <strong>${format(val2)}</strong></div>
  `;
  d3.select(summarySelector).html(html);
}


// ---------------- Generate charts for each province ----------------
function drawProvinceCharts() {
  const prov1 = d3.select("#provinceSelect1").property("value");
  const prov2 = d3.select("#provinceSelect2").property("value");

  drawChartsForProvince(prov1, 1);
  drawChartsForProvince(prov2, 2);
}

function drawChartsForProvince(province, index) {
    const dataForProv = fraudData.filter(d =>
      d.region === province &&
      (showAllYears || d.year === selectedYear)
    );


    // Prepare dataset aggregations
    const categoryCounts = groupRare(countByField(dataForProv, "category"));
    const methodCounts   = groupRare(countByField(dataForProv, "method"));
    const ageCounts      = countByField(dataForProv, "ageRange");

    // Month counts → Top 3 months
    const monthCounts = d3.rollup(
        dataForProv,
        v => v.length,
        d => d3.timeFormat("%B")(new Date(d.date))
    );

    const topMonths = Array.from(monthCounts, ([key, val]) => ({ key, val }))
        .sort((a, b) => d3.ascending(b.val, a.val))
        .slice(0, 3);

    d3.select(`#charts-title${index}`).text(`Charts for ${province}`);

    // Draw pie charts
    buildPieChart(`#catChart${index}`, categoryCounts, "Fraud / Cybercrime Categories");
    buildPieChart(`#methodChart${index}`, methodCounts, "Solicitation Method");
    buildPieChart(`#ageChart${index}`, ageCounts, "Victim Age Range");
    buildTopMonths(`#monthChart${index}`, topMonths);
}

// ----------- Utility: count occurrences of a string field ------------
function countByField(data, field) {
  const map = d3.rollup(
    data,
    v => ({
      count: v.length,
      loss: d3.sum(v, d => d.dollarLoss || 0)
    }),
    d => d[field] || "Not Available"
  );

  return Array.from(map, ([key, val]) => ({
    key,
    val: val.count,
    loss: val.loss
  }));
}


// ----------- Group items contributing < 2.5% of the total into the "Others" catigory ------------
function groupRare(arr) {
  const total = d3.sum(arr, d => d.val);
  const cutoff = total * 0.025;   // 2.5% threshold

  const major = arr.filter(d => d.val >= cutoff);
  const minor = arr.filter(d => d.val < cutoff);

  const minorTotal = d3.sum(minor, d => d.val);

  if (minorTotal > 0) {
    major.push({ key: "Others", val: minorTotal });
  }

  return major;
}


// ---------------- Pie Chart Generator ----------------
function buildPieChart(containerSelector, data, title) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();
  if (!data || data.length === 0) return;

  const containerWidth = container.node().clientWidth;
  const size = Math.min(containerWidth, 240);
  const radius = size / 3.5 - 8;
  const tooltip = container.append("div")
  .attr("class", "province-tooltip")
  .style("position", "absolute")
  .style("visibility", "hidden");


  // ---------- STEP 1: Measure longest label ----------
  const tempSvg = container.append("svg").attr("visibility", "hidden");
  const tempText = tempSvg.append("text").style("font-size", "10px");

  const longestLabelWidth = d3.max(data, d => {
    tempText.text(d.key);
    return tempText.node().getComputedTextLength();
  });

  tempSvg.remove();

  // ---------- STEP 2: Dynamic margin ----------
  // const margin = Math.max(30, longestLabelWidth * 0.6);
  const margin = longestLabelWidth + 10;

  // Title
  container.append("div")
    .attr("class", "chart-title")
    .text(title);

  // ---------- SVG with padded viewBox ----------
  const svg = container.append("svg")
    .attr(
      "viewBox",
      `${-size / 2 - margin} ${-size / 2 - margin} ${size + margin * 2} ${size + margin * 2}`
    )
    .attr("preserveAspectRatio", "xMidYMid meet")
    .classed("responsive-svg", true);

  const g = svg.append("g");

  const pie = d3.pie()
    .sort(null)
    .value(d => d.val);

  const arcs = pie(data);

  const color = d3.scaleOrdinal()
    .domain(data.map(d => d.key))
    .range(d3.schemeSet2);

  const arc = d3.arc()
    .innerRadius(0)
    .outerRadius(radius);

  const labelArc = d3.arc()
    .innerRadius(radius * 1.3)
    .outerRadius(radius * 1.3);

  // ---------- Draw slices ----------
  g.selectAll("path")
    .data(arcs)
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", d => color(d.data.key))
    .attr("stroke", "#fff")
    .attr("stroke-width", 1)
    .on("mouseover", (event, d) => {
      const totalCases = d3.sum(data, d => d.val);
      const percent = ((d.data.val / totalCases) * 100).toFixed(1);
      const formattedLoss = "$" + d.data.loss.toLocaleString(undefined, { minimumFractionDigits: 2 });

      tooltip
        .style("visibility", "visible")
        .html(`
          <strong>${d.data.key}</strong><br>
          ${d.data.val} cases (${percent}%)<br>
          Total loss: ${formattedLoss}
        `);
    })
    .on("mousemove", event => {
      const [mouseX, mouseY] = d3.pointer(event, container.node());

      tooltip
        .style("top", (mouseY + 10) + "px")
        .style("left", (mouseX + 10) + "px");
    })
    .on("mouseout", () => {
      tooltip.style("visibility", "hidden");
    });

  // ---------- STEP 3: Filter tiny slices ----------
  const minAngle = 0.12;
  const visibleArcs = arcs.filter(d => d.endAngle - d.startAngle > minAngle);

  // ---------- STEP 4: Detect vertical crowding ----------
  const labelPositions = {};

  visibleArcs.forEach(d => {
    const [x, y] = labelArc.centroid(d);
    const side = x > 0 ? "right" : "left";
    if (!labelPositions[side]) labelPositions[side] = [];
    labelPositions[side].push({ d, y });
  });

  Object.values(labelPositions).forEach(group => {
    group.sort((a, b) => a.y - b.y);
    group.forEach((item, i) => {
      item.dy = i * 10; // was 12 → more space for larger text
    });
  });


  // ---------- Leader lines ----------
  g.selectAll("polyline")
    .data(visibleArcs)
    .enter()
    .append("polyline")
    .attr("points", d => {
      const [x, y] = labelArc.centroid(d);
      const side = x > 0 ? "right" : "left";
      const dy =
        labelPositions[side]?.find(p => p.d === d)?.dy || 0;

      const posA = arc.centroid(d);
      const posB = [x, y + dy];
      const posC = [x + (side === "right" ? 10 : -10), y + dy];

      return [posA, posB, posC];
    })
    .attr("fill", "none")
    .attr("stroke", "#ccc")
    .attr("stroke-width", 1);

  // ---------- Labels ----------
  g.selectAll("text.pie-label")
    .data(visibleArcs)
    .enter()
    .append("text")
    .attr("class", "pie-label")
    .attr("transform", d => {
      const [x, y] = labelArc.centroid(d);
      const side = x > 0 ? "right" : "left";
      const dy =
        labelPositions[side]?.find(p => p.d === d)?.dy || 0;

      return `translate(${x + (side === "right" ? 20 : -20)}, ${y + dy})`;
      // ⬆️ was 14 → extra room for bigger font
    })
    .attr("text-anchor", d =>
      labelArc.centroid(d)[0] > 0 ? "start" : "end"
    )
    .style("fill", "#fff")
    .text(d => d.data.key);

}



// ---------------- Top 3 Months Renderer ----------------
function buildTopMonths(containerSelector, data) {
  const container = d3.select(containerSelector);
  container.selectAll("*").remove();

  container.append("div")
    .attr("class", "chart-title")
    .text("Top Months Reported");

  const wrapper = container.append("div")
    .attr("class", "top-months responsive-months");

  const monthBox = wrapper.selectAll(".month-box")
    .data(data)
    .enter()
    .append("div")
    .attr("class", "month-box");

  monthBox.append("div")
    .attr("class", "month-name")
    .text(d => d.key);

  monthBox.append("div")
  .attr("class", `month-value ${showAllYears || d3.select("#metricCases").property("checked") ? "cases" : "loss"}`)
  .text(d => d.val);
}


// --- Redraw charts responsively on resize / zoom ---
window.addEventListener("resize", () => {
  drawProvinceCharts();
});