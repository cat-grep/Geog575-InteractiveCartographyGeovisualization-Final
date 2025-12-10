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
}

// ----------- Render a single province map ------------
function drawMap(svgSelector, legendSelector, highlightProv, metric, valueByProv, colorScale) {
  const svg = d3.select(svgSelector);
  const container = svg.node().parentNode;
  const width = container.clientWidth;
  const height = width * 0.5;  // Landscape aspect ratio (2:1)

  svg.selectAll("*").remove(); // Clear previous render
  svg.attr("width", width).attr("height", height);

  // Map projection: Zoomed & centered on Canada
  const projection = d3.geoConicConformal()
    .center([-106, 65])
    .rotate([110, 27, 43])
    .scale(width * 0.9) // Increased scale for zoom effect
    .translate([width / 2, height / 2]);

  const path = d3.geoPath().projection(projection);

  // Tooltip
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
        d.properties["NAME"]    ||
        d.properties["name"]    ||
        d.properties["province"];
        return colorScale(valueByProv[name] || 0);
    })
    .attr("stroke", d => {
        const name =
        d.properties["PRENAME"] ||
        d.properties["NAME"]    ||
        d.properties["name"]    ||
        d.properties["province"];
        return name === highlightProv ? "#333" : "rgba(0,0,0,0.2)"; // faint outlines
    })
    .attr("stroke-width", d => {
        const name =
        d.properties["PRENAME"] ||
        d.properties["NAME"]    ||
        d.properties["name"]    ||
        d.properties["province"];
        return name === highlightProv ? 2 : 0.5; // thicker for selected
    })
    .on("mouseover", (event, d) => {
      const name = d.properties["PRENAME"] || d.properties["name"] || d.properties["NAME"] || d.properties["province"];
      const val = valueByProv[name] || 0;
      tooltip.style("visibility", "visible")
        .html(`<strong>${name}</strong><br>${metric === "cases" ? "Cases" : "Loss"}: ${metric === "cases" ? val : "$" + val.toLocaleString()}`)
        .style("left", (event.offsetX + 12) + "px")
        .style("top", (event.offsetY + 12) + "px");
    })
    .on("mousemove", event => {
      tooltip.style("left", (event.offsetX + 12) + "px")
             .style("top", (event.offsetY + 12) + "px");
    })
    .on("mouseout", () => {
      tooltip.style("visibility", "hidden");
    });

  // Build dynamic color legend
  buildLegend(legendSelector, metric, colorScale);
}

// ----------- Build dynamic color legend ------------
function buildLegend(selector, metric, colorScale) {
  const legend = d3.select(selector);
  legend.selectAll("*").remove();

  const steps = 6;
  const legendVals = d3.range(steps).map(i => i / (steps - 1) * colorScale.domain()[1]);

  legend.append("span").text(metric === "cases" ? "Cases" : "Loss ($)");
  legend.append("br");

  legend.selectAll(".legend-item")
    .data(legendVals)
    .enter()
    .append("span")
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
