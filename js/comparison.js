// -------------------------------------------------------------------
// 1) CONFIGURATION: PATHS TO DATA FILES
// -------------------------------------------------------------------
const GEOJSON_URL = "data/CanadaProvincesCartoBoundary_EPSG4326.geojson";
const DATA_URL = "data/CanadianAnti-FraudCentreReportingData-EN-CA-only.json";


// -------------------------------------------------------------------
// 2) GLOBAL STATE
// -------------------------------------------------------------------
let geojson, fraudData;
let perProvYearMetrics = {};  // { year: { province: { cases: ..., loss: ... } } }
let allProvinces = [];        // Sorted list of provinces for dropdowns
let selectedYear = 2021;
let showAllYears = false;


// -------------------------------------------------------------------
// 3) DATA LOADING
// -------------------------------------------------------------------
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


// -------------------------------------------------------------------
// 4) PREPROCESS FRAUD DATA
// -------------------------------------------------------------------
function preprocessData() {
  fraudData.forEach(d => {
    const prov = d.region;
    const year = d.year;
    if (!prov || prov === "Not Specified") return;

    if (!perProvYearMetrics[year]) perProvYearMetrics[year] = {};
    if (!perProvYearMetrics[year][prov]) {
      perProvYearMetrics[year][prov] = { cases: 0, loss: 0 };
    }

    perProvYearMetrics[year][prov].cases += 1;
    perProvYearMetrics[year][prov].loss += d.dollarLoss;
  });

  // Extract list of provinces from GeoJSON (for dropdowns and completeness)
  const provSet = new Set();
  geojson.features.forEach(f => {
    const name =
      f.properties["PRENAME"] ||
      f.properties["name"] ||
      f.properties["NAME"] ||
      f.properties["province"];
    if (name) provSet.add(name);
  });

  allProvinces = Array.from(provSet).sort();
}


// -------------------------------------------------------------------
// 5) POPULATE PROVINCE SELECTORS
// -------------------------------------------------------------------
function populateProvinceSelectors() {
  const sel1 = d3.select("#provinceSelect1");
  const sel2 = d3.select("#provinceSelect2");

  allProvinces.forEach(prov => {
    sel1.append("option").attr("value", prov).text(prov);
    sel2.append("option").attr("value", prov).text(prov);
  });

  // Defaults
  sel1.property("value", "Ontario");
  sel2.property("value", "Quebec");

  // Event listeners
  sel1.on("change", drawMaps);
  sel2.on("change", drawMaps);
  d3.selectAll("input[name=metricRadio]").on("change", drawMaps);
}


// -------------------------------------------------------------------
// 6) YEAR CONTROLS (SLIDER + ALL-YEARS TOGGLE)
// -------------------------------------------------------------------
function initYearControls() {
  const slider = d3.select("#yearSlider");
  const label = d3.select("#yearLabel");
  const btn = d3.select("#allYearsBtn");

  const defaultYear = 2021;

  // Initial state
  selectedYear = defaultYear;
  showAllYears = false;

  slider.property("value", defaultYear);
  slider.property("disabled", false);
  label.text(defaultYear);
  btn.classed("active", false);

  // Slider interaction
  slider.on("input", function () {
    selectedYear = +this.value;
    showAllYears = false;

    label.text(selectedYear);
    btn.classed("active", false);
    slider.property("disabled", false);

    drawMaps();
    drawProvinceCharts();
  });

  // All-years toggle button
  btn.on("click", function () {
    if (showAllYears) {
      // Turn OFF all-years → reset to default year
      showAllYears = false;
      selectedYear = defaultYear;

      slider.property("value", defaultYear);
      slider.property("disabled", false);
      label.text(defaultYear);
      btn.classed("active", false);
    } else {
      // Turn ON all-years
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


// -------------------------------------------------------------------
// 7) MAIN DRAW: BOTH MAPS + SUMMARY + PROVINCE CHARTS
// -------------------------------------------------------------------
function drawMaps() {
  const prov1 = d3.select("#provinceSelect1").property("value");
  const prov2 = d3.select("#provinceSelect2").property("value");
  const metric = d3.select("input[name=metricRadio]:checked").property("value");

  // Update metric toggle button styles
  d3.selectAll(".btn-outline-primary")
    .classed("metric-cases", false)
    .classed("metric-loss", false);

  const activeMetric = d3.select("input[name=metricRadio]:checked").attr("id");
  const activeLabel = d3.select(`label[for=${activeMetric}]`);
  activeLabel.classed("metric-cases", metric === "cases");
  activeLabel.classed("metric-loss", metric === "loss");

  // Build per-province metrics for selected year or all years
  let metrics = {};

  if (showAllYears) {
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

  // Province → value (cases / loss)
  const valueByProv = {};
  allProvinces.forEach(prov => {
    const rec = metrics[prov];
    valueByProv[prov] = rec ? rec[metric] : 0;
  });

  const maxVal = d3.max(Object.values(valueByProv));
  const color = d3.scaleSequential()
    .domain([0, maxVal])
    .interpolator(metric === "cases" ? d3.interpolateGreens : d3.interpolatePurples);

  // Draw maps
  drawMap("#map1", "#legend1", [prov1, prov2], metric, valueByProv, color);

  // Summary
  updateSummary("#summary1", prov1, metric, valueByProv[prov1], prov2, valueByProv[prov2]);

  // Charts
  drawProvinceCharts();
}


// -------------------------------------------------------------------
// 8) RENDER A SINGLE MAP
// -------------------------------------------------------------------
function drawMap(svgSelector, legendSelector, highlightProvs, metric, valueByProv, colorScale) {
  const svg = d3.select(svgSelector);
  const container = svg.node().parentNode;
  const width = container.clientWidth;
  const height = container.clientHeight;

  svg.selectAll("*").remove();
  svg.attr("width", width).attr("height", height);

  const projection = d3.geoTransverseMercator()
    .rotate([96, 0])
    .fitSize([width, height], geojson);

  const path = d3.geoPath().projection(projection);

  // Tooltip inside map container
  d3.select(container).selectAll(".province-tooltip").remove();
  const tooltip = d3.select(container)
    .append("div")
    .attr("class", "province-tooltip");

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
      return highlightProvs.includes(name) ? "#ea63ffff" : "rgba(0, 0, 0, 0.1)";
    })
    .attr("stroke-width", d => {
      const name =
        d.properties["PRENAME"] ||
        d.properties["NAME"] ||
        d.properties["name"] ||
        d.properties["province"];
      return highlightProvs.includes(name) ? 2 : 0.5;
    })
    .on("mouseover", (event, d) => {
      const name =
        d.properties["PRENAME"] ||
        d.properties["NAME"] ||
        d.properties["province"];
      const val = valueByProv[name] || 0;

      tooltip.style("visibility", "visible")
        .html(
          `<strong>${name}</strong><br>` +
          `${metric === "cases"
            ? "Total Cases this Year: " + val
            : "Total Amount Lost this Year: $" + val.toLocaleString()}`
        )
        .style("left", (event.offsetX + 12) + "px")
        .style("top", (event.offsetY + 12) + "px");
    })
    .on("mousemove", event => {
      tooltip
        .style("left", (event.offsetX + 12) + "px")
        .style("top", (event.offsetY + 12) + "px");
    })
    .on("mouseout", () => tooltip.style("visibility", "hidden"));

  // Legend
  buildLegend(legendSelector, metric, colorScale);
}


// -------------------------------------------------------------------
// 9) LEGEND (INSIDE EACH MAP FRAME)
// -------------------------------------------------------------------
function buildLegend(selector, metric, colorScale) {
  const legendContainer = d3.select(selector);
  legendContainer.selectAll("*").remove();

  // Toggle button
  const button = legendContainer.append("button")
    .attr("class", "legend-toggle-btn")
    .text("Legend");

  // Inner legend box (hidden by default)
  const legendBox = legendContainer.append("div")
    .attr("class", "legend-inner-box")
    .style("display", "none");

  // Header row (year label + button)
  const headerRow = legendContainer.append("div")
    .style("display", "flex")
    .style("justify-content", "space-between")
    .style("align-items", "center")
    .style("gap", "8px");

  const yearLabel = headerRow.append("div")
    .attr("class", "legend-year-label")
    .text(showAllYears ? "All Years" : selectedYear);

  headerRow.node().appendChild(button.node());

  // Toggle behavior
  let isOpen = false;

  button.on("click", () => {
    isOpen = !isOpen;
    legendBox.style("display", isOpen ? "block" : "none");
    button.style("display", isOpen ? "none" : "block");
  });

  legendBox.on("click", () => {
    isOpen = false;
    legendBox.style("display", "none");
    button.style("display", "block");
  });

  // Legend content
  const steps = 6;
  const [domainMin, domainMax] = colorScale.domain();
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


// -------------------------------------------------------------------
// 10) SUMMARY (BELOW MAP)
// -------------------------------------------------------------------
function updateSummary(summarySelector, prov1, metric, val1, prov2, val2) {
  const label = metric === "cases" ? "Cases" : "Loss";
  const format = v => metric === "cases" ? v : "$" + v.toLocaleString();

  const html = `
    <div>${prov1}: <strong>${format(val1)}</strong></div>
    <div>${prov2}: <strong>${format(val2)}</strong></div>
  `;
  d3.select(summarySelector).html(html);
}


// -------------------------------------------------------------------
// 11) PER-PROVINCE CHARTS (CATEGORY / METHOD / AGE / MONTHS)
// -------------------------------------------------------------------
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

  const categoryCounts = groupRare(countByField(dataForProv, "category"));
  const methodCounts   = groupRare(countByField(dataForProv, "method"));
  const ageCounts      = countByField(dataForProv, "ageRange");

  const monthCounts = d3.rollup(
    dataForProv,
    v => v.length,
    d => d3.timeFormat("%B")(new Date(d.date))
  );

  const topMonths = Array.from(monthCounts, ([key, val]) => ({ key, val }))
    .sort((a, b) => d3.ascending(b.val, a.val))
    .slice(0, 3);

  d3.select(`#charts-title${index}`).text(`Charts for ${province}`);

  buildPieChart(`#catChart${index}`,   categoryCounts, "Fraud / Cybercrime Categories");
  buildPieChart(`#methodChart${index}`, methodCounts,  "Solicitation Method");
  buildPieChart(`#ageChart${index}`,   ageCounts,      "Victim Age Range");
  buildTopMonths(`#monthChart${index}`, topMonths);
}


// -------------------------------------------------------------------
// 12) COUNT + GROUP HELPERS
// -------------------------------------------------------------------
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

// Group items < 2.5% into "Others"
function groupRare(arr) {
  const total = d3.sum(arr, d => d.val);
  const cutoff = total * 0.025;

  const major = arr.filter(d => d.val >= cutoff);
  const minor = arr.filter(d => d.val < cutoff);

  const minorTotal = d3.sum(minor, d => d.val);
  if (minorTotal > 0) major.push({ key: "Others", val: minorTotal });

  return major;
}


// -------------------------------------------------------------------
// 13) PIE CHART GENERATOR (CATEGORY / METHOD / AGE)
// -------------------------------------------------------------------
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

  // 1) Measure longest label
  const tempSvg = container.append("svg").attr("visibility", "hidden");
  const tempText = tempSvg.append("text").style("font-size", "10px");

  const longestLabelWidth = d3.max(data, d => {
    tempText.text(d.key);
    return tempText.node().getComputedTextLength();
  });

  tempSvg.remove();

  const xMargin = longestLabelWidth + 10;
  const yMargin = 10;

  // Title
  container.append("div")
    .attr("class", "chart-title")
    .text(title);

  // 2) SVG with padded viewBox
  const svg = container.append("svg")
    .attr(
      "viewBox",
      `${-size / 2 - xMargin} ${-size / 2 - yMargin} ${size + xMargin * 2} ${size + yMargin * 2}`
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

  // Slices
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

  // Filter tiny slices
  const minAngle = 0.12;
  const visibleArcs = arcs.filter(d => d.endAngle - d.startAngle > minAngle);

  // Detect vertical crowding
  const labelPositions = {};
  visibleArcs.forEach(d => {
    const [x, y] = labelArc.centroid(d);
    const side = x > 0 ? "right" : "left";
    if (!labelPositions[side]) labelPositions[side] = [];
    labelPositions[side].push({ d, y });
  });

  function relax(group) {
    group.sort((a, b) => a.y - b.y);
    group.forEach((item, i) => {
      item.dy = i * 10;
    });
  }

  Object.values(labelPositions).forEach(relax);
  const allGroups = Object.values(labelPositions).flat();

  // Leader lines
  g.selectAll("polyline")
    .data(visibleArcs)
    .enter()
    .append("polyline")
    .attr("fill", "none")
    .attr("stroke", "#ccc")
    .attr("stroke-width", 1)
    .attr("points", d => {
      const [x, y] = labelArc.centroid(d);
      const side = x > 0 ? "right" : "left";
      const match = allGroups.find(p => p.d === d);
      const dy = match ? match.dy : 0;

      const posA = arc.centroid(d);
      const posB = [x, y + dy];
      const posC = [x + (side === "right" ? 10 : -10), y + dy];

      return [posA, posB, posC];
    });

  // Labels
  g.selectAll("text.pie-label")
    .data(visibleArcs)
    .enter()
    .append("text")
    .attr("class", "pie-label")
    .attr("transform", d => {
      const [x, y] = labelArc.centroid(d);
      const side = x > 0 ? "right" : "left";
      const match = allGroups.find(p => p.d === d);
      const dy = match ? match.dy : 0;

      return `translate(${x + (side === "right" ? 20 : -20)}, ${y + dy})`;
    })
    .attr("text-anchor", d =>
      labelArc.centroid(d)[0] > 0 ? "start" : "end"
    )
    .style("fill", "#fff")
    .text(d => d.data.key);
}


// -------------------------------------------------------------------
// 14) TOP 3 MONTHS RENDERER
// -------------------------------------------------------------------
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
    .attr(
      "class",
      `month-value ${
        showAllYears || d3.select("#metricCases").property("checked") ? "cases" : "loss"
      }`
    )
    .text(d => d.val);
}


// -------------------------------------------------------------------
// 15) RESPONSIVE REDRAW ON RESIZE
// -------------------------------------------------------------------
window.addEventListener("resize", () => {
  drawProvinceCharts();
});
