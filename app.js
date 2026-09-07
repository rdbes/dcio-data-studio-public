import {
  formatMetric,
  formatNumber,
  groupSum,
  numeric,
  sumBy,
  yearOf,
} from "./data_utils.mjs";

const METRICS = {
  value_loss_php: { label: "Value loss", shortLabel: "Value", unit: "PHP" },
  area_affected_ha: { label: "Area affected", shortLabel: "Area", unit: "HA" },
  production_loss_mt: { label: "Production loss", shortLabel: "Volume", unit: "MT" },
};

const NAVIGATION = [
  ["/dashboard/", "Dashboard", "▦"],
  ["/analytics/", "Analytics", "↗"],
  ["/incidents/", "Incidents", "▲"],
  ["/tropical-cyclone-tracks/", "TC Tracks", "↝"],
];

const state = {
  data: null,
  metric: "value_loss_php",
  year: "all",
  sector: "all",
  incident: "all",
  sidebarOpen: true,
};

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function currentView() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/dashboard";
  return NAVIGATION.find(([href]) => href.replace(/\/+$/, "") === path)?.[0]
    || "/dashboard/";
}

function currentPageLabel() {
  return NAVIGATION.find(([href]) => href === currentView())?.[1] || "Dashboard";
}

function navigate(event) {
  const link = event.target.closest("a[data-nav]");
  if (!link) return;
  event.preventDefault();
  window.history.pushState({}, "", link.href);
  render();
}

function releaseUrl(dataUrl) {
  if (
    typeof dataUrl !== "string"
    || !/^\d{4}-\d{2}-\d{2}\.json$/.test(dataUrl)
  ) {
    throw new Error("The release manifest contains an unsafe data URL.");
  }
  return `/data/releases/${encodeURIComponent(dataUrl)}`;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure browser cryptography is required to verify releases.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function loadRelease() {
  const manifestResponse = await fetch("/data/releases/current.json", {
    cache: "no-store",
  });
  if (!manifestResponse.ok) throw new Error("The current release is unavailable.");
  const manifest = await manifestResponse.json();
  if (manifest.read_only !== true || !manifest.release_version) {
    throw new Error("The current release manifest is not read-only.");
  }
  if (!["1.0.0", "1.1.0"].includes(manifest.schema_version)) {
    throw new Error("The current release uses an unsupported schema version.");
  }
  if (
    manifest.schema_version === "1.1.0"
    && (!Number.isInteger(manifest.byte_size) || !/^[a-f0-9]{64}$/.test(manifest.sha256 || ""))
  ) {
    throw new Error("The current release manifest is missing integrity metadata.");
  }
  const releaseResponse = await fetch(releaseUrl(manifest.data_url), {
    cache: "force-cache",
  });
  if (!releaseResponse.ok) throw new Error("The immutable release is unavailable.");
  const bytes = await releaseResponse.arrayBuffer();
  if (manifest.sha256 && (await sha256Hex(bytes)) !== manifest.sha256) {
    throw new Error("The release checksum does not match its manifest.");
  }
  if (manifest.byte_size !== undefined && manifest.byte_size !== bytes.byteLength) {
    throw new Error("The release byte size does not match its manifest.");
  }
  const release = JSON.parse(new TextDecoder().decode(bytes));
  if (
    release.read_only !== true
    || release.schema_version !== manifest.schema_version
    || release.release_version !== manifest.release_version
  ) {
    throw new Error("The release and manifest are inconsistent.");
  }
  return { manifest, release };
}

function filteredReports() {
  return state.data.damage_reports.filter((row) => (
    (state.year === "all" || yearOf(row.incident_start_date) === state.year)
    && (state.sector === "all" || row.main_sector === state.sector)
    && (state.incident === "all" || row.incident_key === state.incident)
  ));
}

function filterOptions() {
  const sectors = [...new Set(state.data.damage_reports.map((row) => row.main_sector))]
    .filter(Boolean)
    .sort();
  const incidents = state.data.incidents
    .slice()
    .sort((left, right) => (right.incident_start_date || "").localeCompare(left.incident_start_date || ""));
  const years = [...new Set(state.data.damage_reports.map((row) => yearOf(row.incident_start_date)))]
    .filter((year) => year !== "Unknown")
    .sort((left, right) => right.localeCompare(left));
  return { sectors, incidents, years };
}

function filterBar() {
  const { sectors, incidents, years } = filterOptions();
  return `<div class="topbar-filters" aria-label="Public data filters">
    <label><span>Year</span><select id="year-filter">
      <option value="all">All years</option>
      ${years.map((year) => `<option value="${year}" ${state.year === year ? "selected" : ""}>${year}</option>`).join("")}
    </select></label>
    <label><span>Sector</span><select id="sector-filter">
      <option value="all">All sectors</option>
      ${sectors.map((sector) => `<option value="${escapeHtml(sector)}" ${state.sector === sector ? "selected" : ""}>${escapeHtml(sector)}</option>`).join("")}
    </select></label>
    <label class="topbar-filter-wide"><span>Incident</span><select id="incident-filter">
      <option value="all">All incidents</option>
      ${incidents.map((incident) => `<option value="${escapeHtml(incident.incident_key)}" ${state.incident === incident.incident_key ? "selected" : ""}>${escapeHtml(incident.incident_name)}</option>`).join("")}
    </select></label>
  </div>`;
}

function bindFilters() {
  document.querySelector("#year-filter")?.addEventListener("change", (event) => {
    state.year = event.target.value;
    render();
  });
  document.querySelector("#sector-filter")?.addEventListener("change", (event) => {
    state.sector = event.target.value;
    render();
  });
  document.querySelector("#incident-filter")?.addEventListener("change", (event) => {
    state.incident = event.target.value;
    render();
  });
  document.querySelectorAll("[data-chart-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      state.metric = button.dataset.chartMetric;
      render();
    });
  });
  document.querySelector("#sidebar-toggle")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    render();
  });
}

function kpi(label, value, detail = "", tone = "") {
  return `<article class="kpi ${tone ? `kpi--${tone}` : ""}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
  </article>`;
}

function cardHeader(eyebrow, title, detail = "") {
  return `<div class="card-header">
    <div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2></div>
    ${detail ? `<span class="muted">${escapeHtml(detail)}</span>` : ""}
  </div>`;
}

function chartFooter(metric = state.metric) {
  return `<div class="dashboard-chart-footer" aria-label="Chart metric selector">
    <div class="dashboard-metric-switcher">
      ${Object.entries(METRICS).map(([key, item]) => `<button type="button" data-chart-metric="${key}" class="dashboard-metric-option ${metric === key ? "is-active" : ""}" aria-pressed="${metric === key}">${item.shortLabel}</button>`).join("")}
    </div>
  </div>`;
}

function bars(title, entries, metric = state.metric, detail = "") {
  const visible = entries.slice(0, 8);
  const max = Math.max(...visible.map((item) => item.value), 1);
  return `<article class="ui-main-card dashboard-chart-card">
    <div class="dashboard-chart-header">${cardHeader("Distribution", title, detail)}</div>
    <div class="chart-body"><div class="bars">
      ${visible.length ? visible.map((item) => `<div class="bar-row">
        <span title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
        <div class="bar-track"><svg viewBox="0 0 100 10" role="img" aria-label="${escapeHtml(formatMetric(item.value, metric))}"><rect class="bar-fill" width="${Math.max(2, (item.value / max) * 100)}" height="10"></rect></svg></div>
        <b>${escapeHtml(formatMetric(item.value, metric))}</b>
      </div>`).join("") : `<p class="empty">No records match these filters.</p>`}
    </div></div>${chartFooter(metric)}
  </article>`;
}

function donutSvg(entries, metric) {
  const visible = entries.slice(0, 7);
  const total = sumBy(visible, "value");
  const circumference = 263.893;
  let offset = 0;
  const segments = total > 0 ? visible.map((entry, index) => {
    const length = (entry.value / total) * circumference;
    const segment = `<circle class="donut-segment segment-${index}" cx="50" cy="50" r="42" stroke-dasharray="${length} ${circumference}" stroke-dashoffset="${-offset}" aria-label="${escapeHtml(entry.label)} ${formatNumber((entry.value / total) * 100, { maximumFractionDigits: 1 })}%"></circle>`;
    offset += length;
    return segment;
  }).join("") : "";
  return `<div class="donut-layout">
    <div class="donut-visual">
      <svg viewBox="0 0 100 100" role="img" aria-label="${escapeHtml(METRICS[metric].label)} distribution">
        <circle class="donut-track" cx="50" cy="50" r="42"></circle>
        <g transform="rotate(-90 50 50)">${segments}</g>
        <text class="donut-total" x="50" y="47" text-anchor="middle">${escapeHtml(formatNumber(total))}</text>
        <text class="donut-unit" x="50" y="57" text-anchor="middle">${escapeHtml(METRICS[metric].unit)}</text>
      </svg>
    </div>
    <div class="donut-legend">
      ${visible.length ? visible.map((entry, index) => `<div class="legend-row">
        <span class="legend-swatch segment-${index}" aria-hidden="true"></span>
        <span class="legend-label" title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>
        <b>${escapeHtml(formatNumber((entry.value / total) * 100, { maximumFractionDigits: 1 }))}%</b>
      </div>`).join("") : `<p class="empty">No records match these filters.</p>`}
    </div>
  </div>`;
}

function donut(title, entries, metric = state.metric, detail = "") {
  return `<article class="ui-main-card dashboard-chart-card">
    <div class="dashboard-chart-header">${cardHeader("Share", title, detail)}</div>
    <div class="chart-body chart-body--donut">${donutSvg(entries, metric)}</div>
    ${chartFooter(metric)}
  </article>`;
}

function lineSvg(entries, metric, compact = false) {
  const visible = entries.filter((entry) => entry.label !== "Unknown");
  if (!visible.length) return `<p class="empty">No annual values are available.</p>`;
  const width = compact ? 440 : 680;
  const height = compact ? 92 : 220;
  const inset = compact ? 8 : 18;
  const max = Math.max(...visible.map((entry) => entry.value), 1);
  const points = visible.map((entry, index) => {
    const x = inset + (index / Math.max(visible.length - 1, 1)) * (width - inset * 2);
    const y = height - inset - (entry.value / max) * (height - inset * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = visible[0]?.label || "";
  const last = visible.at(-1)?.label || "";
  return `<div class="line-chart">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(METRICS[metric].label)} annual trend">
      <line class="chart-grid-line" x1="${inset}" y1="${inset}" x2="${width - inset}" y2="${inset}"></line>
      <line class="chart-grid-line" x1="${inset}" y1="${height / 2}" x2="${width - inset}" y2="${height / 2}"></line>
      <line class="chart-grid-line" x1="${inset}" y1="${height - inset}" x2="${width - inset}" y2="${height - inset}"></line>
      <polyline class="line-data" points="${points}"></polyline>
    </svg>
    <div class="line-labels"><span>${escapeHtml(first)}</span><span>${escapeHtml(last)}</span></div>
  </div>`;
}

function annualSeries(reports, metric) {
  return groupSum(
    reports
      .map((row) => ({ ...row, year: yearOf(row.incident_start_date) }))
      .filter((row) => row.year !== "Unknown"),
    "year",
    metric,
  ).sort((left, right) => left.label.localeCompare(right.label));
}

function annualSummary(reports) {
  const rows = annualSeries(reports, "value_loss_php")
    .slice()
    .sort((left, right) => right.label.localeCompare(left.label))
    .slice(0, 12)
    .map((item) => {
      const yearRows = reports.filter((row) => yearOf(row.incident_start_date) === item.label);
      return `<tr><th scope="row">${escapeHtml(item.label)}</th><td class="is-numeric">${escapeHtml(formatMetric(item.value, "value_loss_php"))}</td><td class="is-numeric">${escapeHtml(formatMetric(sumBy(yearRows, "area_affected_ha"), "area_affected_ha"))}</td><td class="is-numeric">${formatNumber(yearRows.length)}</td></tr>`;
    }).join("");
  return `<article class="ui-main-card annual-summary-card">${cardHeader("Reported years", "Annual Summary", `${formatNumber(reports.length)} rows`)}
    <div class="report-table-wrap"><table class="report-table"><thead><tr><th scope="col">Year</th><th scope="col" class="is-numeric">Value loss</th><th scope="col" class="is-numeric">Area</th><th scope="col" class="is-numeric">Rows</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty">No records match these filters.</td></tr>`}</tbody></table></div>
  </article>`;
}

function annualTrends(reports) {
  return `<article class="ui-main-card annual-trends-card">${cardHeader("Reference trends", "Annual Trends", "Reported totals")}
    <div class="trend-stack">
      ${["area_affected_ha", "production_loss_mt", "value_loss_php"].map((metric) => `<div class="trend-item"><span>${escapeHtml(METRICS[metric].label)} (${escapeHtml(METRICS[metric].unit)})</span>${lineSvg(annualSeries(reports, metric), metric, true)}</div>`).join("")}
    </div>
  </article>`;
}

function periodBlocks(reports) {
  const starts = [...new Set(reports.map((row) => Number(yearOf(row.incident_start_date))).filter(Number.isFinite))]
    .map((year) => Math.floor(year / 5) * 5);
  const unique = [...new Set(starts)].sort((left, right) => left - right);
  const five = unique.slice(-5).map((start) => ({ start, end: start + 4 }));
  return { historical: five.slice(0, 4), five };
}

function periodMetric(reports, start, end, metric) {
  const matches = reports.filter((row) => {
    const year = Number(yearOf(row.incident_start_date));
    return Number.isFinite(year) && year >= start && year <= end;
  });
  const total = sumBy(matches, metric);
  const years = new Set(matches.map((row) => yearOf(row.incident_start_date))).size;
  return { total, average: years ? total / years : 0 };
}

function periodTable(title, periods, reports) {
  const metrics = ["area_affected_ha", "production_loss_mt", "value_loss_php"];
  return `<article class="ui-main-card period-card"><div class="section-card-header"><h2>${escapeHtml(title)}</h2></div>
    <div class="report-table-wrap"><table class="report-table report-table--period-comparison"><colgroup><col><col><col><col></colgroup><thead><tr><th scope="col">Period</th>${metrics.map((metric) => `<th scope="col" class="is-numeric">${escapeHtml(METRICS[metric].label)} (${escapeHtml(METRICS[metric].unit)})</th>`).join("")}</tr></thead><tbody>
      ${periods.map(({ start, end }) => `<tr><th scope="row" class="period-comparison-label"><div>${start}–${end}</div><small>${formatNumber(end - start + 1)} years</small></th>${metrics.map((metric) => { const item = periodMetric(reports, start, end, metric); return `<td class="is-numeric"><div class="period-metric"><span>Total ${escapeHtml(formatNumber(item.total))}</span><strong>Avg ${escapeHtml(formatNumber(item.average))}</strong></div></td>`; }).join("")}</tr>`).join("") || `<tr><td colspan="4" class="empty">No five-year periods are available.</td></tr>`}
    </tbody></table></div>
  </article>`;
}

function topIncidents(reports) {
  const grouped = new Map();
  for (const row of reports) {
    const item = grouped.get(row.incident_key) || { name: row.incident_name, rows: 0, area: 0, volume: 0, value: 0 };
    item.rows += 1;
    item.area += numeric(row.area_affected_ha);
    item.volume += numeric(row.production_loss_mt);
    item.value += numeric(row.value_loss_php);
    grouped.set(row.incident_key, item);
  }
  return [...grouped.values()].sort((left, right) => right.value - left.value).slice(0, 10);
}

function reportTable(reports) {
  return `<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Incident</th><th>Location</th><th>Sector</th><th class="is-numeric">Value loss</th><th class="is-numeric">Area</th></tr></thead><tbody>${reports.length ? reports.map((row) => `<tr><td>${escapeHtml(row.incident_name)}</td><td>${escapeHtml(row.province_huc_name || row.region_name || "Unknown")}</td><td>${escapeHtml(row.main_sector)}</td><td class="is-numeric">${escapeHtml(formatMetric(row.value_loss_php, "value_loss_php"))}</td><td class="is-numeric">${escapeHtml(formatMetric(row.area_affected_ha, "area_affected_ha"))}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">No records match these filters.</td></tr>`}</tbody></table></div>`;
}

function dashboard() {
  const reports = filteredReports();
  const value = sumBy(reports, "value_loss_php");
  const area = sumBy(reports, "area_affected_ha");
  const volume = sumBy(reports, "production_loss_mt");
  const incidentCount = new Set(reports.map((row) => row.incident_key)).size;
  const { historical, five } = periodBlocks(reports);
  const topRows = topIncidents(reports).map((row, index) => `<tr><td class="rank">${index + 1}</td><td>${escapeHtml(row.name)}</td><td class="is-numeric">${formatNumber(row.rows)}</td><td class="is-numeric">${escapeHtml(formatMetric(row.area, "area_affected_ha"))}</td><td class="is-numeric">${escapeHtml(formatMetric(row.volume, "production_loss_mt"))}</td><td class="is-numeric">${escapeHtml(formatMetric(row.value, "value_loss_php"))}</td></tr>`).join("");
  return `<section class="scope-banner"><div><p class="eyebrow">Approved historical snapshot</p><h2>Damage and loss overview</h2><p>Read-only public data from the approved release. Use the controls in the workspace bar to narrow the view.</p></div><div class="scope-meta"><span>Release ${escapeHtml(state.data.release_version)}</span><span>Before ${escapeHtml(state.data.data_cutoff)}</span></div></section>
    <section class="kpis">
      ${kpi("Incidents represented", formatNumber(incidentCount), "Current filters", "blue")}
      ${kpi("Damage report rows", formatNumber(reports.length), "Current filters")}
      ${kpi("Value loss", formatMetric(value, "value_loss_php"), "PHP total", "red")}
      ${kpi("Area affected", formatMetric(area, "area_affected_ha"), "HA total", "green")}
      ${kpi("Production loss", formatMetric(volume, "production_loss_mt"), "MT total", "amber")}
    </section>
    <section class="dashboard-summary-grid">${annualSummary(reports)}${annualTrends(reports)}</section>
    <section class="dashboard-period-grid">${periodTable("Historical Period Averages", historical, reports)}${periodTable("Five-Year Period Averages", five, reports)}</section>
    <section class="dashboard-chart-grid">
      ${bars("Value loss by region", groupSum(reports, "region_name", state.metric), state.metric, "Top 8 regions")}
      ${donut("Value loss by commodity", groupSum(reports, "level_2_group", state.metric), state.metric, "Top 7 commodity groups")}
      ${bars("Value loss by month", groupSum(reports.map((row) => ({ ...row, month: row.incident_start_date?.slice(5, 7) || "Unknown" })), "month", state.metric), state.metric, "Reported month")}
      ${donut("Value loss by hazard", groupSum(reports, "hazard_type", state.metric), state.metric, "Top 7 hazard types")}
    </section>
    <section class="ui-main-card top-incidents-card">${cardHeader("Ranked records", "Top 10 Incidents by Value Loss", `${formatNumber(topIncidents(reports).length)} shown`)}<div class="report-table-wrap"><table class="report-table"><thead><tr><th></th><th>Incident name</th><th class="is-numeric">Rows</th><th class="is-numeric">Area</th><th class="is-numeric">Volume</th><th class="is-numeric">Value</th></tr></thead><tbody>${topRows || `<tr><td colspan="6" class="empty">No records match these filters.</td></tr>`}</tbody></table></div></section>`;
}

function analytics() {
  const reports = filteredReports();
  const annual = annualSeries(reports, state.metric);
  const rows = annual.slice().reverse().map((item) => `<tr><th scope="row">${escapeHtml(item.label)}</th><td class="is-numeric">${escapeHtml(formatMetric(item.value, state.metric))}</td><td class="is-numeric">${formatNumber(reports.filter((row) => yearOf(row.incident_start_date) === item.label).length)}</td></tr>`).join("");
  return `<section class="ui-main-card analytics-card">${cardHeader("Time series", `Annual ${METRICS[state.metric].label.toLowerCase()}`, `Source cutoff ${state.data.data_cutoff}`)}
    <div class="analytics-line-chart">${lineSvg(annual, state.metric)}</div>
    <div class="report-table-wrap"><table class="report-table"><thead><tr><th>Year</th><th class="is-numeric">Metric</th><th class="is-numeric">Rows</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="empty">No records match these filters.</td></tr>`}</tbody></table></div>
  </section>`;
}

function incidents() {
  const reportCounts = new Map();
  for (const row of state.data.damage_reports) {
    const entry = reportCounts.get(row.incident_key) || { count: 0, value: 0 };
    entry.count += 1;
    entry.value += numeric(row.value_loss_php);
    reportCounts.set(row.incident_key, entry);
  }
  const rows = state.data.incidents.map((incident) => {
    const entry = reportCounts.get(incident.incident_key) || { count: 0, value: 0 };
    return `<tr><td>${escapeHtml(incident.incident_name)}</td><td>${escapeHtml(incident.hazard_type)}</td><td>${escapeHtml(incident.incident_start_date || "—")}</td><td class="is-numeric">${formatNumber(entry.count)}</td><td class="is-numeric">${escapeHtml(formatMetric(entry.value, "value_loss_php"))}</td></tr>`;
  }).join("");
  return `<section class="ui-main-card module-card">${cardHeader("Catalogue", "Historical incidents", `${formatNumber(state.data.incidents.length)} incidents`)}<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Incident</th><th>Hazard</th><th>Start</th><th class="is-numeric">Report rows</th><th class="is-numeric">Value loss</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No incidents are in this release.</td></tr>`}</tbody></table></div></section>`;
}

function cycloneTracks() {
  const pointCounts = new Map();
  for (const point of state.data.tropical_cyclone_track_points) {
    pointCounts.set(point.cyclone_key, (pointCounts.get(point.cyclone_key) || 0) + 1);
  }
  const rows = state.data.tropical_cyclones.map((cyclone) => `<tr><td>${escapeHtml(cyclone.cyclone_name || "Unnamed cyclone")}</td><td>${escapeHtml(cyclone.international_name || "—")}</td><td>${escapeHtml(cyclone.occurrence_year)}</td><td>${escapeHtml(cyclone.peak_intensity || "—")}</td><td class="is-numeric">${formatNumber(pointCounts.get(cyclone.cyclone_key) || 0)}</td></tr>`).join("");
  return `<section class="ui-main-card module-card">${cardHeader("Catalogue", "Tropical cyclone tracks", `${formatNumber(state.data.tropical_cyclone_track_points.length)} track points`)}<div class="report-table-wrap"><table class="report-table"><thead><tr><th>Name</th><th>International name</th><th>Year</th><th>Peak intensity</th><th class="is-numeric">Track points</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No cyclone tracks are in this release.</td></tr>`}</tbody></table></div></section>`;
}

function shell(content) {
  const view = currentView();
  const dataView = view === "/dashboard/" || view === "/analytics/";
  const generatedDate = new Date(state.data.generated_at).toLocaleDateString("en-PH");
  return `<div class="app-shell ${state.sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}">
    <aside class="sidebar" aria-label="DCIO Data Studio navigation">
      <div class="sidebar-inner">
        <div class="sidebar-brand"><a href="/dashboard/" data-nav aria-label="DCIO Data Studio"><span class="sidebar-brand-mark">D</span><span class="sidebar-brand-text"><strong>DCIO</strong> <span>Data Studio</span></span></a></div>
        <nav aria-label="Primary modules">${NAVIGATION.map(([href, label, icon]) => `<a href="${href}" data-nav class="sidebar-link ${view === href ? "active" : ""}" ${view === href ? "aria-current=\"page\"" : ""}><span class="sidebar-nav-icon" aria-hidden="true">${icon}</span><span class="sidebar-link-label">${escapeHtml(label)}</span></a>`).join("")}</nav>
        <div class="sidebar-note"><strong>Public release</strong><span>Read-only workspace</span><span>Release ${escapeHtml(state.data.release_version)}</span></div>
      </div>
    </aside>
    <div class="workspace">
      <header class="workspace-topbar">
        <div class="workspace-topbar-leading"><button type="button" id="sidebar-toggle" class="sidebar-toggle" aria-label="${state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}" title="${state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}">${state.sidebarOpen ? "‹" : "›"}</button><div class="workspace-breadcrumb"><span>DCIO Data Studio</span><span aria-hidden="true">/</span><strong>${escapeHtml(currentPageLabel())}</strong></div></div>
        ${dataView ? filterBar() : `<span class="workspace-mode">PUBLIC READ ONLY</span>`}
      </header>
      <main id="main-content" class="page-body"><div class="page-content">
        <div class="page-heading"><div><p class="eyebrow">Public read-only workspace</p><h1>${escapeHtml(currentPageLabel())}</h1></div><span class="updated">Generated ${escapeHtml(generatedDate)}</span></div>
        ${content}
      </div></main>
      <footer class="footer">Public read-only release · Source: ${escapeHtml(state.data.source)}</footer>
    </div>
  </div>`;
}

function render() {
  if (!state.data) return;
  const view = currentView();
  const content = view === "/analytics/"
    ? analytics()
    : view === "/incidents/"
      ? incidents()
      : view === "/tropical-cyclone-tracks/"
        ? cycloneTracks()
        : dashboard();
  app.innerHTML = shell(content);
  bindFilters();
}

function renderError(error) {
  app.innerHTML = `<main class="error-state"><p class="eyebrow">Release unavailable</p><h1>Public data could not be loaded.</h1><p>${escapeHtml(error.message)}</p><p class="muted">Contact the data steward if this persists. The portal stops here when the release cannot be verified.</p></main>`;
}

document.addEventListener("click", navigate);
window.addEventListener("popstate", render);
loadRelease()
  .then(({ release }) => {
    state.data = release;
    render();
  })
  .catch(renderError);
