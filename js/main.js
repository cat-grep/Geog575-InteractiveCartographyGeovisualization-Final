// -------------------------------------------------------------------
// 1) CONFIG
// -------------------------------------------------------------------
const DATA_FILE = "data/CanadianAnti-FraudCentreReportingData-EN-CA-only.json";

// -------------------------------------------------------------------
// 2) GLOBALS
// -------------------------------------------------------------------
let data = [];
let genderSelect, ageSelect, regionSelect;

// PIE CHART --------------------------------
const PIE_SIZE = 220;
const PIE_RADIUS = PIE_SIZE / 2 - 10;

const pie = d3.pie().value(d => d.value);
const arc = d3.arc().innerRadius(0).outerRadius(PIE_RADIUS);

// Select the SVG groups
const pieComplaintG = d3.select("#pie-complaint")
  .append("g")
  .attr("transform", `translate(${PIE_SIZE / 2},${PIE_SIZE / 2})`);

const pieCategoryG = d3.select("#pie-category")
  .append("g")
  .attr("transform", `translate(${PIE_SIZE / 2},${PIE_SIZE / 2})`);

const pieMethodG = d3.select("#pie-method")
  .append("g")
  .attr("transform", `translate(${PIE_SIZE / 2},${PIE_SIZE / 2})`);

// LINE CHART --------------------------------
const TREND_WIDTH = 700;
const TREND_HEIGHT = 300;

// Global SVG and axis groups for the line chart
const svgTrend = d3.select("#trend-svg")
  .attr("width", TREND_WIDTH)
  .attr("height", TREND_HEIGHT);

const trendMargin = { top: 20, right: 60, bottom: 30, left: 60 };
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
  d3.json(DATA_FILE)
]).then(([raw]) => {

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

  initControls();
  updateControls(); // This will now safely draw charts and the map

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

  // map metric selector (cases | loss)
  mapMetricSelect = d3.select("#mapMetricSelect");
  mapMetricSelect.on("change", () => {
    mapMetric = mapMetricSelect.node().value;
    updateControls();
  });

  const genders = Array.from(new Set(data.map(d => d.gender))).filter(Boolean).sort();
  const ages = Array.from(new Set(data.map(d => d.ageRange))).filter(Boolean).sort();
  const regions = Array.from(new Set(data.map(d => d.region))).filter(Boolean).sort();

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

// -------------------------------------------------------------------
// Update a pie chart given filtered data and an accessor function
// -------------------------------------------------------------------
// *** TODO: color scheme, labels, interactivity (mouseover), discuss: top N + "Others"
function updatePieChart(svgGroup, filteredData, accessor) {
  if (!filteredData.length) {
    svgGroup.selectAll("*").remove();
    return;
  }

  // Aggregate counts
  const aggregated = Array.from(
    d3.rollup(filteredData, v => v.length, accessor),
    ([key, value]) => ({ key: key || "Unknown", value })
  ).sort((a, b) => d3.descending(a.value, b.value));

  // Optional: Keep top 6 categories
  const topN = aggregated.slice(0, 6);
  if (aggregated.length > 6) {
    const other = d3.sum(aggregated.slice(6), d => d.value);
    topN.push({ key: "Others", value: other });
  }

  // Bind data
  const arcs = svgGroup.selectAll("path")
    // .data(pie(aggregated), d => d.data.key);
  .data(pie(topN), d => d.data.key);

  arcs.enter()
    .append("path")
    .merge(arcs)
    .attr("d", arc)
    .attr("fill", (d, i) => d3.schemeSet3[i % 10]);

  arcs.exit().remove();

  // Labels
  const labels = svgGroup.selectAll("text")
    // .data(pie(aggregated), d => d.data.key);
  .data(pie(topN), d => d.data.key);

  labels.enter()
    .append("text")
    .merge(labels)
    .attr("transform", d => `translate(${arc.centroid(d)})`)
    .attr("text-anchor", "middle")
    .attr("font-size", "10px")
    .text(d => d.data.key);

  labels.exit().remove();

  // Interactivity: tooltip on hover for pie slices
  const tooltip = d3.select("#tooltip");
  svgGroup.selectAll("path")
    .on("mousemove", function(event, d) {
      const html = `<strong>${d.data.key}</strong>: ${d.data.value}`;
      tooltip.html(html)
        .style("left", (event.clientX + 10) + "px")
        .style("top", (event.clientY + 10) + "px")
        .style("display", "block");
    })
    .on("mouseleave", function() {
      tooltip.style("display", "none");
    });
}

// -------------------------------------------------------------------
// Update the trend chart based on demographic filters
// -------------------------------------------------------------------
// *** TODO: add legend, axis labels, interactivity (mouseover)
function updateTrendChart(demoFiltered) {
  // If no data, clear chart
  if (!demoFiltered.length) {
    casesPath.attr("d", null);
    lossPath.attr("d", null);
    xAxisG.selectAll("*").remove();
    yAxisLeftG.selectAll("*").remove();
    yAxisRightG.selectAll("*").remove();
    return;
  }

  // Aggregate by year: cases & dollar loss
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
    .attr("stroke", "#1b9e77"); // or set via CSS

  lossPath
    .datum(yearly)
    .attr("d", lossLine)
    .attr("stroke", "#7570b3"); // or set via CSS

  // Axes
  const xAxis = d3.axisBottom(x).ticks(yearly.length).tickFormat(d3.format("d"));
  const yAxisLeft = d3.axisLeft(yCases).ticks(4);
  const yAxisRight = d3.axisRight(yLoss).ticks(4);

  xAxisG.call(xAxis);
  yAxisLeftG.call(yAxisLeft);
  yAxisRightG
    .attr("transform", `translate(${trendInnerWidth},0)`)
    .call(yAxisRight);

  // Draw / update vertical leading lines for tooltip interactivity
  const fmtInt = d3.format(",d");
  const fmtMoney = d3.format(",.2f");
  const tooltip = d3.select("#tooltip");

  // Bind data to vertical line elements
  const leads = trendG.selectAll('.trend-lead')
    .data(yearly, d => d.year);

  // leads: vertical lines
  leads.enter()
    .append('line')
    .attr('class', 'trend-lead')
    .merge(leads)
    .attr('x1', d => x(d.year))
    .attr('x2', d => x(d.year))
    .attr('y1', trendInnerHeight)
    .attr('y2', d => yCases(d.cases))
    .style('pointer-events', 'stroke')
    .on('mousemove', function(event, d) {
      const html = `<strong>${d.year}</strong><br/>Cases: ${fmtInt(d.cases)}<br/>Loss: $${fmtMoney(d.loss)}`;
      tooltip.html(html)
        .style('left', (event.clientX + 10) + 'px')
        .style('top', (event.clientY + 10) + 'px')
        .style('display', 'block');
    })
    .on('mouseleave', function() {
      tooltip.style('display', 'none');
    });

  leads.exit().remove();

  // --- Hover interaction: dynamic dashed vertical line snapping to nearest year + points for both series
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
    .on('mousemove', function(event) {
      if (!yearly || !yearly.length) return;
      const [mx] = d3.pointer(event, this);
      const xVal = x.invert(mx);
      // find nearest year
      let nearest = yearly[0];
      let minDiff = Math.abs(yearly[0].year - xVal);
      for (let i = 1; i < yearly.length; i++) {
        const diff = Math.abs(yearly[i].year - xVal);
        if (diff < minDiff) { minDiff = diff; nearest = yearly[i]; }
      }

      const xPos = x(nearest.year);

      // show hover vertical dashed line
      const hoverLine = trendG.selectAll('.trend-hover-line').data([null]);
      hoverLine.enter().append('line').attr('class', 'trend-hover-line')
        .merge(hoverLine)
        .attr('x1', xPos).attr('x2', xPos)
        .attr('y1', 0).attr('y2', trendInnerHeight)
        .attr('stroke', '#6b7280')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .style('opacity', 0.9);

      // show hover points for both series
      const hoverPointCases = trendG.selectAll('.trend-hover-point-cases').data([nearest]);
      hoverPointCases.enter().append('circle').attr('class', 'trend-hover-point-cases')
        .attr('r', 5)
        .merge(hoverPointCases)
        .attr('cx', xPos)
        .attr('cy', d => yCases(d.cases))
        .attr('fill', '#1b9e77')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('opacity', 1)
        .style('pointer-events', 'none');

      const hoverPointLoss = trendG.selectAll('.trend-hover-point-loss').data([nearest]);
      hoverPointLoss.enter().append('circle').attr('class', 'trend-hover-point-loss')
        .attr('r', 5)
        .merge(hoverPointLoss)
        .attr('cx', xPos)
        .attr('cy', d => yLoss(d.loss))
        .attr('fill', '#7570b3')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .style('opacity', 1)
        .style('pointer-events', 'none');

      // Tooltip shows both metrics
      const fmtInt2 = d3.format(',d');
      const fmtMoney2 = d3.format(',.2f');
      const html = `<strong>${nearest.year}</strong><br/>Cases: ${fmtInt2(nearest.cases)}<br/>Loss: $${fmtMoney2(nearest.loss)}`;
      d3.select('#tooltip')
        .html(html)
        .style('left', (event.clientX + 10) + 'px')
        .style('top', (event.clienY + 10) + 'px')
        .style('display', 'block');
    })
    .on('mouseleave', function() {
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
  const maxDate = d3.max(data, d => d.date);
  const oneYearAgo = d3.timeYear.offset(maxDate, -1);

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

  // *** TODO: Customize Date Select, Visualize the numbers (with cards or infographics)?
  summaryLines.push(`From ${fmtDate(oneYearAgo)} to ${fmtDate(maxDate)} (last 12 months),<br>`);
  summaryLines.push(`a total of <strong>${fmtInt(totalCases)}</strong> cases were reported,`);
  summaryLines.push(`with an estimated <strong>$${fmtMoney(totalLoss)}</strong> in financial losses.`);

  d3.select("#summary-text")
    .html(summaryLines.join(" "));

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

  d3.select("#debug")
    .text(`Filtered records: ${filtered.length} / ${data.length} total.`);
}