// -------------------------------------------------------------------
// 1) GLOBAL STATE & CONSTANTS
// -------------------------------------------------------------------
const greenColor = "#1b9e77";
const purpleColor = "#7570b3";

let geojson = null;
let fraudData = null;
let metaYears = [];
let metaGenders = [];
let metaAgeRanges = [];
let provinceNameSet = new Set();

let selectedMetric = "cases";  // "cases" | "loss"
let selectedGender = "ALL";
let selectedAge = "ALL";
let selectedYear = null;       // null = all years

let mapSvg, trendSvg, barSvg;
let mapWidth, mapHeight;
let trendWidth, trendHeight;
let barWidth, barHeight;
let projection, path;

let donutSvg, donutWidth, donutHeight, donutRadius;
let donutG;

let genderSvg, genderG, genderRadius, genderWidth, genderHeight;

const tooltip = d3.select("#tooltip");


// -------------------------------------------------------------------
// 2) FORMATTERS & SMALL HELPERS
// -------------------------------------------------------------------
const formatInt = d3.format(",.0f");
const formatDollar = d3.format("$,");  // no decimals

function formatMetricValue(value, metric) {
  if (!value || !isFinite(value)) return "0";
  return metric === "loss" ? formatDollar(value) : formatInt(value);
}


// -------------------------------------------------------------------
// 3) LOAD DATA (GEOJSON + AGGREGATED TREND)
// -------------------------------------------------------------------
Promise.all([
  d3.json("data/CanadaProvincesCartoBoundary_EPSG4326.geojson"),
  d3.json("data/CanadianAnti-FraudCentreReportingData_aggregated_for_trend.json")
]).then(([geo, fraud]) => {
  geojson = geo;
  fraudData = fraud;

  provinceNameSet = new Set(
    geojson.features.map(f => f.properties.PRENAME)
  );

  metaYears = fraudData.meta.years;
  metaGenders = fraudData.meta.genders;
  metaAgeRanges = fraudData.meta.ageRanges;

  preprocessData();
  initControls();
  initSVGs();
  updateAll();
}).catch(err => {
  console.error("Error loading data:", err);
});


// -------------------------------------------------------------------
// 4) PREPROCESS / NORMALIZE DATA
// -------------------------------------------------------------------
function preprocessData() {
  // Normalize region names; keep only provinces in boundary file
  const provinceMap = new Map();
  provinceNameSet.forEach(name => {
    provinceMap.set(name.toLowerCase(), name);
  });

  function normalizeRegion(raw) {
    if (!raw) return null;
    let candidate = raw;

    if (raw === "Newfoundland And Labrador") {
      candidate = "Newfoundland and Labrador";
    } else if (raw === "North West Territories" || raw === "Northwest Territories") {
      candidate = "Northwest Territories";
    }

    const lower = candidate.toLowerCase();
    for (const full of provinceNameSet) {
      if (full.toLowerCase() === lower) return full;
    }
    // not a province in this boundary file
    return null;
  }

  fraudData.mapByYear.forEach(d => {
    d.cases = +d.cases;
    d.loss = +d.loss;
    d.regionNormalized = normalizeRegion(d.region);
  });
}


// -------------------------------------------------------------------
// 5) UI CONTROLS (DROPDOWNS & BUTTONS)
// -------------------------------------------------------------------
function initControls() {
  const genderSelect = d3.select("#genderSelect");
  genderSelect.selectAll("option")
    .data(["ALL"].concat(metaGenders))
    .enter()
    .append("option")
    .attr("value", d => d)
    .text(d => d);

  // Metric buttons (cases vs loss)
  const btnCase = d3.select("#btnCase");
  const btnLoss = d3.select("#btnLoss");

  function updateMetricStyles() {
    if (selectedMetric === "cases") {
      // Case active (green solid)
      btnCase.style("background-color", greenColor)
        .style("border-color", greenColor)
        .style("color", "white");

      // Loss inactive (purple outline)
      btnLoss.style("background-color", "transparent")
        .style("color", purpleColor)
        .style("border-color", purpleColor);
    } else {
      // Case inactive (green outline)
      btnCase.style("background-color", "transparent")
        .style("color", greenColor)
        .style("border-color", greenColor);

      // Loss active (purple solid)
      btnLoss.style("background-color", purpleColor)
        .style("color", "white")
        .style("border-color", purpleColor);
    }
  }

  // Metric button click handlers
  btnCase.on("click", () => {
    if (selectedMetric !== "cases") {
      selectedMetric = "cases";
      updateMetricStyles();
      updateAll();
    }
  });

  btnLoss.on("click", () => {
    if (selectedMetric !== "loss") {
      selectedMetric = "loss";
      updateMetricStyles();
      updateAll();
    }
  });

  // Initialize metric button styles
  updateMetricStyles();

  // Gender dropdown
  genderSelect.on("change", function () {
    selectedGender = this.value;
    updateAll();
  });

  // "All years" button (trend chart)
  d3.select("#allYearsBtn").on("click", function () {
    selectedYear = null;
    d3.select(this).classed("active", true);
    updateAll();
  });

  // "All ages" button (age donut)
  d3.select("#allAgesBtn").on("click", function () {
    selectedAge = "ALL";
    d3.select(this).classed("active", true);
    updateAll();
  });

  // "All genders" button (gender donut)
  d3.select("#allGendersBtn").on("click", function () {
    selectedGender = "ALL";
    d3.select(this).classed("active", true);
    updateAll();
  });
}

function updateYearLabel() {
  const yearLabel = document.getElementById("yearLabel");
  yearLabel.textContent = selectedYear == null ? "All years" : selectedYear;
}


// -------------------------------------------------------------------
// 6) SVG INITIALIZATION & LAYOUT
// -------------------------------------------------------------------
function initSVGs() {
  // --- Map setup ---
  const mapContainer = document.getElementById("mapContainer");
  mapWidth = mapContainer.clientWidth;
  mapHeight = mapContainer.clientHeight;

  mapSvg = d3.select("#map")
    .attr("width", mapWidth)
    .attr("height", mapHeight);

  projection = d3.geoTransverseMercator()
    .rotate([96, 0])
    .fitSize([mapWidth, mapHeight], geojson);

  path = d3.geoPath().projection(projection);

  // --- Trend chart setup ---
  const trendParent = document.getElementById("trendChart").parentElement;
  trendWidth = trendParent.clientWidth;
  trendHeight = trendParent.clientHeight;

  trendSvg = d3.select("#trendChart")
    .attr("width", trendWidth)
    .attr("height", trendHeight);

  // --- Bar chart setup ---
  const barParent = document.getElementById("barChart").parentElement;
  barWidth = barParent.clientWidth;
  barHeight = barParent.clientHeight;

  barSvg = d3.select("#barChart")
    .attr("width", barWidth)
    .attr("height", barHeight);

  // --- Gender & Age donut setup ---
  const genderParent = document.getElementById("genderChart").parentElement;
  const donutParent = document.getElementById("donutChart").parentElement;

  genderWidth = genderParent.clientWidth;
  genderHeight = genderParent.clientHeight;

  donutWidth = donutParent.clientWidth;
  donutHeight = donutParent.clientHeight;

  // shared radius for both donuts
  const margin = 40;
  const possibleRadiusGender = Math.min(genderWidth, genderHeight) / 2 - margin;
  const possibleRadiusAge = Math.min(donutWidth, donutHeight) / 2 - margin;
  const commonRadius = Math.min(possibleRadiusGender, possibleRadiusAge);

  genderRadius = commonRadius;
  donutRadius = commonRadius;

  // Gender SVG
  genderSvg = d3.select("#genderChart")
    .attr("width", genderWidth)
    .attr("height", genderHeight);

  genderG = genderSvg.append("g")
    .attr("transform", `translate(${genderWidth / 2},${genderHeight / 2})`);

  // Age SVG
  donutSvg = d3.select("#donutChart")
    .attr("width", donutWidth)
    .attr("height", donutHeight);

  donutG = donutSvg.append("g")
    .attr("transform", `translate(${donutWidth / 2},${donutHeight / 2})`);
}


// -------------------------------------------------------------------
// 7) UPDATE PIPELINE (ENTRY POINT)
// -------------------------------------------------------------------
function updateAll() {
  updateMap();
  updateTrendChart();
  updateBarChart();
  updateAgeChart();
  updateGenderChart();
}


// -------------------------------------------------------------------
// 8) DATA HELPERS (FILTER & AGGREGATE)
// -------------------------------------------------------------------
function filteredMapByYearRows(filterYear) {
  // Only Canadian provinces (regionNormalized != null)
  return fraudData.mapByYear.filter(d => {
    if (!d.regionNormalized) return false;
    if (filterYear != null && d.year !== filterYear) return false;
    if (selectedGender !== "ALL" && d.gender !== selectedGender) return false;
    if (selectedAge !== "ALL" && d.ageRange !== selectedAge) return false;
    return true;
  });
}

function aggregateByYear() {
  const result = [];
  metaYears.forEach(year => {
    const rows = filteredMapByYearRows(year);
    const total = d3.sum(rows, d => d[selectedMetric]);
    result.push({ year, value: total || 0 });
  });
  return result;
}

function aggregateByProvince(filterYear) {
  const rows = filteredMapByYearRows(filterYear);
  const grouped = d3.rollup(
    rows,
    v => d3.sum(v, d => d[selectedMetric]),
    d => d.regionNormalized
  );

  const result = [];
  provinceNameSet.forEach(name => {
    const v = grouped.get(name) || 0;
    result.push({ province: name, value: v });
  });
  return result;
}


// -------------------------------------------------------------------
// 9) MAP (CHOROPLETH + LEGEND + SUBTITLE)
// -------------------------------------------------------------------
function updateMap() {
  const provinceValues = aggregateByProvince(selectedYear);
  const maxVal = d3.max(provinceValues, d => d.value) || 0;

  const interp = selectedMetric === "cases" ? d3.interpolateGreens : d3.interpolatePurples;
  const color = d3.scaleSequential()
    .domain([0, maxVal || 1])
    .interpolator(interp);

  const valueByProvince = new Map(
    provinceValues.map(d => [d.province, d.value])
  );

  const featureSelection = mapSvg.selectAll("path.map-province")
    .data(geojson.features, d => d.properties.PRUID);

  // Draw/update provinces
  featureSelection.enter()
    .append("path")
    .attr("class", "map-province")
    .attr("d", path)
    .merge(featureSelection)
    .attr("fill", d => {
      const pname = d.properties.PRENAME;
      const v = valueByProvince.get(pname) || 0;
      return v > 0 ? color(v) : "#e5e7eb";
    })
    .on("mousemove", (event, d) => {
      const pname = d.properties.PRENAME;
      const v = valueByProvince.get(pname) || 0;

      const metricLabel = selectedMetric === "cases" ? "Cases" : "Loss";

      tooltip
        .style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(
          `<strong>${pname}</strong><br>` +
          `${metricLabel}: ${formatMetricValue(v, selectedMetric)}`
        );
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    });

  featureSelection.exit().remove();

  // Province labels
  mapSvg.selectAll("text.region-label")
    .data(geojson.features)
    .enter()
    .append("text")
    .attr("class", "region-label")
    .text(d => d.properties.PREABBR)
    .attr("transform", d => {
      const [x, y] = path.centroid(d);
      return `translate(${x}, ${y})`;
    })
    .attr("text-anchor", "middle")
    .attr("alignment-baseline", "middle")
    .style("font-size", "1em")
    .style("font-weight", "bold")
    .style("fill", "#fff")
    .style("stroke", "#333")
    .style("stroke-width", "2px")
    .style("paint-order", "stroke")
    .style("stroke-linejoin", "round")
    .style("pointer-events", "none");

  // Legend labels
  d3.select("#legendLabel").text(
    selectedMetric === "cases" ? "Cases" : "Loss"
  );
  d3.select("#legendMin").text("0");
  d3.select("#legendMax").text(formatMetricValue(maxVal || 0, selectedMetric));

  // Legend gradient background
  const gradEl = d3.select("#mapLegendGradient");
  if (maxVal === 0) {
    gradEl.style("background", "linear-gradient(to right, #e5e7eb, #e5e7eb)");
  } else {
    const stops = [0, 0.25, 0.5, 0.75, 1].map(t => interp(t));
    const grad = `linear-gradient(to right, ${stops.join(",")})`;
    gradEl.style("background", grad);
  }

  // Subtitle: metric / filters
  const genderText = selectedGender === "ALL" ? "All genders" : `Gender: ${selectedGender}`;
  const ageText = selectedAge === "ALL" ? "All age ranges" : `Age: ${selectedAge}`;
  const yearText = selectedYear == null ? "All years" : `Year: ${selectedYear}`;

  d3.select("#mapSubtitle").text(`${yearText} · ${genderText} · ${ageText}`);
}


// -------------------------------------------------------------------
// 10) TREND CHART (YEARLY CASES/LOSS)
// -------------------------------------------------------------------
function updateTrendChart() {
  trendSvg.selectAll("*").remove();

  const margin = { top: 8, right: 18, bottom: 24, left: 42 };
  const innerWidth = trendWidth - margin.left - margin.right;
  const innerHeight = trendHeight - margin.top - margin.bottom;

  const trendColor = selectedMetric === "cases" ? greenColor : purpleColor;

  const g = trendSvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const data = aggregateByYear();
  const maxVal = d3.max(data, d => d.value) || 0;

  const x = d3.scalePoint()
    .domain(data.map(d => d.year))
    .range([0, innerWidth])
    .padding(0.5);

  const y = d3.scaleLinear()
    .domain([0, maxVal || 1])
    .nice()
    .range([innerHeight, 0]);

  const xAxis = d3.axisBottom(x).tickFormat(d3.format("d"));
  const yAxis = d3.axisLeft(y)
    .ticks(4)
    .tickFormat(v => formatMetricValue(v, selectedMetric));

  g.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(xAxis);

  g.append("g")
    .attr("class", "axis y-axis")
    .call(yAxis);

  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.value));

  g.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr("stroke", trendColor)
    .attr("stroke-width", 2)
    .attr("d", line);

  g.selectAll("circle.line-point")
    .data(data)
    .enter()
    .append("circle")
    .attr("class", d => "line-point" + (selectedYear === d.year ? " selected" : ""))
    .attr("cx", d => x(d.year))
    .attr("cy", d => y(d.value))
    .attr("r", 3)
    .attr("fill", trendColor)
    .attr("stroke", "white")
    .attr("stroke-width", 1)
    .on("mousemove", (event, d) => {
      tooltip
        .style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(
          `<strong>${d.year}</strong><br>` +
          `${selectedMetric === "cases" ? "Cases" : "Loss"}: ${formatMetricValue(d.value, selectedMetric)}`
        );
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    })
    .on("click", (event, d) => {
      selectedYear = d.year;
      d3.select("#allYearsBtn").classed("active", false);
      updateAll();
    });
}


// -------------------------------------------------------------------
// 11) BAR CHART (TOP PROVINCES)
// -------------------------------------------------------------------
function updateBarChart() {
  barSvg.selectAll("*").remove();

  const margin = { top: 4, right: 20, bottom: 20, left: 110 };
  const innerWidth = barWidth - margin.left - margin.right;
  const innerHeight = barHeight - margin.top - margin.bottom;

  const barColor = selectedMetric === "cases" ? greenColor : purpleColor;

  const g = barSvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const data = aggregateByProvince(selectedYear)
    .filter(d => d.value > 0)
    .sort((a, b) => d3.descending(a.value, b.value))
    .slice(0, 10); // top 10

  const maxVal = d3.max(data, d => d.value) || 0;

  const y = d3.scaleBand()
    .domain(data.map(d => d.province))
    .range([0, innerHeight])
    .padding(0.22);

  const x = d3.scaleLinear()
    .domain([0, maxVal || 1])
    .range([0, innerWidth])
    .nice();

  const yAxis = d3.axisLeft(y);
  const xAxis = d3.axisBottom(x)
    .ticks(4)
    .tickFormat(v => formatMetricValue(v, selectedMetric));

  g.append("g")
    .attr("class", "axis y-axis")
    .call(yAxis);

  g.append("g")
    .attr("class", "axis x-axis")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(xAxis);

  const bars = g.selectAll("rect.bar")
    .data(data, d => d.province);

  bars.enter()
    .append("rect")
    .attr("class", "bar")
    .attr("x", 0)
    .attr("y", d => y(d.province))
    .attr("height", y.bandwidth())
    .attr("width", d => x(d.value))
    .attr("fill", barColor)
    .on("mousemove", (event, d) => {
      tooltip
        .style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(
          `<strong>${d.province}</strong><br>` +
          `${selectedMetric === "cases" ? "Cases" : "Loss"}: ${formatMetricValue(d.value, selectedMetric)}`
        );
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    });

  bars.exit().remove();
}


// -------------------------------------------------------------------
// 12) GENDER DONUT CHART
// -------------------------------------------------------------------
function updateGenderChart() {
  genderG.selectAll("*").remove();

  // 1) Filter data
  const rows = fraudData.mapByYear.filter(d => {
    if (!d.regionNormalized) return false;
    if (selectedYear != null && d.year !== selectedYear) return false;
    if (selectedAge !== "ALL" && d.ageRange !== selectedAge) return false;
    return true;
  });

  const grouped = d3.rollup(
    rows,
    v => d3.sum(v, d => d[selectedMetric]),
    d => d.gender
  );

  const data = Array.from(grouped)
    .filter(d => d[0] !== "ALL")
    .sort((a, b) => b[1] - a[1]);

  const total = d3.sum(data, d => d[1]);

  // 2) Colors (match age chart)
  const color = d3.scaleOrdinal()
    .domain(data.map(d => d[0]))
    .range(d3.schemeSet3);

  // 3) Pie layout
  const pie = d3.pie().value(d => d[1]).sort(null);
  const data_ready = pie(data);

  // 4) Arcs
  const arc = d3.arc()
    .innerRadius(genderRadius * 0.5)
    .outerRadius(genderRadius * 0.8);

  const outerArc = d3.arc()
    .innerRadius(genderRadius * 0.9)
    .outerRadius(genderRadius * 0.9);

  // 5) Label positions + basic collision resolution
  const textHeight = 14;

  const labels = data_ready.map(d => {
    const posA = arc.centroid(d);
    const posB = outerArc.centroid(d);
    const posC = outerArc.centroid(d);
    const midAngle = d.startAngle + (d.endAngle - d.startAngle) / 2;
    const isRight = midAngle < Math.PI;

    posC[0] = genderRadius * 0.99 * (isRight ? 1 : -1);

    return { d, posA, posB, posC, isRight };
  });

  function relax(group) {
    group.sort((a, b) => a.posC[1] - b.posC[1]);
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1];
      const curr = group[i];
      if (curr.posC[1] < prev.posC[1] + textHeight) {
        curr.posC[1] = prev.posC[1] + textHeight;
      }
    }
  }

  const rightLabels = labels.filter(l => l.isRight);
  const leftLabels = labels.filter(l => !l.isRight);
  relax(rightLabels);
  relax(leftLabels);

  const allLabels = [...rightLabels, ...leftLabels];

  // 6) Slices
  genderG.selectAll("path")
    .data(data_ready)
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", d => color(d.data[0]))
    .attr("stroke", d => d.data[0] === selectedGender ? "white" : "none")
    .style("stroke-width", "2px")
    .style("cursor", "pointer")
    .attr("opacity", d => {
      if (selectedGender === "ALL") return 0.7;
      return d.data[0] === selectedGender ? 1.0 : 0.3;
    })
    .on("click", (event, d) => {
      const clickedGender = d.data[0];
      if (selectedGender === clickedGender) {
        selectedGender = "ALL";
        d3.select("#allGendersBtn").classed("active", true);
      } else {
        selectedGender = clickedGender;
        d3.select("#allGendersBtn").classed("active", false);
      }
      updateAll();
    })
    .on("mousemove", (event, d) => {
      const percent = total > 0 ? (d.data[1] / total * 100).toFixed(1) + "%" : "0%";

      tooltip
        .style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(
          `<strong>${d.data[0]}</strong><br>` +
          `${selectedMetric === "cases" ? "Cases" : "Loss"}: ${formatMetricValue(d.data[1], selectedMetric)}<br>` +
          `Share: ${percent}`
        );
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    });

  // 7) Polylines
  genderG.selectAll("polyline")
    .data(allLabels)
    .enter()
    .append("polyline")
    .attr("stroke", "white")
    .style("fill", "none")
    .attr("stroke-width", 1)
    .attr("opacity", l => {
      if (selectedGender === "ALL") return 1;
      return l.d.data[0] === selectedGender ? 1 : 0.2;
    })
    .attr("points", l => [l.posA, l.posB, l.posC]);

  // 8) Labels
  genderG.selectAll("text")
    .data(allLabels)
    .enter()
    .append("text")
    .text(l => l.d.data[0])
    .attr("transform", l => `translate(${l.posC})`)
    .style("text-anchor", l => l.isRight ? "start" : "end")
    .style("font-size", "0.8em")
    .style("fill", "white")
    .style("opacity", l => {
      if (selectedGender === "ALL") return 1;
      return l.d.data[0] === selectedGender ? 1 : 0.2;
    })
    .on("mousemove", (event, l) => {
      const d = l.d;
      const percent = total > 0 ? (d.data[1] / total * 100).toFixed(1) + "%" : "0%";

      tooltip
        .style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(
          `<strong>${d.data[0]}</strong><br>` +
          `${selectedMetric === "cases" ? "Cases" : "Loss"}: ${formatMetricValue(d.data[1], selectedMetric)}<br>` +
          `Share: ${percent}`
        );
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    });
}


// -------------------------------------------------------------------
// 13) AGE DONUT CHART
// -------------------------------------------------------------------
function updateAgeChart() {
  donutG.selectAll("*").remove();

  // 1) Filter data
  const rows = fraudData.mapByYear.filter(d => {
    if (!d.regionNormalized) return false;
    if (selectedYear != null && d.year !== selectedYear) return false;
    if (selectedGender !== "ALL" && d.gender !== selectedGender) return false;
    return true;
  });

  const grouped = d3.rollup(
    rows,
    v => d3.sum(v, d => d[selectedMetric]),
    d => d.ageRange
  );

  const data = Array.from(grouped)
    .filter(d => d[0] !== "ALL")
    .sort((a, b) => metaAgeRanges.indexOf(a[0]) - metaAgeRanges.indexOf(b[0]));

  const total = d3.sum(data, d => d[1]);

  // 2) Colors (match gender chart)
  const color = d3.scaleOrdinal()
    .domain(data.map(d => d[0]))
    .range(d3.schemeSet3);

  // 3) Pie layout
  const pie = d3.pie()
    .sort(null)
    .value(d => d[1]);

  const data_ready = pie(data);

  // 4) Arcs
  const arc = d3.arc()
    .innerRadius(donutRadius * 0.5)
    .outerRadius(donutRadius * 0.8);

  const outerArc = d3.arc()
    .innerRadius(donutRadius * 0.9)
    .outerRadius(donutRadius * 0.9);

  // 5) Label positions + basic collision resolution
  const textHeight = 14;

  const labels = data_ready.map(d => {
    const posA = arc.centroid(d);
    const posB = outerArc.centroid(d);
    const posC = outerArc.centroid(d);

    const midAngle = d.startAngle + (d.endAngle - d.startAngle) / 2;
    const isRight = midAngle < Math.PI;

    posC[0] = donutRadius * 0.99 * (isRight ? 1 : -1);

    return { d, posA, posB, posC, isRight };
  });

  function relax(group) {
    group.sort((a, b) => a.posC[1] - b.posC[1]);
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1];
      const curr = group[i];
      if (curr.posC[1] < prev.posC[1] + textHeight) {
        curr.posC[1] = prev.posC[1] + textHeight;
      }
    }
  }

  const rightLabels = labels.filter(l => l.isRight);
  const leftLabels = labels.filter(l => !l.isRight);
  relax(rightLabels);
  relax(leftLabels);

  const allLabels = [...rightLabels, ...leftLabels];

  // 6) Slices
  donutG.selectAll("allSlices")
    .data(data_ready)
    .enter()
    .append("path")
    .attr("d", arc)
    .attr("fill", d => color(d.data[0]))
    .attr("opacity", d => {
      if (selectedAge === "ALL") return 0.7;
      return d.data[0] === selectedAge ? 1.0 : 0.3;
    })
    .attr("stroke", d => d.data[0] === selectedAge ? "white" : "none")
    .attr("stroke-width", "2px")
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      const clickedAge = d.data[0];

      if (selectedAge === clickedAge) {
        selectedAge = "ALL";
        d3.select("#allAgesBtn").classed("active", true);
      } else {
        selectedAge = clickedAge;
        d3.select("#allAgesBtn").classed("active", false);
      }
      updateAll();
    })
    .on("mousemove", (event, d) => {
      const percent = total > 0 ? (d.data[1] / total * 100).toFixed(1) + "%" : "0%";

      tooltip
        .style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(
          `<strong>${d.data[0]}</strong><br>` +
          `${selectedMetric === "cases" ? "Cases" : "Loss"}: ${formatMetricValue(d.data[1], selectedMetric)}<br>` +
          `Share: ${percent}`
        );
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    });

  // 7) Polylines
  donutG.selectAll("allPolylines")
    .data(allLabels)
    .enter()
    .append("polyline")
    .attr("stroke", "white")
    .style("fill", "none")
    .attr("stroke-width", 1)
    .attr("opacity", l => {
      if (selectedAge === "ALL") return 1;
      return l.d.data[0] === selectedAge ? 1 : 0.2;
    })
    .attr("points", l => [l.posA, l.posB, l.posC]);

  // 8) Labels
  donutG.selectAll("allLabels")
    .data(allLabels)
    .enter()
    .append("text")
    .text(l => l.d.data[0])
    .attr("transform", l => `translate(${l.posC})`)
    .style("text-anchor", l => l.isRight ? "start" : "end")
    .style("font-size", "0.8em")
    .style("fill", "white")
    .style("opacity", l => {
      if (selectedAge === "ALL") return 1;
      return l.d.data[0] === selectedAge ? 1 : 0.2;
    })
    .on("mousemove", (event, l) => {
      const d = l.d;
      const percent = total > 0 ? (d.data[1] / total * 100).toFixed(1) + "%" : "0%";

      tooltip
        .style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(
          `<strong>${d.data[0]}</strong><br>` +
          `${selectedMetric === "cases" ? "Cases" : "Loss"}: ${formatMetricValue(d.data[1], selectedMetric)}<br>` +
          `Share: ${percent}`
        );
    })
    .on("mouseleave", () => {
      tooltip.style("display", "none");
    });
}


// -------------------------------------------------------------------
// 14) WINDOW RESIZE HANDLING (REDRAW ALL)
// -------------------------------------------------------------------
window.addEventListener("resize", () => {
  // Map
  const mapContainer = document.getElementById("mapContainer");
  mapWidth = mapContainer.clientWidth;
  mapHeight = mapContainer.clientHeight;
  mapSvg.attr("width", mapWidth).attr("height", mapHeight);
  projection.fitSize([mapWidth, mapHeight], geojson);

  // Trend
  const trendParent = trendSvg.node().parentElement;
  trendWidth = trendParent.clientWidth;
  trendHeight = trendParent.clientHeight;
  trendSvg.attr("width", trendWidth).attr("height", trendHeight);

  // Bar
  const barParent = barSvg.node().parentElement;
  barWidth = barParent.clientWidth;
  barHeight = barParent.clientHeight;
  barSvg.attr("width", barWidth).attr("height", barHeight);

  // Gender & Age donuts (recompute radius)
  const genderParent = genderSvg.node().parentElement;
  const donutParent = donutSvg.node().parentElement;

  genderWidth = genderParent.clientWidth;
  genderHeight = genderParent.clientHeight;

  donutWidth = donutParent.clientWidth;
  donutHeight = donutParent.clientHeight;

  const margin = 40;
  const possibleRadiusGender = Math.min(genderWidth, genderHeight) / 2 - margin;
  const possibleRadiusAge = Math.min(donutWidth, donutHeight) / 2 - margin;
  const commonRadius = Math.min(possibleRadiusGender, possibleRadiusAge);

  genderRadius = commonRadius;
  donutRadius = commonRadius;

  genderSvg.attr("width", genderWidth).attr("height", genderHeight);
  genderG.attr("transform", `translate(${genderWidth / 2},${genderHeight / 2})`);

  donutSvg.attr("width", donutWidth).attr("height", donutHeight);
  donutG.attr("transform", `translate(${donutWidth / 2},${donutHeight / 2})`);

  // Redraw everything with new geometry
  updateAll();
});
