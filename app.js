import {
  csvValue,
  formatMetric,
  formatNumber,
  groupSum,
  numeric,
  sumBy,
  yearOf,
} from "./data_utils.mjs";

const METRICS = {
  value_loss_php: { label: "Value loss", shortLabel: "Value loss" },
  area_affected_ha: { label: "Area affected", shortLabel: "Area" },
  production_loss_mt: { label: "Production loss", shortLabel: "Volume" },
};
const NAVIGATION = [
  ["/dashboard/", "Dashboard"],
  ["/analytics/", "Analytics"],
  ["/incidents/", "Incidents"],
  ["/tropical-cyclone-tracks/", "TC Tracks"],
  ["/report-generation/", "Report generation"],
];

const state = {
  data: null,
  metric: "value_loss_php",
  sector: "all",
  incident: "all",
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
    (state.sector === "all" || row.main_sector === state.sector)
    && (state.incident === "all" || row.incident_key === state.incident)
  ));
}

function metricOptions() {
  return Object.entries(METRICS)
    .map(([value, item]) => (
      `<option value="${value}" ${state.metric === value ? "selected" : ""}>${item.label}</option>`
    ))
    .join("");
}

function filters() {
  const sectors = [...new Set(state.data.damage_reports.map((row) => row.main_sector))]
    .filter(Boolean)
    .sort();
  const incidents = state.data.incidents
    .slice()
    .sort((left, right) => (right.incident_start_date || "").localeCompare(left.incident_start_date || ""));
  return `
    <section class="filters" aria-label="Data filters">
      <label>Metric <select id="metric-filter">${metricOptions()}</select></label>
      <label>Sector <select id="sector-filter">
        <option value="all">All sectors</option>
        ${sectors.map((sector) => `<option value="${escapeHtml(sector)}" ${state.sector === sector ? "selected" : ""}>${escapeHtml(sector)}</option>`).join("")}
      </select></label>
      <label>Incident <select id="incident-filter">
        <option value="all">All incidents</option>
        ${incidents.map((incident) => `<option value="${escapeHtml(incident.incident_key)}" ${state.incident === incident.incident_key ? "selected" : ""}>${escapeHtml(incident.incident_name)}</option>`).join("")}
      </select></label>
    </section>`;
}

function bindFilters() {
  document.querySelector("#metric-filter")?.addEventListener("change", (event) => {
    state.metric = event.target.value;
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
}

function kpi(label, value, detail = "") {
  return `<article class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</article>`;
}

function bars(title, entries, metric = state.metric) {
  const visible = entries.slice(0, 8);
  const max = Math.max(...visible.map((item) => item.value), 1);
  return `<section class="card chart-card"><div class="card-heading"><div><p class="eyebrow">Distribution</p><h2>${escapeHtml(title)}</h2></div></div><div class="bars">${visible.length ? visible.map((item) => `<div class="bar-row"><span title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span><div class="bar-track"><svg viewBox="0 0 100 10" role="img" aria-label="${escapeHtml(formatMetric(item.value, metric))}"><rect class="bar-fill" width="${Math.max(2, (item.value / max) * 100)}" height="10"></rect></svg></div><b>${escapeHtml(formatMetric(item.value, metric))}</b></div>`).join("") : `<p class="empty">No records match these filters.</p>`}</div></section>`;
}

function dashboard() {
  const reports = filteredReports();
  const value = sumBy(reports, "value_loss_php");
  const area = sumBy(reports, "area_affected_ha");
  const volume = sumBy(reports, "production_loss_mt");
  const incidentCount = new Set(reports.map((row) => row.incident_key)).size;
  const sectorGroups = groupSum(reports, "main_sector", state.metric);
  const hazardGroups = groupSum(reports, "hazard_category", state.metric);
  return `${filters()}<section class="kpis">
    ${kpi("Incidents represented", formatNumber(incidentCount), state.data.release_version)}
    ${kpi("Damage report rows", formatNumber(reports.length))}
    ${kpi("Value loss", formatMetric(value, "value_loss_php"))}
    ${kpi("Area affected", formatMetric(area, "area_affected_ha"))}
    ${kpi("Production loss", formatMetric(volume, "production_loss_mt"))}
  </section><section class="grid-two">${bars(`By sector · ${METRICS[state.metric].shortLabel}`, sectorGroups)}${bars(`By hazard category · ${METRICS[state.metric].shortLabel}`, hazardGroups)}</section>
  <section class="card"><div class="card-heading"><div><p class="eyebrow">Ranked records</p><h2>Largest filtered losses</h2></div><span class="muted">${formatNumber(reports.length)} rows</span></div>${reportTable(reports.slice().sort((a, b) => numeric(b[state.metric]) - numeric(a[state.metric])).slice(0, 12))}</section>`;
}

function analytics() {
  const reports = filteredReports();
  const annual = groupSum(reports.map((row) => ({ ...row, year: yearOf(row.incident_start_date) })), "year", state.metric)
    .sort((left, right) => left.label.localeCompare(right.label));
  const rows = annual.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(formatMetric(item.value, state.metric))}</td><td>${formatNumber(reports.filter((row) => yearOf(row.incident_start_date) === item.label).length)}</td></tr>`).join("");
  return `${filters()}<section class="card"><div class="card-heading"><div><p class="eyebrow">Time series</p><h2>Annual ${escapeHtml(METRICS[state.metric].label.toLowerCase())}</h2></div><span class="muted">Source cutoff ${escapeHtml(state.data.data_cutoff)}</span></div>${bars("Annual trend", annual)}<div class="table-wrap"><table><thead><tr><th>Year</th><th>Metric</th><th>Rows</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="empty">No records match these filters.</td></tr>`}</tbody></table></div></section>`;
}

function reportTable(reports) {
  return `<div class="table-wrap"><table><thead><tr><th>Incident</th><th>Location</th><th>Sector</th><th>Value loss</th><th>Area</th></tr></thead><tbody>${reports.length ? reports.map((row) => `<tr><td>${escapeHtml(row.incident_name)}</td><td>${escapeHtml(row.province_huc_name || row.region_name || "Unknown")}</td><td>${escapeHtml(row.main_sector)}</td><td>${escapeHtml(formatMetric(row.value_loss_php, "value_loss_php"))}</td><td>${escapeHtml(formatMetric(row.area_affected_ha, "area_affected_ha"))}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">No records match these filters.</td></tr>`}</tbody></table></div>`;
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
    return `<tr><td>${escapeHtml(incident.incident_name)}</td><td>${escapeHtml(incident.hazard_type)}</td><td>${escapeHtml(incident.incident_start_date || "—")}</td><td>${formatNumber(entry.count)}</td><td>${escapeHtml(formatMetric(entry.value, "value_loss_php"))}</td></tr>`;
  }).join("");
  return `<section class="card"><div class="card-heading"><div><p class="eyebrow">Catalogue</p><h2>Historical incidents</h2></div><span class="muted">${formatNumber(state.data.incidents.length)} incidents</span></div><div class="table-wrap"><table><thead><tr><th>Incident</th><th>Hazard</th><th>Start</th><th>Report rows</th><th>Value loss</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No incidents are in this release.</td></tr>`}</tbody></table></div></section>`;
}

function cycloneTracks() {
  const pointCounts = new Map();
  for (const point of state.data.tropical_cyclone_track_points) {
    pointCounts.set(point.cyclone_key, (pointCounts.get(point.cyclone_key) || 0) + 1);
  }
  const rows = state.data.tropical_cyclones.map((cyclone) => `<tr><td>${escapeHtml(cyclone.cyclone_name || "Unnamed cyclone")}</td><td>${escapeHtml(cyclone.international_name || "—")}</td><td>${escapeHtml(cyclone.occurrence_year)}</td><td>${escapeHtml(cyclone.peak_intensity || "—")}</td><td>${formatNumber(pointCounts.get(cyclone.cyclone_key) || 0)}</td></tr>`).join("");
  return `<section class="card"><div class="card-heading"><div><p class="eyebrow">Catalogue</p><h2>Tropical cyclone tracks</h2></div><span class="muted">${formatNumber(state.data.tropical_cyclone_track_points.length)} track points</span></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>International name</th><th>Year</th><th>Peak intensity</th><th>Track points</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No cyclone tracks are in this release.</td></tr>`}</tbody></table></div></section>`;
}

function reportGeneration() {
  return `<section class="card report-card"><p class="eyebrow">Client-side export</p><h2>Report generation</h2><p>Download the current public release as a CSV. This export runs in your browser and does not send data to the local data-management application.</p><button class="button" id="download-csv">Download damage report CSV</button><p class="muted">Release ${escapeHtml(state.data.release_version)} · ${formatNumber(state.data.damage_reports.length)} rows</p></section>`;
}

function downloadCsv() {
  const columns = [
    "incident_name", "incident_start_date", "hazard_category", "hazard_type",
    "region_name", "province_huc_name", "commodity_key", "main_sector",
    "area_totally_damaged_ha", "area_partially_damaged_ha", "area_affected_ha",
    "production_loss_mt", "value_loss_php", "affected_farmers_fisherfolk_count",
  ];
  const rows = [columns, ...state.data.damage_reports.map((row) => columns.map((column) => row[column]))]
    .map((row) => row.map(csvValue).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([`${rows}\n`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `dcio-public-release-${state.data.release_version}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function shell(content) {
  const view = currentView();
  return `<div class="app-shell"><header class="topbar"><a class="brand" href="/dashboard/" data-nav><span class="brand-mark">D</span><span>DCIO Data Studio<small>Public data portal</small></span></a><span class="read-only">READ ONLY</span></header><div class="layout"><aside class="sidebar"><nav aria-label="Primary navigation">${NAVIGATION.map(([href, label]) => `<a href="${href}" data-nav class="${view === href ? "active" : ""}">${escapeHtml(label)}</a>`).join("")}</nav><div class="sidebar-note"><strong>Release ${escapeHtml(state.data.release_version)}</strong><span>Data before ${escapeHtml(state.data.data_cutoff)}</span></div></aside><main class="main"><div class="page-heading"><div><p class="eyebrow">Approved historical snapshot</p><h1>${escapeHtml(NAVIGATION.find(([href]) => href === view)?.[1] || "Dashboard")}</h1></div><span class="updated">Generated ${escapeHtml(new Date(state.data.generated_at).toLocaleDateString("en-PH"))}</span></div>${content}</main></div><footer class="footer">Public read-only release · Source: ${escapeHtml(state.data.source)}</footer></div>`;
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
        : view === "/report-generation/"
          ? reportGeneration()
          : dashboard();
  app.innerHTML = shell(content);
  bindFilters();
  document.querySelector("#download-csv")?.addEventListener("click", downloadCsv);
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
