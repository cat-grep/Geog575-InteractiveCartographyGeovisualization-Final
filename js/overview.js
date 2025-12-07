// -------------------------
    // Global state
    // -------------------------
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

    const tooltip = d3.select("#tooltip");

    // -------------------------
    // Utility: formatters
    // -------------------------
    const formatInt = d3.format(",.0f");
    const formatDollar = d3.format("$,");  // no decimals

    function formatMetricValue(value, metric) {
      if (!value || !isFinite(value)) return "0";
      if (metric === "loss") {
        return formatDollar(value);
      } else {
        return formatInt(value);
      }
    }

    // -------------------------
    // Load data
    // -------------------------
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

    // -------------------------
    // Preprocess data
    // -------------------------
    function preprocessData() {
      // Normalize region names; keep only Canadian provinces in the boundary file
      const provinceMap = new Map();
      provinceNameSet.forEach(name => {
        provinceMap.set(name.toLowerCase(), name);
      });

      function normalizeRegion(raw) {
        // console.log("Normalizing region:", raw);
        if (!raw) return null;
        let candidate = raw;

        if (raw === "Newfoundland And Labrador") {
          candidate = "Newfoundland and Labrador";
        } else if (raw === "North West Territories" || raw === "Northwest Territories") {
          candidate = "Northwest Territories";
        }

        const lower = candidate.toLowerCase();
        for (const full of provinceNameSet) {
          if (full.toLowerCase() === lower) {
            return full;
          }
        }
        // not a Canadian province in this boundary file
        return null;
      }

      fraudData.mapByYear.forEach(d => {
        d.cases = +d.cases;
        d.loss = +d.loss;
        d.regionNormalized = normalizeRegion(d.region);
      });
    }

    // -------------------------
    // Controls
    // -------------------------
    function initControls() {
      const genderSelect = d3.select("#genderSelect");
      genderSelect.selectAll("option")
        .data(["ALL"].concat(metaGenders))
        .enter()
        .append("option")
        .attr("value", d => d)
        .text(d => d);

      const ageSelect = d3.select("#ageSelect");
      ageSelect.selectAll("option")
        .data(["ALL"].concat(metaAgeRanges))
        .enter()
        .append("option")
        .attr("value", d => d)
        .text(d => d);

      const yearSlider = document.getElementById("yearSlider");
      const minYear = d3.min(metaYears);
      const maxYear = d3.max(metaYears);
      yearSlider.min = minYear;
      yearSlider.max = maxYear;
      yearSlider.step = 1;
      yearSlider.value = maxYear;

      updateYearLabel();

      // Metric radio
      d3.selectAll("input[name='metric']").on("change", function() {
        selectedMetric = this.value;
        updateAll();
      });

      // Gender
      genderSelect.on("change", function() {
        selectedGender = this.value;
        updateAll();
      });

      // Age
      ageSelect.on("change", function() {
        selectedAge = this.value;
        updateAll();
      });

      // Year slider (single-year mode)
      yearSlider.addEventListener("input", function() {
        const val = +this.value;
        selectedYear = val;
        d3.select("#allYearsBtn").classed("active", false);
        updateYearLabel();
        updateAll();
      });

      // All years button
      const allYearsBtn = document.getElementById("allYearsBtn");
      allYearsBtn.addEventListener("click", function() {
        selectedYear = null;
        this.classList.add("active");
        updateYearLabel();
        updateAll();
      });
    }

    function updateYearLabel() {
      const yearLabel = document.getElementById("yearLabel");
      yearLabel.textContent = selectedYear == null ? "All years" : selectedYear;
    }

    // -------------------------
    // SVG and layout setup
    // -------------------------
    function initSVGs() {
      // Map
      const mapContainer = document.getElementById("mapContainer");
      mapWidth = mapContainer.clientWidth;
      mapHeight = mapContainer.clientHeight;

      mapSvg = d3.select("#map")
        .attr("width", mapWidth)
        .attr("height", mapHeight);

      projection = d3.geoConicConformal()
                .parallels([49, 77])
                .center([-91.52, 56])
                .rotate([110, 27, 43])
                .scale(700)
                .translate([mapWidth / 2, mapHeight / 2]);
      path = d3.geoPath().projection(projection);

      // Trend chart
      const trendContainer = document.getElementById("trendChartContainer");
      trendWidth = trendContainer.clientWidth - 8;
      trendHeight = trendContainer.clientHeight - 28;

      trendSvg = d3.select("#trendChart")
        .attr("width", trendWidth)
        .attr("height", trendHeight);

      // Bar chart
      const barContainer = document.getElementById("barChartContainer");
      barWidth = barContainer.clientWidth - 8;
      barHeight = barContainer.clientHeight - 26;

      barSvg = d3.select("#barChart")
        .attr("width", barWidth)
        .attr("height", barHeight);
    }

    // -------------------------
    // Update pipeline
    // -------------------------
    function updateAll() {
      updateMap();
      updateTrendChart();
      updateBarChart();
    }

    // -------------------------
    // Data helpers
    // -------------------------
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

    // -------------------------
    // Map
    // -------------------------
    function updateMap() {
      const provinceValues = aggregateByProvince(selectedYear);
      const maxVal = d3.max(provinceValues, d => d.value) || 0;

      const interp = selectedMetric === "cases" ? d3.interpolateBlues : d3.interpolateReds;
      const color = d3.scaleSequential()
        .domain([0, maxVal || 1])
        .interpolator(interp);

      const valueByProvince = new Map(
        provinceValues.map(d => [d.province, d.value])
      );
      console.log("Province values:", valueByProvince);

      const featureSelection = mapSvg.selectAll("path.map-province")
        .data(geojson.features, d => d.properties.PRUID);

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

          const yearText = selectedYear == null ? "All years" : selectedYear;
          const metricLabel = selectedMetric === "cases" ? "Cases" : "Loss";

          tooltip
            .style("display", "block")
            .style("left", (event.clientX + 12) + "px")
            .style("top", (event.clientY + 12) + "px")
            .html(
              `<strong>${pname}</strong><br>` +
              `${yearText}<br>` +
              `${metricLabel}: ${formatMetricValue(v, selectedMetric)}`
            );
        })
        .on("mouseleave", () => {
          tooltip.style("display", "none");
        });

      featureSelection.exit().remove();

      // Legend
      d3.select("#legendLabel").text(
        selectedMetric === "cases" ? "Cases (per province)" : "Loss ($, per province)"
      );
      d3.select("#legendMin").text("0");
      d3.select("#legendMax").text(formatMetricValue(maxVal || 0, selectedMetric));

      // Update legend gradient to match the color interpolator used on the map
      const gradEl = d3.select('#mapLegendGradient');
      if (maxVal === 0) {
        gradEl.style('background', 'linear-gradient(to right, #e5e7eb, #e5e7eb)');
      } else {
        const stops = [0, 0.25, 0.5, 0.75, 1].map(t => interp(t));
        const grad = `linear-gradient(to right, ${stops.join(',')})`;
        gradEl.style('background', grad);
      }

      // Titles
      const genderText = selectedGender === "ALL" ? "All genders" : `Gender: ${selectedGender}`;
      const ageText = selectedAge === "ALL" ? "All age ranges" : `Age: ${selectedAge}`;
      const yearText = selectedYear == null ? "All years" : `Year: ${selectedYear}`;

      d3.select("#mapTitleMetric").text(
        selectedMetric === "cases" ? "Metric: Cases" : "Metric: Monetary loss"
      );
      d3.select("#mapSubtitle").text(`${yearText} · ${genderText} · ${ageText}`);
    }

    // -------------------------
    // Trend chart
    // -------------------------
    function updateTrendChart() {
      trendSvg.selectAll("*").remove();

      const margin = { top: 8, right: 18, bottom: 24, left: 42 };
      const innerWidth = trendWidth - margin.left - margin.right;
      const innerHeight = trendHeight - margin.top - margin.bottom;

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
      const yAxis = d3.axisLeft(y).ticks(4)
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
        .attr("stroke", "#1d4ed8")
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
        .attr("fill", "#1d4ed8")
        .attr("stroke", "white")
        .attr("stroke-width", 1)
        .on("mousemove", (event, d) => {
          tooltip
            .style("display", "block")
            .style("left", (event.clientX + 12) + "px")
            .style("top", (event.clientY + 12) + "px")
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
          document.getElementById("yearSlider").value = d.year;
          updateYearLabel();
          updateAll();
        });
    }

    // -------------------------
    // Bar chart (regions)
    // -------------------------
    function updateBarChart() {
      barSvg.selectAll("*").remove();

      const margin = { top: 4, right: 20, bottom: 20, left: 110 };
      const innerWidth = barWidth - margin.left - margin.right;
      const innerHeight = barHeight - margin.top - margin.bottom;

      const g = barSvg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const data = aggregateByProvince(selectedYear)
        .filter(d => d.value > 0)
        .sort((a, b) => d3.descending(a.value, b.value))
        .slice(0, 8); // top 8

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
        .attr("fill", "#60a5fa")
        .on("mousemove", (event, d) => {
          tooltip
            .style("display", "block")
            .style("left", (event.clientX + 12) + "px")
            .style("top", (event.clientY + 12) + "px")
            .html(
              `<strong>${d.province}</strong><br>` +
              `${selectedMetric === "cases" ? "Cases" : "Loss"}: ${formatMetricValue(d.value, selectedMetric)}`
            );
        })
        .on("mouseleave", () => {
          tooltip.style("display", "none");
        });

      bars.exit().remove();

      const yearText = selectedYear == null ? "All years" : `Year ${selectedYear}`;
      d3.select("#barSubtitle").text(
        `${yearText} · Metric: ${selectedMetric === "cases" ? "Cases" : "Loss"} · Top provinces`
      );
    }