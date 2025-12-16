// -------------------------------------------------------------------
// 1) CONFIG
// -------------------------------------------------------------------
const DATA_FILE = "data/CanadianAnti-FraudCentreReportingData-EN-CA-only.json";
const GEOJSON_FILE = "data/CanadaProvincesCartoBoundary_EPSG4326.geojson";

// -------------------------------------------------------------------
// 2) GLOBALS
// -------------------------------------------------------------------
const greenColor = "#1b9e77";
const purpleColor = "#7570b3";

let data = [];
let genderSelect, ageSelect, regionSelect;

// Canadian provinces + territories
const VALID_REGIONS = new Set([
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland And Labrador",
  "North West Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
]);

let dateStartInput, dateEndInput;
let defaultMaxDate = null;
let defaultOneYearAgo = null;

// MINI MAP ---------------------------------
let canadaGeoJson = null;
let mapPathGenerator;
let mapSvg;

// PIE CHART --------------------------------
const PIE_VIEWBOX_SIZE = 400; 
const PIE_RADIUS = PIE_VIEWBOX_SIZE / 2 - 100;

// inner radius for circular barplot
const CIRC_INNER_RADIUS = 50;

const pie = d3.pie().value(d => d.value);
const arc = d3.arc().innerRadius(0).outerRadius(PIE_RADIUS);

// Select the SVG groups
// const pieComplaintG = d3.select("#pie-complaint")
//   .append("g")
//   .attr("transform", `translate(${PIE_SIZE / 2},${PIE_SIZE / 2})`);

const pieCategoryG = setupResponsivePie("#pie-category");
const pieMethodG = setupResponsivePie("#pie-method");

// LINE CHART --------------------------------
const TREND_WIDTH = 700;
const TREND_HEIGHT = 300;

// Global SVG and axis groups for the line chart
const svgTrend = d3.select("#trend-svg")
  .attr("viewBox", `0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`)
  .attr("preserveAspectRatio", "xMidYMid meet")
  .style("width", "100%")
  .style("height", "auto");

const trendMargin = { top: 30, right: 80, bottom: 30, left: 60 };
const trendInnerWidth = TREND_WIDTH - trendMargin.left - trendMargin.right;
const trendInnerHeight = TREND_HEIGHT - trendMargin.top - trendMargin.bottom;

// Group that holds everything inside margins
const trendG = svgTrend.append("g")
  .attr("transform", `translate(${trendMargin.left},${trendMargin.top})`);

// Axes groups
const xAxisG = trendG.append("g").attr("class", "x-axis")
  .attr("transform", `translate(0,${trendInnerHeight})`);

const yAxisLeftG = trendG.append("g").attr("class", "y-axis-left");
const yAxisRightG = trendG.append("g").attr("class", "y-axis-right");

// Paths for the two lines
const casesPath = trendG.append("path")
  .attr("class", "cases-line")
  .attr("fill", "none")
  .attr("stroke-width", 2);

const lossPath = trendG.append("path")
  .attr("class", "loss-line")
  .attr("fill", "none")
  .attr("stroke-width", 2);


// -------------------------------------------------------------------
// 3) Load ALL Data Promises
// -------------------------------------------------------------------
Promise.all([
  d3.json(DATA_FILE),
  d3.json(GEOJSON_FILE)
]).then(([raw, geoData]) => {

  // Store GeoJSON globally
  canadaGeoJson = geoData;

  if (!Array.isArray(raw)) throw new Error("JSON root is not an array");

  data = raw.map(d => {
    return {
      ...d,
      date: new Date(d.date),
      region: d.region || "",
      gender: d.gender || "",
      ageRange: d.ageRange || "",
      dollarLoss: +d.dollarLoss || 0,
      victimCount: +d.victimCount || 0,
    };
  }).filter(d => d.date instanceof Date && !isNaN(d.date));

  console.log("Loaded rows:", data.length);

  defaultMaxDate = d3.max(data, d => d.date);
  defaultOneYearAgo = d3.timeYear.offset(defaultMaxDate, -1);

  initControls();
  initMap();
  updateControls();

}).catch(err => {
  console.error("Error loading data:", err);
  d3.select("#summary-text").text("Error loading data. Check console.");
});

// -------------------------------------------------------------------
// Initialize the dropdown controls
// -------------------------------------------------------------------
function initControls() {
  genderSelect = d3.select("#genderSelect");
  ageSelect = d3.select("#ageSelect");
  regionSelect = d3.select("#regionSelect");

  //date range inputs
  dateStartInput = d3.select("#dateStart");
  dateEndInput = d3.select("#dateEnd");

  // map metric selector (cases | loss)
  mapMetricSelect = d3.select("#mapMetricSelect");
  mapMetricSelect.on("change", () => {
    mapMetric = mapMetricSelect.node().value;
    updateControls();
  });

  // initialize date inputs to default 12-month range
  const fmtInput = d3.timeFormat("%Y-%m-%d");
  if (defaultOneYearAgo && defaultMaxDate) {
    dateStartInput.property("value", fmtInput(defaultOneYearAgo));
    dateEndInput.property("value", fmtInput(defaultMaxDate));
  }

  // when dates change, recompute summary and charts
  dateStartInput.on("change", updateControls);
  dateEndInput.on("change", updateControls);

  // map metric selector (cases | loss)
  mapMetricSelect = d3.select("#mapMetricSelect");
  mapMetricSelect.on("change", () => {
    mapMetric = mapMetricSelect.node().value;
    updateControls();
  });

  const genders = Array.from(new Set(data.map(d => d.gender))).filter(Boolean).sort();
  const ages = Array.from(new Set(data.map(d => d.ageRange))).filter(Boolean).sort();
  // const regions = Array.from(new Set(data.map(d => d.region))).filter(Boolean).sort();
  const regions = Array.from(
    new Set(
      data
        .map(d => (d.region || "").trim())
        .filter(r => r && VALID_REGIONS.has(r))   // keep only valid Canadian regions
    )
  ).sort();

  function fillSelect(sel, values) {
    sel.selectAll("*").remove();
    sel.append("option").attr("value", "all").text("All");
    values.forEach(v => {
      sel.append("option")
        .attr("value", v)
        .text(v);
    });
  }

  fillSelect(genderSelect, genders);
  fillSelect(ageSelect, ages);
  fillSelect(regionSelect, regions);

  genderSelect.on("change", updateControls);
  ageSelect.on("change", updateControls);
  regionSelect.on("change", updateControls);

  // Optional: set a default, e.g. Ontario + 40-49 + Male:
  // genderSelect.property("value", "Male");
  // ageSelect.property("value", "40-49");
  // regionSelect.property("value", "Ontario");
}

// -------------------------------------------------------------------
// Helper: read current filters
// -------------------------------------------------------------------
function getFilters() {
  return {
    gender: genderSelect ? genderSelect.node().value : "all",
    age: ageSelect ? ageSelect.node().value : "all",
    region: regionSelect ? regionSelect.node().value : "all",
  };
}

function setupResponsivePie(selectorId) {
  return d3.select(selectorId)
    // "viewBox" defines the internal coordinate system (0 0 600 600)
    .attr("viewBox", `0 0 ${PIE_VIEWBOX_SIZE} ${PIE_VIEWBOX_SIZE}`)
    // "preserveAspectRatio" ensures it doesn't stretch/distort
    .attr("preserveAspectRatio", "xMidYMid meet")
    // CSS to make it fit the container
    .style("width", "auto")
    .style("height", "80%")
    .append("g")
    // Move (0,0) to the center of the box
    .attr("transform", `translate(${PIE_VIEWBOX_SIZE / 2},${PIE_VIEWBOX_SIZE / 2})`);
}

// -------------------------------------------------------------------
// MINI MAP
// -------------------------------------------------------------------
function initMap() {
  // 1. Get dimensions
  const container = document.getElementById('mini-map-container');
  const width = container.clientWidth || 400;
  const height = 400;

  // 2. Setup SVG
  mapSvg = d3.select("#mini-map-svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  // 3. Define Projection with fitSize
  const projection = d3.geoTransverseMercator()
    .rotate([96, 0])  // Keep the rotation to orient Canada upright
    .fitSize([width, height], canadaGeoJson);

  mapPathGenerator = d3.geoPath().projection(projection);

  // 4. Draw Map Paths (Clear existing first if re-initializing)
  mapSvg.selectAll("*").remove(); 

  // Draw Polygons
  mapSvg.selectAll("path")
    .data(canadaGeoJson.features)
    .enter()
    .append("path")
    .attr("d", mapPathGenerator)
    .attr("stroke", "#454545")
    .attr("stroke-width", 0.5)
    .attr("fill", "#555"); // Set a default fill so it's visible immediately

  // 5. Add Labels
  mapSvg.selectAll("text.region-label")
    .data(canadaGeoJson.features)
    .enter()
    .append("text")
    .attr("class", "region-label")
    .text(d => d.properties.PREABBR) 
    .attr("transform", d => {
        const [x, y] = mapPathGenerator.centroid(d);
        return `translate(${x}, ${y})`;
    })
    .attr("text-anchor", "middle")
    .attr("alignment-baseline", "middle")
    .style("font-size", "0.5em")
    .style("fill", "white")
    .style("pointer-events", "none")
    .style("text-shadow", "0px 0px 2px #000");
}

function updateMap() {
  if (!canadaGeoJson) return;

  const filters = getFilters(); 
  const selectedRegion = filters.region; 

  const baseColor = "#555"; 

  mapSvg.selectAll("path")
    .transition().duration(200)
    .attr("fill", d => {
      let featureName = d.properties.PRENAME;

      if (featureName.toLowerCase() === "newfoundland and labrador") {
        featureName = "Newfoundland And Labrador";
      }

      if (featureName === "Northwest Territories") {
        featureName = "North West Territories";
      }

      if (selectedRegion === "all") {
        return greenColor; 
      } else {
        return featureName === selectedRegion ? greenColor : baseColor;
      }
    });
}

// -------------------------------------------------------------------
// Update a pie chart given filtered data and an accessor function
// -------------------------------------------------------------------
function updatePieChart(svgGroup, filteredData, accessor) {
  if (!filteredData.length) {
    svgGroup.selectAll("*").remove();
    return;
  }

  // 1) Aggregate counts
  const aggregated = Array.from(
    d3.rollup(filteredData, v => v.length, accessor),
    ([key, value]) => ({ key: key || "Unknown", value })
  ).sort((a, b) => d3.descending(a.value, b.value));

  const topN = aggregated.slice(0, 20);
  if (aggregated.length > 20) {
    const other = d3.sum(aggregated.slice(20), d => d.value);
    topN.push({ key: "Others", value: other });
  }

  const dataForChart = topN;
  const total = d3.sum(dataForChart, d => d.value);

  // 2) Scales
  const x = d3.scaleBand()
    .range([0, 2 * Math.PI])
    .align(0)
    .domain(dataForChart.map(d => d.key));

  const y = d3.scaleRadial()
    .range([CIRC_INNER_RADIUS, PIE_RADIUS])
    .domain([0, d3.max(dataForChart, d => d.value) || 1]);

  const color = d3.scaleOrdinal()
    .domain(dataForChart.map(d => d.key))
    .range(d3.schemeSet3);

  const tooltip = d3.select("#tooltip");
  const fmtInt = d3.format(",d");
  const fmtPct = d3.format(".1%");

  // 3) BARS (circular)
  const bars = svgGroup.selectAll("path.circular-bar")
    .data(dataForChart, d => d.key);

  bars.enter()
    .append("path")
    .attr("class", "circular-bar")
    .merge(bars)
    .attr("fill", d => color(d.key))
    .attr("d", d3.arc()
      .innerRadius(CIRC_INNER_RADIUS)
      .outerRadius(d => y(d.value))
      .startAngle(d => x(d.key))
      .endAngle(d => x(d.key) + x.bandwidth())
      .padAngle(0.01)
      .padRadius(CIRC_INNER_RADIUS)
    )
    .on("mousemove", (event, d) => {
      const pct = total ? d.value / total : 0;
      tooltip.html(
        `<strong>${d.key}</strong><br>` +
        `Count: ${fmtInt(d.value)}<br>` +
        `Share: ${fmtPct(pct)}`
      )
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY + 10) + "px")
        .style("display", "block");
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    });

  bars.exit().remove();

  // 4) LABEL GROUPS
  const labelGroups = svgGroup.selectAll("g.circular-label")
    .data(dataForChart, d => d.key);

  const labelEnter = labelGroups.enter()
    .append("g")
    .attr("class", "circular-label");

  labelEnter.merge(labelGroups)
    .attr("text-anchor", d => {
      const angle = x(d.key) + x.bandwidth() / 2;
      return (angle + Math.PI) % (2 * Math.PI) < Math.PI ? "end" : "start";
    })
    .attr("transform", d => {
      const angle = x(d.key) + x.bandwidth() / 2;
      const r = y(d.value) + 10; // slightly outside the bar
      const rotate = angle * 180 / Math.PI - 90;
      return `rotate(${rotate})translate(${r},0)`;
    })
    // Tooltip on the whole label group
    .on("mousemove", (event, d) => {
      const pct = total ? d.value / total : 0;
      tooltip.html(
        `<strong>${d.key}</strong><br>` +
        `Count: ${fmtInt(d.value)}<br>` +
        `Share: ${fmtPct(pct)}`
      )
        .style("left", (event.clientX + 10) + "px")
        .style("top", (event.clientY + 10) + "px")
        .style("display", "block");
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    });

  // 5) LABEL TEXT (white)
  const labels = labelEnter.merge(labelGroups).selectAll("text")
    .data(d => [d]);

  labels.enter()
    .append("text")
    .merge(labels)
    .text(d => d.key)
    .style("font-size", "0.8em")
    .style("fill", "#ffffff")              // white labels
    .attr("alignment-baseline", "middle")
    .attr("transform", d => {
      const angle = x(d.key) + x.bandwidth() / 2;
      return (angle + Math.PI) % (2 * Math.PI) < Math.PI
        ? "rotate(180)"
        : "rotate(0)";
    });

  labels.exit().remove();
  labelGroups.exit().remove();
}

// -------------------------------------------------------------------
// Update the trend chart based on demographic filters
// -------------------------------------------------------------------
function updateTrendChart(demoFiltered) {
  // If no data, clear chart
  if (!demoFiltered.length) {
    casesPath.attr("d", null);
    lossPath.attr("d", null);
    xAxisG.selectAll("*").remove();
    yAxisLeftG.selectAll("*").remove();
    yAxisRightG.selectAll("*").remove();
    trendG.select(".chart-legend").remove(); // Clear legend
    return;
  }

  // --- 1. Colors Configuration ---

  // Aggregate by year
  const yearly = Array.from(
    d3.rollup(
      demoFiltered,
      v => ({
        cases: v.length,
        loss: d3.sum(v, d => d.dollarLoss)
      }),
      d => d.date.getFullYear()
    ),
    ([year, vals]) => ({ year: +year, cases: vals.cases, loss: vals.loss })
  ).sort((a, b) => d3.ascending(a.year, b.year));

  // Scales
  const x = d3.scaleLinear()
    .domain(d3.extent(yearly, d => d.year))
    .range([0, trendInnerWidth]);

  const yCases = d3.scaleLinear()
    .domain([0, d3.max(yearly, d => d.cases) || 1])
    .nice()
    .range([trendInnerHeight, 0]);

  const yLoss = d3.scaleLinear()
    .domain([0, d3.max(yearly, d => d.loss) || 1])
    .nice()
    .range([trendInnerHeight, 0]);

  // Line generators
  const casesLine = d3.line()
    .x(d => x(d.year))
    .y(d => yCases(d.cases));

  const lossLine = d3.line()
    .x(d => x(d.year))
    .y(d => yLoss(d.loss));

  // Update paths
  casesPath
    .datum(yearly)
    .attr("d", casesLine)
    .attr("stroke", greenColor)
    .attr("fill", "none")
    .attr("stroke-width", 2);

  lossPath
    .datum(yearly)
    .attr("d", lossLine)
    .attr("stroke", purpleColor)
    .attr("fill", "none")
    .attr("stroke-width", 2);

  // --- 2. Axes with Color Alignment ---
  const xAxis = d3.axisBottom(x).ticks(yearly.length).tickFormat(d3.format("d"));
  const yAxisLeft = d3.axisLeft(yCases).ticks(4);
  const yAxisRight = d3.axisRight(yLoss).ticks(4);

  xAxisG.call(xAxis);

  // Left Axis (Cases - Green)
  yAxisLeftG.call(yAxisLeft)
    .call(g => g.selectAll("text").attr("fill", greenColor)) // Color the text
    .call(g => g.selectAll("line").attr("stroke", greenColor)) // Color the ticks
    .call(g => g.select(".domain").attr("stroke", greenColor)); // Color the main axis line

  // Right Axis (Loss - Purple)
  yAxisRightG
    .attr("transform", `translate(${trendInnerWidth},0)`)
    .call(yAxisRight)
    .call(g => g.selectAll("text").attr("fill", purpleColor))
    .call(g => g.selectAll("line").attr("stroke", purpleColor))
    .call(g => g.select(".domain").attr("stroke", purpleColor));


  // --- 3. Adding a Legend ---
  // Remove existing legend to prevent duplicates on update
  trendG.select(".chart-legend").remove();

  const legend = trendG.append("g")
    .attr("class", "chart-legend")
    .attr("transform", "translate(-50, -15)"); // Position top-left (adjust as needed)

  // Legend Item 1: Cases
  legend.append("circle").attr("cx", 0).attr("cy", 0).attr("r", 5).style("fill", greenColor);
  legend.append("text").attr("x", 10).attr("y", 4).text("Total Cases").style("font-size", "12px").attr("alignment-baseline", "middle").style("fill", greenColor);

  // Legend Item 2: Loss
  legend.append("circle").attr("cx", 100).attr("cy", 0).attr("r", 5).style("fill", purpleColor);
  legend.append("text").attr("x", 110).attr("y", 4).text("Dollar Loss").style("font-size", "12px").attr("alignment-baseline", "middle").style("fill", purpleColor);


  // --- 4. Tooltip & Interactions ---
  const overlay = trendG.selectAll('.trend-overlay').data([null]);

  overlay.enter()
    .append('rect')
    .attr('class', 'trend-overlay')
    .attr('fill', 'transparent')
    .style('pointer-events', 'all')
    .merge(overlay)
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', trendInnerWidth)
    .attr('height', trendInnerHeight)
    .on('mousemove', function (event) {
      if (!yearly || !yearly.length) return;

      const [mx] = d3.pointer(event, this);
      const xVal = x.invert(mx);

      // Find nearest year
      let nearest = yearly[0];
      let minDiff = Math.abs(yearly[0].year - xVal);
      for (let i = 1; i < yearly.length; i++) {
        const diff = Math.abs(yearly[i].year - xVal);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = yearly[i];
        }
      }

      const xPos = x(nearest.year);

      // Show hover vertical dashed line
      const hoverLine = trendG.selectAll('.trend-hover-line').data([null]);
      hoverLine.enter().append('line').attr('class', 'trend-hover-line')
        .merge(hoverLine)
        .attr('x1', xPos).attr('x2', xPos)
        .attr('y1', 0).attr('y2', trendInnerHeight)
        .attr('stroke', '#6b7280')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .style('opacity', 0.9);

      // Show hover points
      const hoverPointCases = trendG.selectAll('.trend-hover-point-cases').data([nearest]);
      hoverPointCases.enter().append('circle').attr('class', 'trend-hover-point-cases')
        .attr('r', 5)
        .merge(hoverPointCases)
        .attr('cx', xPos)
        .attr('cy', d => yCases(d.cases))
        .attr('fill', greenColor) // Using variable
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('pointer-events', 'none');

      const hoverPointLoss = trendG.selectAll('.trend-hover-point-loss').data([nearest]);
      hoverPointLoss.enter().append('circle').attr('class', 'trend-hover-point-loss')
        .attr('r', 5)
        .merge(hoverPointLoss)
        .attr('cx', xPos)
        .attr('cy', d => yLoss(d.loss))
        .attr('fill', purpleColor) // Using variable
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('pointer-events', 'none');

      // Tooltip
      const fmtInt2 = d3.format(',d');
      const fmtMoney2 = d3.format(',.2f');
      const html = `<strong>${nearest.year}</strong><br/>
                    <span style="color:${greenColor}">Cases: ${fmtInt2(nearest.cases)}</span><br/>
                    <span style="color:${purpleColor}">Loss: $${fmtMoney2(nearest.loss)}</span>`;

      d3.select('#tooltip')
        .html(html)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY + 10) + 'px')
        .style('display', 'block');
    })
    .on('mouseleave', function () {
      trendG.selectAll('.trend-hover-line').remove();
      trendG.selectAll('.trend-hover-point-cases').remove();
      trendG.selectAll('.trend-hover-point-loss').remove();
      d3.select('#tooltip').style('display', 'none');
    });

  overlay.exit().remove();
}

// -------------------------------------------------------------------
// Update the summary text and charts based on current filters
// -------------------------------------------------------------------
function updateControls() {
  if (!data.length) return;

  const { gender, age, region } = getFilters();

  // Last 12 months relative to the max date in the dataset
  let maxDate = defaultMaxDate;
  let oneYearAgo = defaultOneYearAgo;

  if (dateStartInput && dateEndInput) {
    const startVal = dateStartInput.node().value;
    const endVal = dateEndInput.node().value;
    const parseInput = d3.timeParse("%Y-%m-%d");

    if (startVal && endVal) {
      const startDate = parseInput(startVal);
      const endDate = parseInput(endVal);

      // simple validation: only use if both are valid and start <= end
      if (startDate && endDate && startDate <= endDate) {
        oneYearAgo = startDate;
        maxDate = endDate;
      }
    }
  }

  const filtered = data.filter(d => {
    // Time window
    if (d.date < oneYearAgo || d.date > maxDate) return false;

    // Demographic filters
    if (gender !== "all" && d.gender !== gender) return false;
    if (age !== "all" && d.ageRange !== age) return false;
    if (region !== "all" && d.region !== region) return false;

    return true;
  });

  const totalCases = filtered.length;
  const totalLoss = d3.sum(filtered, d => d.dollarLoss);

  const fmtInt = d3.format(",d");
  const fmtMoney = d3.format(",.2f");
  const fmtDate = d3.timeFormat("%Y-%m-%d");

  const summaryLines = [];

  const period = `${fmtDate(oneYearAgo)} – ${fmtDate(maxDate)}`;
  const casesStr = fmtInt(totalCases);
  const lossStr = fmtMoney(totalLoss);

  const summaryHtml = `
  <div class="row g-2">
    <!-- Cases card -->
    <div class="col-6 col-md-6">
      <div class="card shadow-sm h-100 text-white bg-dark ">
        <div class="card-body">
          <p class="card-subtitle text-muted mb-1">Reported cases</p>
          <h3 class="card-title mb-0" style="color:${greenColor}">${casesStr}</h3>
        </div>
      </div>
    </div>

    <!-- Loss card -->
    <div class="col-6 col-md-6">
      <div class="card shadow-sm h-100 text-white bg-dark ">
        <div class="card-body">
          <p class="card-subtitle text-muted mb-1">Estimated losses</p>
          <h3 class="card-title mb-0" style="color:${purpleColor}">$${lossStr}</h3>
        </div>
      </div>
    </div>
  </div>
`;

  d3.select("#summary-text").html(summaryHtml);

  // --- update 3 pie charts ---
  // updatePieChart(pieComplaintG, filtered, d => d.complaintType);
  updatePieChart(pieCategoryG, filtered, d => d.category);
  updatePieChart(pieMethodG, filtered, d => d.method);
  // --- end pie charts ---

  // --- update yearly trend chart using demographic filters only
  const demoFiltered = data.filter(d => {
    // Demographic filters
    if (gender !== "all" && d.gender !== gender) return false;
    if (age !== "all" && d.ageRange !== age) return false;
    if (region !== "all" && d.region !== region) return false;

    return true;
  });
  updateTrendChart(demoFiltered);
  // --- end trend chart ---

  updateMap();

  d3.select("#debug")
    .text(`Filtered records: ${filtered.length} / ${data.length} total.`);
}

window.addEventListener("resize", () => {
    // Redraw map with new dimensions
    if (canadaGeoJson) {
        initMap();
        updateMap(); // Re-apply the color highlights
    }
});