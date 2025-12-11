// comparison.js

// ----------- Configuration: Paths to data files ------------
const GEOJSON_URL = "data/CanadaProvincesCartoBoundary_EPSG4326.geojson";
const DATA_URL = "data/CanadianAnti-FraudCentreReportingData-EN-CA-only.json";

// ----------- Global Variables ------------
let geojson, fraudData;
let perProvYearMetrics = {};  // { year: { province: { cases: ..., loss: ... } } }
let allProvinces = [];        // Sorted list of provinces for dropdowns

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

// ----------- Main draw function (rebuilds both maps) ------------
function drawMaps() {
  const prov1 = d3.select("#provinceSelect1").property("value");
  const prov2 = d3.select("#provinceSelect2").property("value");
  const metric = d3.select("input[name=metricRadio]:checked").property("value");

  // Get latest year available in data
  const latestYear = d3.max(Object.keys(perProvYearMetrics).map(Number));
  const metrics = perProvYearMetrics[latestYear] || {};

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
    .interpolator(d3.interpolateBlues);

  // Draw both maps
  drawMap("#map1", "#legend1", prov1, metric, valueByProv, color);
  drawMap("#map2", "#legend2", prov2, metric, valueByProv, color);

  // Update summaries
  updateSummary("#mapTitle1", "#summary1", prov1, metric, valueByProv[prov1]);
  updateSummary("#mapTitle2", "#summary2", prov2, metric, valueByProv[prov2]);

  // Draw charts for selected provinces
  drawProvinceCharts();

}

// ----------- Render a single province map ------------
// ----------- Render a single province map ------------
function drawMap(svgSelector, legendSelector, highlightProv, metric, valueByProv, colorScale) {
  const svg = d3.select(svgSelector);
  const container = svg.node().parentNode;
  const width = container.clientWidth;
  const height = 150; // fixed height for each map frame ✔️

  svg.selectAll("*").remove(); // Clear previous render
  svg.attr("width", width).attr("height", height);

  // Map projection: centered with north up
  const projection = d3.geoConicConformal()
    .center([-106, 65])
    .rotate([65, 15, 0]) // no tilt so north is up
    .scale(width * 0.95)
    .translate([width / 2, height / 2]);

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
      return name === highlightProv ? "#333" : "rgba(0,0,0,0.2)";
    })
    .attr("stroke-width", d => {
      const name =
        d.properties["PRENAME"] ||
        d.properties["NAME"] ||
        d.properties["name"] ||
        d.properties["province"];
      return name === highlightProv ? 2 : 0.5;
    })
    .on("mouseover", (event, d) => {
      const name = d.properties["PRENAME"] || d.properties["NAME"] || d.properties["province"];
      const val = valueByProv[name] || 0;

      tooltip.style("visibility", "visible")
        .html(`<strong>${name}</strong><br>${metric === "cases" ? "Cases" : "Loss"}: ${
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

  // Draw legend INSIDE the map frame ✔️
  buildLegend(legendSelector, metric, colorScale);
}

// ----------- Build dynamic color legend ------------
function buildLegend(selector, metric, colorScale) {
  const legend = d3.select(selector);
  legend.selectAll("*").remove();

  const steps = 6;
  const legendVals = d3.range(steps).map(i =>
    i / (steps - 1) * colorScale.domain()[1]
  );

  // Wrap content in a styled box
  const box = legend.append("div")
    .attr("class", "legend-inner-box");

  box.append("div")
    .attr("class", "legend-title")
    .text(metric === "cases" ? "Number of Cases" : "Loss ($)");

  const row = box.append("div").attr("class", "legend-row");

  row.selectAll(".legend-item")
    .data(legendVals)
    .enter()
    .append("div")
    .attr("class", "legend-item")
    .html(d => {
      const colorBox = `<span class="legend-color-box" style="background:${colorScale(d)}"></span>`;
      const label = metric === "cases" ? Math.round(d) : "$" + Math.round(d).toLocaleString();
      return colorBox + label;
    });
}


// ----------- Update the summary stats below each map ------------
function updateSummary(titleSelector, summarySelector, prov, metric, value) {
  d3.select(titleSelector).text(prov);
  const label = metric === "cases" ? "Total Cases" : "Total Loss";
  const formatted = metric === "cases" ? value : "$" + value.toLocaleString();
  d3.select(summarySelector).html(`${label}: <strong>${formatted}</strong>`);
}

// ---------------- Generate charts for each province ----------------
function drawProvinceCharts() {
  const prov1 = d3.select("#provinceSelect1").property("value");
  const prov2 = d3.select("#provinceSelect2").property("value");

  drawChartsForProvince(prov1, 1);
  drawChartsForProvince(prov2, 2);
}

function drawChartsForProvince(province, index) {
  const dataForProv = fraudData.filter(d => d.region === province);

  // Prepare dataset aggregations
  const categoryCounts = groupRare(countByField(dataForProv, "category"));
  const methodCounts   = groupRare(countByField(dataForProv, "method"));
  const ageCounts      = countByField(dataForProv, "ageRange");

  // Month counts
  const monthCounts = d3.rollup(
    dataForProv,
    v => v.length,
    d => d3.timeFormat("%B")(new Date(d.date))
  );
  const monthData = Array.from(monthCounts, ([key, val]) => ({ key, val }));

  d3.select(`#charts-title${index}`).text(`Charts for ${province}`);

  // Draw pie charts
  buildPieChart(`#catChart${index}`, categoryCounts, "Fraud / Cybercrime Categories");
  buildPieChart(`#methodChart${index}`, methodCounts, "Solicitation Method");
  buildPieChart(`#ageChart${index}`, ageCounts, "Victim Age Range");
  buildPieChart(`#monthChart${index}`, monthData, "Month Reported");
}

// ----------- Utility: count occurrences of a string field ------------
function countByField(data, field) {
  const map = d3.rollup(
    data,
    v => v.length,
    d => d[field] ? d[field] : "Not Available"
  );
  return Array.from(map, ([key, val]) => ({ key, val }));
}

// ----------- Group items contributing < 3% into "Other" ------------
function groupRare(arr) {
  const total = d3.sum(arr, d => d.val);
  const cutoff = total * 0.03;   // 3% threshold

  const major = arr.filter(d => d.val >= cutoff);
  const minor = arr.filter(d => d.val < cutoff);

  const minorTotal = d3.sum(minor, d => d.val);

  if (minorTotal > 0) {
    major.push({ key: "Other", val: minorTotal });
  }

  return major;
}


// ---------------- Pie Chart Generator ----------------
function buildPieChart(containerSelector, data, title) {
  d3.select(containerSelector).selectAll("*").remove();

  if (!data || data.length === 0) return;

  const width = 180, height = 180;
  const radius = Math.min(width, height) / 2 - 4;

  const svg = d3.select(containerSelector)
    .append("svg")
      .attr("width", width)
      .attr("height", height + 20)
    .append("g")
      .attr("transform", `translate(${width / 2}, ${height / 2})`);

  // Title
  d3.select(containerSelector)
    .append("div")
    .attr("class", "chart-title")
    .text(title);

  const pie = d3.pie().value(d => d.val);
  const arcs = pie(data);

  const color = d3.scaleOrdinal()
      .domain(data.map(d => d.key))
      .range(d3.schemeSet2);

  const arc = d3.arc().innerRadius(0).outerRadius(radius);

  svg.selectAll("path")
    .data(arcs)
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", d => color(d.data.key))
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5);

  // Labels (only if slice is large enough)
  svg.selectAll("text")
    .data(arcs)
    .enter()
    .append("text")
    .text(d => d.value > 0 ? d.data.key : "")
    .attr("transform", d => `translate(${arc.centroid(d)})`)
    .style("font-size", "10px")
    .style("text-anchor", "middle");
}
