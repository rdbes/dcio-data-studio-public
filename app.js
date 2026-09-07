import {
  formatMetric,
  formatNumber,
  groupSum,
  numeric,
  sumBy,
  yearOf,
} from "./data_utils.mjs";

const NAVIGATION = [
  ["/dashboard/", "Dashboard", "fa-square-poll-horizontal", "sidebar-nav-icon--yellow"],
  ["/analytics/", "Analytics", "fa-chart-line", "sidebar-nav-icon--cyan"],
  ["/incidents/", "Incidents", "fa-triangle-exclamation", "sidebar-nav-icon--red"],
  ["/tropical-cyclone-tracks/", "TC Tracks", "fa-route", "sidebar-nav-icon--cyan"],
];

const PUBLIC_SCRIPTS = [
  "/assets/vendor/leaflet/leaflet.js",
  "/assets/vendor/chartjs/chart.umd.js",
  "/assets/js/analytics/chart_presets.js",
  "/assets/js/map_coordinate_grid.js",
  "/assets/js/map_browser_fullscreen.js",
  "/assets/js/maps/map_appearance.js",
  "/assets/js/maps/map_administrative_base.js",
  "/assets/js/maps/map_legend_scale.js",
  "/assets/js/maps/map_overlay_legend.js",
  "/assets/js/maps/map_export.js",
  "/assets/js/maps/map_keyboard_navigation.js",
  "/assets/js/maps/map_dashboard.js",
  "/assets/js/maps/dashboard_analysis_panel.js",
];

const state = {
  data: null,
  year: "all",
  month: "all",
  hazard: "all",
  incident: "all",
  region: "all",
  province: "all",
  commodity: "all",
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

function jsonForScript(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function currentView() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/dashboard";
  return NAVIGATION.find(([href]) => href.replace(/\/+$/, "") === path)?.[0]
    || "/dashboard/";
}

function currentLabel() {
  return NAVIGATION.find(([href]) => href === currentView())?.[1] || "Dashboard";
}

function shortRegionLabel(value) {
  return String(value || "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/^Region\s+/i, "R. ")
    .trim() || "Region";
}

function readFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const key of ["year", "month", "hazard", "incident", "region", "province", "commodity"]) {
    const value = params.get(key);
    if (value) state[key] = value;
  }
}

function releaseUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !/^\d{4}-\d{2}-\d{2}\.json$/.test(dataUrl)) {
    throw new Error("The release manifest contains an unsafe data URL.");
  }
  return `/data/releases/${encodeURIComponent(dataUrl)}`;
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("Secure browser cryptography is required to verify releases.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadRelease() {
  const manifestResponse = await fetch("/data/releases/current.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("The current release is unavailable.");
  const manifest = await manifestResponse.json();
  if (manifest.read_only !== true || !manifest.release_version) throw new Error("The current release manifest is not read-only.");
  if (!["1.0.0", "1.1.0"].includes(manifest.schema_version)) throw new Error("The current release uses an unsupported schema version.");
  if (manifest.schema_version === "1.1.0" && (!Number.isInteger(manifest.byte_size) || !/^[a-f0-9]{64}$/.test(manifest.sha256 || ""))) {
    throw new Error("The current release manifest is missing integrity metadata.");
  }
  const response = await fetch(releaseUrl(manifest.data_url), { cache: "force-cache" });
  if (!response.ok) throw new Error("The immutable release is unavailable.");
  const bytes = await response.arrayBuffer();
  if (manifest.sha256 && (await sha256Hex(bytes)) !== manifest.sha256) throw new Error("The release checksum does not match its manifest.");
  if (manifest.byte_size !== undefined && manifest.byte_size !== bytes.byteLength) throw new Error("The release byte size does not match its manifest.");
  const release = JSON.parse(new TextDecoder().decode(bytes));
  if (release.read_only !== true || release.schema_version !== manifest.schema_version || release.release_version !== manifest.release_version) {
    throw new Error("The release and manifest are inconsistent.");
  }
  return { manifest, release };
}

function filterOptions() {
  const rows = state.data.damage_reports;
  const unique = (values) => [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)));
  const incidents = state.data.incidents.slice().sort((left, right) => (right.incident_start_date || "").localeCompare(left.incident_start_date || ""));
  return {
    years: unique(rows.map((row) => yearOf(row.incident_start_date))).filter((value) => value !== "Unknown").sort((left, right) => right.localeCompare(left)),
    months: [["01", "Jan"], ["02", "Feb"], ["03", "Mar"], ["04", "Apr"], ["05", "May"], ["06", "Jun"], ["07", "Jul"], ["08", "Aug"], ["09", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"]],
    hazards: unique(rows.map((row) => row.hazard_type)),
    incidents,
    regions: unique(rows.map((row) => row.region_name)),
    provinces: unique(rows.map((row) => row.province_huc_name)),
    commodities: unique(rows.map((row) => row.level_2_group)),
  };
}

function selectControl(id, label, options, selected, disabled = false) {
  return `<div><span class="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">${escapeHtml(label)}</span><select id="${id}" data-public-filter="${id.replace("public-", "")}" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal text-zinc-800 shadow-2xs" ${disabled ? "disabled" : ""}><option value="all">All ${escapeHtml(label)}${label.endsWith("s") ? "" : "s"}</option>${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></div>`;
}

function publicFilterPanel() {
  const options = filterOptions();
  const selectedIncident = options.incidents.find((item) => item.incident_key === state.incident);
  const chips = [
    state.year !== "all" ? state.year : "All Years",
    state.month !== "all" ? options.months.find(([value]) => value === state.month)?.[1] : "All Months",
    state.hazard !== "all" ? state.hazard : "All Hazards",
    selectedIncident?.incident_name || (state.incident !== "all" ? state.incident : "All Incidents"),
    state.region !== "all" ? state.region : "All Regions",
    state.province !== "all" ? state.province : "All Provinces",
    state.commodity !== "all" ? state.commodity : "All Commodities",
  ];
  return `<details id="public-filter-panel" data-analytics-filter-panel data-discrete-period-labels="true" class="group relative bg-white border border-zinc-200/80 rounded-xl shadow-xs text-left">
    <summary data-analytics-filter-summary data-map-filter-summary data-topbar-filter-summary class="cursor-pointer select-none list-none px-5 py-2 flex flex-col gap-2 lg:flex-row lg:items-center hover:bg-zinc-50 rounded-xl group-open:rounded-b-none">
      <div class="flex w-full items-center justify-between gap-3 lg:contents"><div class="flex min-w-0 shrink-0 items-center gap-2"><i class="fa-solid fa-filter text-xs text-zinc-500" aria-hidden="true"></i><h2 class="text-sm font-bold text-zinc-900">Select Filters</h2></div><svg class="h-6 w-6 shrink-0 rounded-full border border-zinc-200 bg-zinc-50 p-2 text-zinc-500 transition-transform group-open:rotate-180 group-hover:border-zinc-300 group-hover:bg-white lg:order-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 9-7 7-7-7"></path></svg></div>
      <div data-topbar-filter-chips class="flex min-w-0 flex-wrap items-center gap-2 lg:order-2 lg:flex-1"><span class="sr-only">Active public filters</span>${chips.map((chip) => `<span class="filter-card-pill inline-flex max-w-full items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600"><span class="truncate">${escapeHtml(chip)}</span></span>`).join("")}</div>
    </summary>
    <div class="absolute left-0 right-0 top-full z-50 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-b-xl border-t border-zinc-200/80 bg-white shadow-xl group-open:block xl:max-h-none xl:overflow-visible"><form id="public-filter-form" class="px-4 pb-3 pt-4 space-y-3"><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <div class="space-y-2 lg:border-r lg:border-zinc-100 lg:pr-3"><h3 class="text-xs font-bold text-zinc-400 uppercase tracking-wider">Period</h3>${selectControl("public-year", "Year", options.years.map((value) => [value, value]), state.year)}${selectControl("public-month", "Month", options.months, state.month)}</div>
      <div class="space-y-2 lg:border-r lg:border-zinc-100 lg:pr-3"><h3 class="text-xs font-bold text-zinc-400 uppercase tracking-wider">Hazard</h3>${selectControl("public-hazard", "Hazard Type", options.hazards.map((value) => [value, value]), state.hazard)}${selectControl("public-incident", "Incident", options.incidents.map((item) => [item.incident_key, item.incident_name]), state.incident)}</div>
      <div class="space-y-2 lg:border-r lg:border-zinc-100 lg:pr-3"><h3 class="text-xs font-bold text-zinc-400 uppercase tracking-wider">Location</h3>${selectControl("public-region", "Region", options.regions.map((value) => [value, value]), state.region)}${selectControl("public-province", "Province", options.provinces.map((value) => [value, value]), state.province)}</div>
      <div class="space-y-2"><h3 class="text-xs font-bold text-zinc-400 uppercase tracking-wider">Commodity</h3>${selectControl("public-commodity", "Commodity Group", options.commodities.map((value) => [value, value]), state.commodity)}</div>
    </div></form></div>
  </details>`;
}

function filteredReports() {
  return state.data.damage_reports.filter((row) => (
    (state.year === "all" || yearOf(row.incident_start_date) === state.year)
    && (state.month === "all" || row.incident_start_date?.slice(5, 7) === state.month)
    && (state.hazard === "all" || row.hazard_type === state.hazard)
    && (state.incident === "all" || row.incident_key === state.incident)
    && (state.region === "all" || row.region_name === state.region)
    && (state.province === "all" || row.province_huc_name === state.province)
    && (state.commodity === "all" || row.level_2_group === state.commodity)
  ));
}

function aggregateHazards(reports) {
  const hazards = new Map();
  for (const row of reports) {
    const key = row.hazard_key || row.hazard_type || "UNKNOWN";
    const item = hazards.get(key) || { label: row.hazard_type || row.hazard_category || "Unknown hazard", hazard_key: key, affected_farmers: 0, area_affected: 0, volume_loss: 0, value_loss: 0 };
    item.affected_farmers += numeric(row.affected_farmers_fisherfolk_count);
    item.area_affected += numeric(row.area_affected_ha);
    item.volume_loss += numeric(row.production_loss_mt);
    item.value_loss += numeric(row.value_loss_php);
    hazards.set(key, item);
  }
  return [...hazards.values()].sort((left, right) => right.value_loss - left.value_loss);
}

function publicMapData(reports) {
  const locationByKey = new Map(state.data.locations.map((item) => [item.psgc_key, item]));
  const provinceLocationByIdentity = new Map();
  for (const location of state.data.locations) {
    if (location.geographic_level === "PROVINCE") provinceLocationByIdentity.set(`${location.region_name}|${location.province_huc_name}`, location);
  }
  const provinces = new Map();
  const commodityMaps = new Map();
  const hazardsByArea = new Map();
  const unmapped = new Map();
  const addMetric = (target, row) => {
    target.affected_farmers += numeric(row.affected_farmers_fisherfolk_count);
    target.area_affected += numeric(row.area_affected_ha);
    target.volume_loss += numeric(row.production_loss_mt);
    target.value_loss += numeric(row.value_loss_php);
    target.record_count += 1;
  };
  for (const row of reports) {
    const location = locationByKey.get(row.location_psgc_key);
    const region = row.region_name || location?.region_name || "Unspecified Region";
    const province = row.province_huc_name || location?.province_huc_name || "";
    const provinceLocation = provinceLocationByIdentity.get(`${region}|${province}`);
    const areaCode = provinceLocation?.psgc_code || "";
    const commodity = row.level_2_group || row.commodity_key || "Unknown commodity";
    const hazardKey = row.hazard_key || row.hazard_type || "UNKNOWN";
    if (!areaCode) {
      const key = `${region}|${commodity}|${hazardKey}`;
      const target = unmapped.get(key) || { label: commodity, region_name: region, hazard_key: hazardKey, hazard_label: row.hazard_type || "Unknown hazard", affected_farmers: 0, area_affected: 0, volume_loss: 0, value_loss: 0 };
      target.affected_farmers += numeric(row.affected_farmers_fisherfolk_count);
      target.area_affected += numeric(row.area_affected_ha);
      target.volume_loss += numeric(row.production_loss_mt);
      target.value_loss += numeric(row.value_loss_php);
      unmapped.set(key, target);
      continue;
    }
    const target = provinces.get(areaCode) || { province_name: province || "Unspecified Reporting Area", region_name: region, short_region_label: shortRegionLabel(region), psgc_key: provinceLocation?.psgc_key || `PH${areaCode}`, psgc_code: areaCode, correspondence_code: provinceLocation?.correspondence_code || "", metric_value: 0, record_count: 0, affected_farmers: 0, area_affected: 0, volume_loss: 0, value_loss: 0 };
    addMetric(target, row);
    provinces.set(areaCode, target);
    const commodityMap = commodityMaps.get(areaCode) || new Map();
    const commodityTarget = commodityMap.get(commodity) || { label: commodity, affected_farmers: 0, area_affected: 0, volume_loss: 0, value_loss: 0 };
    commodityTarget.affected_farmers += numeric(row.affected_farmers_fisherfolk_count);
    commodityTarget.area_affected += numeric(row.area_affected_ha);
    commodityTarget.volume_loss += numeric(row.production_loss_mt);
    commodityTarget.value_loss += numeric(row.value_loss_php);
    commodityMap.set(commodity, commodityTarget);
    commodityMaps.set(areaCode, commodityMap);
    const areaHazards = hazardsByArea.get(areaCode) || { all: new Map(), commodities: new Map() };
    const hazardTarget = areaHazards.all.get(hazardKey) || { label: row.hazard_type || "Unknown hazard", hazard_key: hazardKey, affected_farmers: 0, area_affected: 0, volume_loss: 0, value_loss: 0 };
    hazardTarget.affected_farmers += numeric(row.affected_farmers_fisherfolk_count);
    hazardTarget.area_affected += numeric(row.area_affected_ha);
    hazardTarget.volume_loss += numeric(row.production_loss_mt);
    hazardTarget.value_loss += numeric(row.value_loss_php);
    areaHazards.all.set(hazardKey, hazardTarget);
    const commodityHazards = areaHazards.commodities.get(commodity) || new Map();
    const commodityHazardTarget = commodityHazards.get(hazardKey) || { ...hazardTarget, affected_farmers: 0, area_affected: 0, volume_loss: 0, value_loss: 0 };
    commodityHazardTarget.affected_farmers += numeric(row.affected_farmers_fisherfolk_count);
    commodityHazardTarget.area_affected += numeric(row.area_affected_ha);
    commodityHazardTarget.volume_loss += numeric(row.production_loss_mt);
    commodityHazardTarget.value_loss += numeric(row.value_loss_php);
    commodityHazards.set(hazardKey, commodityHazardTarget);
    areaHazards.commodities.set(commodity, commodityHazards);
    hazardsByArea.set(areaCode, areaHazards);
  }
  const provinceRows = [...provinces.values()].map((province) => ({ ...province, metric_value: province.value_loss, commodities: [...(commodityMaps.get(province.psgc_code) || new Map()).values()] })).sort((left, right) => right.metric_value - left.metric_value);
  const serializeHazardMap = (map) => [...map.values()].sort((left, right) => right.value_loss - left.value_loss);
  const serializedHazards = Object.fromEntries([...hazardsByArea.entries()].map(([key, value]) => [key, { all: serializeHazardMap(value.all), commodities: Object.fromEntries([...value.commodities.entries()].map(([label, rows]) => [label, serializeHazardMap(rows)])) }]));
  const totals = {
    value: sumBy(reports, "value_loss_php"),
    volume: sumBy(reports, "production_loss_mt"),
    area: sumBy(reports, "area_affected_ha"),
    farmers: sumBy(reports, "affected_farmers_fisherfolk_count"),
  };
  const metrics = {
    value: { label: "Value Loss", prefix: "PHP ", suffix: "", format: "integer", province_field: "value_loss", total: totals.value },
    volume: { label: "Production Loss", prefix: "", suffix: " MT", format: "decimal", province_field: "volume_loss", total: totals.volume },
    area: { label: "Area Affected", prefix: "", suffix: " ha", format: "decimal", province_field: "area_affected", total: totals.area },
    farmers: { label: "Affected Farmers/Fisherfolk", prefix: "", suffix: "", format: "integer", province_field: "affected_farmers", total: totals.farmers },
  };
  return {
    data: { provinces: provinceRows, max_metric_value: Math.max(...provinceRows.map((row) => row.metric_value), 0), unmapped_commodities: [...unmapped.values()], hazards: aggregateHazards(reports), hazards_by_area: serializedHazards, tropical_cyclone_tracks: [], tropical_cyclone_operational_tracks: [] },
    config: { metric_key: "value", metric_label: metrics.value.label, metric_prefix: metrics.value.prefix, metric_suffix: metrics.value.suffix, metric_format: metrics.value.format, metrics, period_label: state.year === "all" ? "All available years" : state.year, commodity_label: state.commodity === "all" ? "All Commodities" : state.commodity, hazard_label: state.hazard === "all" ? "" : state.hazard, hazard_key: state.hazard === "all" ? "" : state.hazard, incident_label: state.incident === "all" ? "" : state.data.incidents.find((item) => item.incident_key === state.incident)?.incident_name || state.incident, show_tropical_cyclone_track_layer: false, show_operational_tropical_cyclone_track_layer: false, tropical_cyclone_incident_selected: false, reset_extent_on_width_change: true, location_label: state.province !== "all" ? state.province : state.region !== "all" ? state.region : "National", region_options: [...new Set(reports.map((row) => row.region_name).filter(Boolean))].map((value) => ({ value, label: shortRegionLabel(value) })), base_region_name: state.region === "all" ? "" : state.region, base_province_code: "", metric_total: totals.value, record_count: reports.length, province_count: provinceRows.length },
  };
}

function mapCanvas() {
  return `<section data-map-canvas-card class="ui-main-card relative h-[32rem] overflow-visible border border-zinc-200/80 bg-white text-left shadow-xs lg:h-auto lg:min-h-0"><div class="relative h-full min-h-0"><div id="ph-map" class="h-full min-h-0 w-full overflow-hidden bg-sky-50" data-map-root role="application" aria-label="Province damage and loss map"></div><div data-map-coordinate-labels class="add-map-coordinate-labels" aria-hidden="true"></div><div data-map-control-rail class="absolute left-2.5 top-2.5 z-[1000] flex flex-col items-start gap-1"><div data-map-primary-controls class="flex flex-col gap-1"><button id="map-fullscreen" type="button" class="ui-icon-button ui-map-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-zinc-500 backdrop-blur-sm hover:bg-white hover:text-zinc-700" aria-label="Expand map to browser window" title="Expand map to browser window"><i data-map-fullscreen-icon class="fa-solid fa-expand text-xs" aria-hidden="true"></i></button><button id="map-reset-view" type="button" class="ui-icon-button ui-map-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-zinc-500 backdrop-blur-sm hover:bg-white hover:text-zinc-700" aria-label="Reset map extent" title="Reset map extent"><i data-map-reset-icon class="fa-solid fa-location-crosshairs text-xs" aria-hidden="true"></i></button><div data-map-zoom-controls class="add-map-zoom-controls" role="group" aria-label="Map zoom controls"><button id="map-zoom-in" type="button" class="ui-icon-button ui-map-icon-button inline-flex h-7 w-7 items-center justify-center bg-transparent text-zinc-500 hover:bg-white" aria-label="Zoom in" title="Zoom in"><i class="fa-solid fa-plus text-xs" aria-hidden="true"></i></button><button id="map-zoom-out" type="button" class="ui-icon-button ui-map-icon-button inline-flex h-7 w-7 items-center justify-center bg-transparent text-zinc-500 hover:bg-white" aria-label="Zoom out" title="Zoom out"><i class="fa-solid fa-minus text-xs" aria-hidden="true"></i></button></div></div><div data-map-metric-control class="add-map-metric-control"><button id="map-metric-toggle" type="button" class="ui-icon-button ui-map-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-xs text-zinc-500 backdrop-blur-sm hover:bg-white" aria-label="Choose map metric" aria-controls="map-metric-panel" aria-expanded="false" title="Choose map metric"><i class="fa-solid fa-chart-simple text-xs" aria-hidden="true"></i></button><div id="map-metric-panel" class="add-map-metric-panel hidden" data-map-control-popover="metric" role="dialog" aria-label="Map metric selection"><div class="add-map-metric-panel__heading">Map metric</div><div class="add-map-metric-options" role="radiogroup" aria-label="Map display metric"><button type="button" data-map-metric-option="value" class="add-map-metric-option" role="radio" aria-checked="true"><span>Value</span></button><button type="button" data-map-metric-option="volume" class="add-map-metric-option" role="radio" aria-checked="false"><span>Volume</span></button><button type="button" data-map-metric-option="area" class="add-map-metric-option" role="radio" aria-checked="false"><span>Area</span></button></div></div></div><div data-map-style-control class="add-map-style-control relative"><button id="map-style-toggle" type="button" class="ui-icon-button ui-map-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-xs text-zinc-500 backdrop-blur-sm hover:bg-white" aria-label="Customize map appearance" aria-controls="map-style-panel" aria-expanded="false" title="Customize map appearance"><i class="fa-solid fa-circle-half-stroke text-xs" aria-hidden="true"></i></button><div id="map-style-panel" class="add-map-style-panel hidden absolute" data-map-control-popover="style" role="dialog" aria-label="Map color settings"></div></div><button id="map-copy-image" type="button" class="ui-icon-button ui-map-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-xs text-zinc-500 backdrop-blur-sm hover:bg-white" aria-label="Copy visible map as image" title="Copy visible map as image"><i class="fa-regular fa-copy text-xs" aria-hidden="true"></i></button><button id="map-download-image" type="button" class="ui-icon-button ui-map-icon-button inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/80 text-xs text-zinc-500 backdrop-blur-sm hover:bg-white" aria-label="Download visible map as PNG" title="Download visible map as PNG"><i class="fa-solid fa-download text-xs" aria-hidden="true"></i></button></div><div id="map-overview-wrap" class="pointer-events-none invisible absolute right-3 top-3 z-[500] h-36 w-28 overflow-hidden rounded-lg opacity-0 shadow-sm" role="img" aria-label="Philippines reference map showing the current map extent" aria-hidden="true"><div id="ph-map-overview" class="h-full w-full"></div></div><div data-map-cartography class="pointer-events-none absolute bottom-3 right-3 z-[500] flex w-24 flex-col items-center text-sky-500" aria-label="Map orientation and scale"><div data-map-north-arrow class="flex flex-col items-center" role="img" aria-label="North arrow"><span class="text-xs font-normal leading-none">N</span><svg class="h-7 w-6" viewBox="0 0 64 76" fill="none" aria-hidden="true"><circle cx="32" cy="43" r="23" stroke="#ffffff" stroke-width="3"></circle><path d="M32 5 53 68 32 53 11 68 32 5Z" fill="currentColor" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"></path><path d="M32 5V53L11 68 32 5Z" fill="#ffffff"></path></svg></div><div id="map-scale-host" class="add-map-scale-host mt-1 w-full" aria-label="Metric map scale"><span class="add-map-crs-label">EPSG:3857 · WGS 84</span></div></div></div><div id="map-fallback" class="absolute bottom-4 left-1/2 z-[550] hidden -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 shadow-sm">Map library or GeoJSON could not load.</div></section>`;
}

function chartCard(chartKey, title, titleId, subtitleId, canvasId, canvasLabel, emptyId) {
  return `<article id="${chartKey}-chart-card" class="ui-main-card analytics-chart-card--compact dashboard-chart-card bg-white border border-zinc-200/80 rounded-xl shadow-xs overflow-hidden text-left flex flex-col dashboard-analysis-chart-card"><div class="ui-section-header border-b border-zinc-100 bg-white px-3 py-2"><div class="dashboard-chart-header flex flex-row items-center justify-between gap-1"><div class="min-w-0 flex-1"><h3 id="${titleId}" class="ui-section-title text-xs font-bold text-zinc-900 leading-tight">${escapeHtml(title)}</h3><p id="${subtitleId}" class="ui-section-subtitle text-xs text-zinc-400 font-medium truncate" title="National · Selected period">National · Selected period</p></div><div class="dashboard-chart-actions flex items-center gap-1 shrink-0"><div class="dashboard-chart-utility-group"><button type="button" data-chart-table-trigger="${chartKey}" class="ui-icon-button dashboard-chart-icon-button" aria-label="Show ${escapeHtml(title)} data table"><i class="fa-solid fa-table text-xs" aria-hidden="true"></i></button><button type="button" data-chart-image-copy="${chartKey}" class="ui-icon-button dashboard-chart-icon-button" aria-label="Copy ${escapeHtml(title)} as PNG"><i class="fa-regular fa-image text-xs" aria-hidden="true"></i></button></div></div></div></div><div class="analytics-chart-card--compact__body p-3 flex-1 flex flex-col dashboard-analysis-chart-card__body"><div class="analytics-chart-card--compact__canvas relative w-full flex-1 dashboard-analysis-chart-card__canvas"><canvas id="${canvasId}" aria-label="${escapeHtml(canvasLabel)}"></canvas><p id="${emptyId}" class="hidden absolute inset-0 items-center justify-center px-3 text-center text-xs font-medium text-zinc-400">No matching data for the current scope.</p></div></div></article>`;
}

function analysisPanel() {
  return `<aside data-map-analysis-panel aria-label="Dashboard charts" class="min-h-0 text-left lg:overflow-y-auto" data-dashboard-analysis-panel><div class="flex h-full min-h-0 flex-col gap-3"><section data-dashboard-analysis-summary class="dashboard-analysis-summary shrink-0 text-left"><header class="ui-section-header rounded-lg border border-zinc-200/80 border-b-zinc-200/80 bg-zinc-50/20 px-3 py-2"><div class="dashboard-chart-header flex flex-row items-center justify-between gap-1"><h2 id="dashboard-analysis-title" class="ui-section-title line-clamp-2 min-w-0 break-words text-xs font-bold leading-tight">Damage and Losses</h2><button id="map-show-national" type="button" class="ui-icon-button ui-icon-button--plain hidden shrink-0 cursor-pointer" aria-label="Clear selection" title="Clear selection"><i class="fa-solid fa-xmark text-xs" aria-hidden="true"></i></button></div></header><section class="grid shrink-0 grid-cols-2 gap-2 px-0 pt-3 sm:grid-cols-4" data-dashboard-analysis-metrics aria-label="Selected scope impact metrics"><article data-dashboard-analysis-metric="farmers" class="ui-stat-card min-w-0"><div data-kpi-content-group class="mx-auto w-fit max-w-full text-left"><div class="farm-kpi-label-row"><span class="farm-kpi-indicator farm-kpi-indicator--farmers" aria-hidden="true"></span><p class="farm-kpi-label min-w-0">Farmers/fisherfolk affected</p></div><p id="dashboard-analysis-farmers" class="farm-kpi-value mt-3 truncate tabular-nums" title="Affected Farmers/Fisherfolk">—</p></div></article><article data-dashboard-analysis-metric="area" class="ui-stat-card min-w-0"><div data-kpi-content-group class="mx-auto w-fit max-w-full text-left"><div class="farm-kpi-label-row"><span class="farm-kpi-indicator farm-kpi-indicator--area" aria-hidden="true"></span><p class="farm-kpi-label min-w-0">Area affected</p></div><p id="dashboard-analysis-area" class="farm-kpi-value mt-3 truncate tabular-nums" title="Area Affected">—</p></div></article><article data-dashboard-analysis-metric="volume" class="ui-stat-card min-w-0"><div data-kpi-content-group class="mx-auto w-fit max-w-full text-left"><div class="farm-kpi-label-row"><span class="farm-kpi-indicator farm-kpi-indicator--volume" aria-hidden="true"></span><p class="farm-kpi-label min-w-0">Production loss</p></div><p id="dashboard-analysis-volume" class="farm-kpi-value mt-3 truncate tabular-nums" title="Production Loss">—</p></div></article><article data-dashboard-analysis-metric="value" class="ui-stat-card min-w-0"><div data-kpi-content-group class="mx-auto w-fit max-w-full text-left"><div class="farm-kpi-label-row"><span class="farm-kpi-indicator farm-kpi-indicator--value" aria-hidden="true"></span><p class="farm-kpi-label min-w-0">Value loss</p></div><p id="dashboard-analysis-value" class="farm-kpi-value mt-3 truncate tabular-nums" title="Value Loss">—</p></div></article></section></section><section class="grid min-h-0 flex-1 grid-cols-1 gap-3" aria-label="Selected scope distributions"><div class="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-2">${chartCard("dashboard-region", "Value Loss by Region", "dashboard-region-chart-title", "dashboard-region-chart-subtitle", "dashboardRegionBarChart", "Regional value loss horizontal bar chart", "dashboard-region-chart-empty")}${chartCard("dashboard-commodity", "Value Loss by Commodity", "dashboard-commodity-chart-title", "dashboard-commodity-chart-subtitle", "dashboardCommodityPieChart", "Commodity value loss doughnut chart", "dashboard-commodity-chart-empty")}${chartCard("dashboard-hazard", "Value Loss by Hazard", "dashboard-hazard-chart-title", "dashboard-hazard-chart-subtitle", "dashboardHazardPieChart", "Hazard value loss doughnut chart", "dashboard-hazard-chart-empty")}</div></section></div></aside>`;
}

function localDashboard() {
  const reports = filteredReports();
  const map = publicMapData(reports);
  return `<div data-damage-losses-dashboard class="relative flex min-h-0 w-full flex-col gap-3 lg:h-full"><div class="grid min-h-0 grid-cols-1 gap-3 lg:flex-1 lg:grid-cols-[minmax(22rem,0.8fr)_minmax(0,1.2fr)]" data-map-workspace><div data-dashboard-map-column class="flex min-h-0 min-w-0 flex-col gap-3">${mapCanvas()}</div>${analysisPanel()}</div><script type="application/json" id="map-spatial-data">${jsonForScript(map.data)}</script><script type="application/json" id="map-spatial-config">${jsonForScript(map.config)}</script></div>`;
}

function simpleModule(title, eyebrow, rows, headers, detail) {
  return `<section class="ui-main-card ui-main-card--compact overflow-hidden border border-zinc-200/80 bg-white text-left shadow-xs">${`<div class="ui-section-header border-b border-zinc-100 bg-white px-5 py-3"><div class="flex items-center justify-between gap-3"><div><p class="ui-section-subtitle text-xs font-semibold uppercase tracking-wider text-zinc-400">${escapeHtml(eyebrow)}</p><h2 class="ui-section-title text-base font-semibold text-zinc-900">${escapeHtml(title)}</h2></div><span class="text-xs text-zinc-500">${escapeHtml(detail)}</span></div></div>`}<div class="report-table-wrap"><table class="report-table report-table--blue-header ui-table--compact min-w-full"><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="px-4 py-8 text-center text-xs text-zinc-400">No records are in this release.</td></tr>`}</tbody></table></div></section>`;
}

function analytics() {
  const reports = filteredReports();
  const annual = groupSum(reports.map((row) => ({ ...row, year: yearOf(row.incident_start_date) })), "year", "value_loss_php").sort((left, right) => right.label.localeCompare(left.label));
  const rows = annual.map((item) => `<tr><th scope="row">${escapeHtml(item.label)}</th><td class="is-numeric">${escapeHtml(formatMetric(item.value, "value_loss_php"))}</td><td class="is-numeric">${formatNumber(reports.filter((row) => yearOf(row.incident_start_date) === item.label).length)}</td></tr>`).join("");
  return simpleModule("Annual Summary", "Reported years", rows, ["Year", "Value loss", "Rows"], `${formatNumber(reports.length)} rows`);
}

function incidents() {
  const reportCounts = new Map();
  for (const row of state.data.damage_reports) {
    const item = reportCounts.get(row.incident_key) || { count: 0, value: 0 };
    item.count += 1;
    item.value += numeric(row.value_loss_php);
    reportCounts.set(row.incident_key, item);
  }
  const rows = state.data.incidents.map((incident) => {
    const item = reportCounts.get(incident.incident_key) || { count: 0, value: 0 };
    return `<tr><td>${escapeHtml(incident.incident_name)}</td><td>${escapeHtml(incident.hazard_type)}</td><td>${escapeHtml(incident.incident_start_date || "—")}</td><td class="is-numeric">${formatNumber(item.count)}</td><td class="is-numeric">${escapeHtml(formatMetric(item.value, "value_loss_php"))}</td></tr>`;
  }).join("");
  return simpleModule("Historical incidents", "Catalogue", rows, ["Incident", "Hazard", "Start", "Report rows", "Value loss"], `${formatNumber(state.data.incidents.length)} incidents`);
}

function cycloneTracks() {
  const pointCounts = new Map();
  for (const point of state.data.tropical_cyclone_track_points) pointCounts.set(point.cyclone_key, (pointCounts.get(point.cyclone_key) || 0) + 1);
  const rows = state.data.tropical_cyclones.map((cyclone) => `<tr><td>${escapeHtml(cyclone.cyclone_name || "Unnamed cyclone")}</td><td>${escapeHtml(cyclone.international_name || "—")}</td><td>${escapeHtml(cyclone.occurrence_year)}</td><td>${escapeHtml(cyclone.peak_intensity || "—")}</td><td class="is-numeric">${formatNumber(pointCounts.get(cyclone.cyclone_key) || 0)}</td></tr>`).join("");
  return simpleModule("Tropical cyclone tracks", "Catalogue", rows, ["Name", "International name", "Year", "Peak intensity", "Track points"], `${formatNumber(state.data.tropical_cyclone_track_points.length)} track points`);
}

function shell(content) {
  const view = currentView();
  const generatedDate = new Date(state.data.generated_at).toLocaleDateString("en-PH");
  const hasDashboardFilters = view === "/dashboard/" || view === "/analytics/";
  document.documentElement.dataset.sidebarOpen = state.sidebarOpen ? "true" : "false";
  return `<a class="add-skip-link" href="#main-content">Skip to main content</a><div data-app-shell class="farm-app-shell flex h-screen overflow-hidden" data-public-shell><aside data-sidebar-shell class="fixed inset-y-0 left-0 z-50 flex h-screen shrink-0 xl:relative xl:inset-auto xl:h-full" aria-label="DCIO Data Studio navigation"><div class="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950 text-zinc-400 shadow-2xl shadow-zinc-950/20"><div class="sidebar-brand relative flex h-10 shrink-0 items-center px-2.5"><a href="/dashboard/" data-nav class="sidebar-brand-link" aria-label="DCIO Data Studio"><img class="sidebar-brand-logo" src="/assets/img/dala-logo.png" alt="DALA logo"><div class="sidebar-brand-text"><h1>DCIO <span>Data Studio</span></h1></div></a></div><nav class="flex flex-1 flex-col overflow-y-auto px-3 py-5" aria-label="Primary modules">${NAVIGATION.map(([href, label, icon, color]) => `<a href="${href}" data-nav ${view === href ? "aria-current=\"page\"" : ""} class="flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-all duration-150 ${view === href ? "bg-zinc-100 font-bold text-zinc-950 shadow-sm" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}"><i class="fa-solid ${icon} sidebar-nav-icon ${color}" aria-hidden="true"></i><span>${escapeHtml(label)}</span></a>`).join("")}</nav><div class="flex shrink-0 flex-col gap-1 border-t border-zinc-800 px-3 py-3 text-xs text-zinc-500"><strong class="text-zinc-300">Public release</strong><span>Read-only workspace</span><span>Release ${escapeHtml(state.data.release_version)}</span><span>${escapeHtml(generatedDate)}</span></div></div></aside><div class="farm-main-panel page-transition-target flex h-full min-w-0 flex-1 flex-col overflow-hidden"><header data-workspace-topbar class="relative z-[1200] flex h-10 shrink-0 items-center justify-between gap-3 overflow-visible px-4 sm:px-6 farm-workspace-topbar--filter-only"><div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3"><button type="button" id="public-sidebar-toggle" data-sidebar-toggle class="farm-sidebar-toggle cursor-pointer transition-colors focus:outline-none" aria-label="${state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}" title="${state.sidebarOpen ? "Hide sidebar" : "Show sidebar"}" aria-expanded="${state.sidebarOpen}"><i data-sidebar-icon="collapse" class="fa-solid fa-angles-left" aria-hidden="true"></i></button><nav data-workspace-nav class="farm-workspace-nav hidden" aria-label="Current page"><span>${escapeHtml(currentLabel())}</span></nav></div><div data-filter-header-slot class="min-w-0 flex-1" aria-label="Dashboard filters">${hasDashboardFilters ? publicFilterPanel() : ""}</div></header><main id="main-content" tabindex="-1" data-page-body class="farm-page-body min-h-0 flex-1 overflow-y-auto analytics-workspace-page-body map-workspace-page-body p-3 sm:p-4"><div class="farm-page-content mx-auto w-full max-w-[1600px] h-full min-h-0">${content}</div></main></div></div>`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Unable to load public frontend asset: ${src}`));
    document.body.appendChild(script);
  });
}

async function loadDashboardScripts() {
  if (window.__dcioPublicDashboardLoaded) return;
  window.ADD_PROVINCES_GEOJSON_URL = "/assets/geo/ph/provinces.geojson";
  window.ADD_PHILIPPINES_OUTLINE_GEOJSON_URL = "/assets/geo/ph/philippines_outline.geojson";
  for (const src of PUBLIC_SCRIPTS) await loadScript(src);
  window.__dcioPublicDashboardLoaded = true;
}

async function render() {
  if (!state.data) return;
  document.body.className = "farm-app-body antialiased";
  const view = currentView();
  const content = view === "/dashboard/" ? localDashboard() : view === "/analytics/" ? analytics() : view === "/incidents/" ? incidents() : cycloneTracks();
  app.innerHTML = shell(content);
  bindFilters();
  if (view === "/dashboard/") await loadDashboardScripts();
}

function bindFilters() {
  document.querySelectorAll("[data-public-filter]").forEach((control) => {
    control.addEventListener("change", () => {
      const url = new URL(window.location.href);
      const key = control.dataset.publicFilter;
      if (control.value === "all") url.searchParams.delete(key);
      else url.searchParams.set(key, control.value);
      window.location.href = `${url.pathname}${url.search}`;
    });
  });
  document.querySelector("#public-sidebar-toggle")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    document.documentElement.dataset.sidebarOpen = state.sidebarOpen ? "true" : "false";
    render();
  });
}

function renderError(error) {
  app.innerHTML = `<main class="error-state"><p class="eyebrow">Release unavailable</p><h1>Public data could not be loaded.</h1><p>${escapeHtml(error.message)}</p></main>`;
}

readFiltersFromUrl();
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-nav]");
  if (!link) return;
  event.preventDefault();
  window.location.href = link.href;
});
loadRelease().then(({ release }) => {
  state.data = release;
  return render();
}).catch(renderError);
