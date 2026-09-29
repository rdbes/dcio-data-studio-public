/* Map Studio: all CSV parsing and visualization happens in this browser. */
(() => {
  "use strict";
  const { parseCSV, csvCell } = window.MapStudioCSV || {};
  if (!parseCSV || !csvCell) throw new Error("Map Studio CSV helpers are unavailable.");
  const workspaceConfig = document.querySelector("[data-map-studio-asset-base]");
  const mapAsset = (path) => {
    const normalized = String(path || "").replace(/^assets\//, "");
    const base = String(workspaceConfig?.dataset.mapStudioAssetBase || "");
    return base ? base + normalized : path;
  };
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_ROWS = 5000;
  const VALIDATION_DIALOG_ISSUE_LIMIT = 50;
  const DEFAULT_GENERAL_LEGEND_LABEL = "Value Loss";
  const DEFAULT_GENERAL_UNIT = "Pesos";
  const MAP_BOUNDARY_OUTLINE = "#fcfcfa";
  const DEFAULT_BOUNDARY_STYLES = {
    municipality: { color: MAP_BOUNDARY_OUTLINE, weight: .45, dashArray: "4 3", opacity: .68, smoothFactor: .25 },
    province: { color: MAP_BOUNDARY_OUTLINE, weight: .68, opacity: .78, smoothFactor: .25 },
    region: { color: MAP_BOUNDARY_OUTLINE, weight: 1.05, opacity: .92, smoothFactor: .25 },
  };
  const PRIMARY_ARCHIPELAGO_WEST_LONGITUDE = 116.5;
  const DEFAULT_MAP_CENTER = [12.8797, 121.774];
  const DEFAULT_MAP_ZOOM = 5;
  const NCR_REGION_CODE = "1300000000";
  const CITY_OF_ISABELA_LOCATION_CODE = "0990101000";
  const CITY_OF_ISABELA_REPORTING_CODE = "0990100000";
  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  const LEVEL_ORDER = ["municipality_city", "province_huc", "region"];
  const LEVEL_LABELS = { municipality_city: "Municipality / City", province_huc: "Province / HUC", region: "Region" };
  const LOCATION_LOOKUP_PRIORITY = { municipality_city: 1, region: 2, province_huc: 3 };
  const PRIMARY_GREEN = "#006633";
  const PRIMARY_GREEN_SURFACE = "rgba(0,102,51,.10)";
  const PRIMARY_GREEN_LIGHT = "#b8dfc5";
  const STAGES = [["newly_planted_seedling", "Newly planted / Seedling"], ["vegetative", "Vegetative"], ["reproductive", "Reproductive"], ["maturity", "Maturity"]];
  const CROP_CLASSES = { corn: [["yellow", "Yellow"], ["white", "White"]], rice: [["irrigated", "Irrigated"], ["rainfed", "Rainfed"], ["upland", "Upland"]] };
  const MAP_PALETTES = {
    singleGreen: { label: "Single Green", accent: "#31A354", colors: ["#EDF8E9", "#BAE4B3", "#74C476", "#31A354", "#006D2C"] },
    red: { label: "Red", accent: "#DE2D26", colors: ["#FEE5D9", "#FCAE91", "#FB6A4A", "#DE2D26", "#A50F15"] },
    blue: { label: "Blue", accent: "#3182BD", colors: ["#EFF3FF", "#BDD7E7", "#6BAED6", "#3182BD", "#08519C"] },
    purple: { label: "Purple", accent: "#756BB1", colors: ["#F2F0F7", "#CBC9E2", "#9E9AC8", "#756BB1", "#54278F"] },
    orange: { label: "Orange", accent: "#E6550D", colors: ["#FEEDDE", "#FDBE85", "#FD8D3C", "#E6550D", "#A63603"] },
    gray: { label: "Gray", accent: "#636363", colors: ["#F7F7F7", "#CCCCCC", "#969696", "#636363", "#252525"] },
    ylgn: { label: "Yellow–Green", accent: "#31A354", colors: ["#FFFFCC", "#C2E699", "#78C679", "#31A354", "#006837"] },
    gnbu: { label: "Green–Blue", accent: "#43A2CA", colors: ["#F0F9E8", "#BAE4BC", "#7BCCC4", "#43A2CA", "#0868AC"] },
    ylgnbu: { label: "Yellow–Green–Blue", accent: "#2C7FB8", colors: ["#FFFFCC", "#A1DAB4", "#41B6C4", "#2C7FB8", "#253494"] },
    ylorrd: { label: "Yellow–Orange–Red", accent: "#F03B20", colors: ["#FFFFB2", "#FECC5C", "#FD8D3C", "#F03B20", "#BD0026"] },
    ylorbr: { label: "Yellow–Orange–Brown", accent: "#D95F0E", colors: ["#FFFFD4", "#FED98E", "#FE9929", "#D95F0E", "#993404"] },
    pubugn: { label: "Purple–Blue–Green", accent: "#1C9099", colors: ["#F6EFF7", "#BDC9E1", "#67A9CF", "#1C9099", "#016C59"] },
  };
  const STANDING_DEFAULT_PALETTES = { corn: "ylorbr", rice: "singleGreen" };
  const MAP_THEMES = {
    sky: { label: "Sky", color: "#c0e8ff", overviewColor: "#4f9fc8", controlColor: "#0284c7", gridColor: "#e0f2fe", cartographyColor: "#075985", cartographySecondaryColor: "#ffffff", tone: "sky" },
    lightest: { label: "Lightest", color: "#f7f7f7", controlColor: "#969696", gridColor: "#cccccc", cartographyColor: "#52525b", cartographySecondaryColor: "#ffffff", tone: "light" },
    light: { label: "Light", color: "#cccccc", controlColor: "#cccccc", gridColor: "#f7f7f7", cartographyColor: "#52525b", cartographySecondaryColor: "#ffffff", tone: "light" },
    medium: { label: "Medium", color: "#969696", controlColor: "#969696", gridColor: "#cccccc", cartographyColor: "#3f3f46", cartographySecondaryColor: "#ffffff", tone: "light" },
    dark: { label: "Dark", color: "#636363", controlColor: "#636363", gridColor: "#969696", cartographyColor: "#f4f4f5", cartographySecondaryColor: "#52525b", tone: "dark" },
    darkest: { label: "Darkest", color: "#252525", overviewColor: "#636363", controlColor: "#252525", gridColor: "#636363", cartographyColor: "#f4f4f5", cartographySecondaryColor: "#52525b", tone: "dark" },
  };
  const MAP_INTERFACE_THEMES = {
    light: { surface: "rgba(255,255,255,.84)", popupSurface: "rgba(255,255,255,.56)", popupSurfaceOpaque: "#ffffff", glassHover: "rgba(255,255,255,.72)", surfaceHover: "#ffffff", text: "#3f3f46", muted: "#71717a", border: "rgba(212,212,216,.82)", focus: PRIMARY_GREEN, accent: PRIMARY_GREEN, accentSurface: PRIMARY_GREEN_SURFACE, controlSurface: "#ffffff", controlSurfaceHover: "#f1f3f2", controlBorder: "rgba(63,63,70,.34)", controlIcon: "#3f3f46", controlFocus: "#3f3f46", controlActiveBg: "#3f3f46", controlActiveText: "#ffffff", shadow: "0 8px 22px rgba(24,24,27,.12)" },
    sky: { surface: "rgba(240,249,255,.86)", popupSurface: "rgba(255,255,255,.56)", popupSurfaceOpaque: "#ffffff", glassHover: "rgba(255,255,255,.72)", surfaceHover: "#f0f9ff", text: "#075985", muted: "#0369a1", border: "rgba(14,116,144,.28)", focus: PRIMARY_GREEN, accent: PRIMARY_GREEN, accentSurface: PRIMARY_GREEN_SURFACE, controlSurface: "#ffffff", controlSurfaceHover: "#f1f3f5", controlBorder: "rgba(63,63,70,.34)", controlIcon: "#3f3f46", controlFocus: "#3f3f46", controlActiveBg: "#3f3f46", controlActiveText: "#ffffff", shadow: "0 8px 22px rgba(7,89,133,.14)" },
    dark: { surface: "rgba(24,24,27,.82)", popupSurface: "rgba(9,9,11,.42)", popupSurfaceOpaque: "#09090b", glassHover: "rgba(9,9,11,.58)", surfaceHover: "rgba(39,39,42,.94)", text: "#f4f4f5", muted: "#cbd5e1", border: "rgba(244,244,245,.22)", focus: "#8bd3a4", accent: "#8bd3a4", accentSurface: "rgba(139,211,164,.18)", controlSurface: "#09090b", controlSurfaceHover: "#2d2f33", controlBorder: "rgba(244,244,245,.40)", controlIcon: "#f4f4f5", controlFocus: "#f4f4f5", controlActiveBg: "#f4f4f5", controlActiveText: "#18181b", shadow: "0 10px 26px rgba(0,0,0,.28)" },
  };
  deepFreeze(MAP_PALETTES);
  deepFreeze(MAP_THEMES);
  deepFreeze(MAP_INTERFACE_THEMES);
  const MAP_BASEMAPS = {
    default: { label: "Default", detail: "System map · no labels" },
    streets: { label: "OpenStreetMap", detail: "Street map with labels", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", options: { maxZoom: 19 } },
    satellite: { label: "Satellite", detail: "Satellite imagery · no labels", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", options: { maxZoom: 19 } },
  };
  const MAP_ICONS = {
    expand: '<i class="map-studio-control-icon fa-solid fa-expand" aria-hidden="true"></i>',
    compress: '<i class="map-studio-control-icon fa-solid fa-compress" aria-hidden="true"></i>',
    reset: '<i class="map-studio-control-icon fa-solid fa-location-crosshairs" aria-hidden="true"></i>',
    clear: '<i class="map-studio-control-icon fa-solid fa-eraser" aria-hidden="true"></i>',
    plus: '<i class="map-studio-control-icon fa-solid fa-plus" aria-hidden="true"></i>',
    minus: '<i class="map-studio-control-icon fa-solid fa-minus" aria-hidden="true"></i>',
    appearance: '<i class="map-studio-control-icon fa-solid fa-circle-half-stroke" aria-hidden="true"></i>',
    layers: '<i class="map-studio-control-icon fa-solid fa-layer-group" aria-hidden="true"></i>',
    menu: '<i class="map-studio-control-icon fa-solid fa-sliders" aria-hidden="true"></i>',
    hideControls: '<i class="map-studio-control-icon fa-solid fa-eye-slash" aria-hidden="true"></i>',
    showControls: '<i class="map-studio-control-icon fa-solid fa-eye" aria-hidden="true"></i>',
    map: '<i class="map-studio-control-icon fa-solid fa-map" aria-hidden="true"></i>',
    metric: '<i class="map-studio-control-icon fa-solid fa-chart-column" aria-hidden="true"></i>',
    edit: '<i class="map-studio-control-icon fa-solid fa-pen-to-square" aria-hidden="true"></i>',
    location: '<i class="map-studio-control-icon fa-solid fa-location-dot" aria-hidden="true"></i>',
    copy: '<svg class="map-studio-control-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.25" stroke="currentColor" stroke-width="1.25"/><path d="M11 5V3.75A1.75 1.75 0 0 0 9.25 2h-5.5A1.75 1.75 0 0 0 2 3.75v5.5A1.75 1.75 0 0 0 3.75 11H5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>',
    resize: '<i class="map-studio-control-icon fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i>',
    download: '<i class="map-studio-control-icon fa-solid fa-download" aria-hidden="true"></i>',
  };
  const PAGASA_TRACK_URL = String(workspaceConfig?.dataset.mapStudioPagasaTrackUrl || "");
  const PAGASA_DIRECT_TRACK_URL = "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/cyclone.dat";
  const PAGASA_TCID_BOUNDS = [[0, 110], [27, 155]];
  const PAGASA_REQUEST_TIMEOUT_MS = 8000;
  const PAGASA_REFRESH_MS = 15 * 60 * 1000;
  const PAGASA_CATEGORY_COLORS = { TD: "#22b8cf", TS: "#ffad00", STS: "#d07a32", TY: "#dc2626", STY: "#b05a91", LPA: "#73736b", AA: "#73736b" };
  const PAGASA_CATEGORY_LEGEND = [
    { colorKey: "STY", icon: "hurricane", label: "Super Typhoon" },
    { colorKey: "TY", code: "T", label: "Typhoon" },
    { colorKey: "STS", icon: "hurricane", label: "Severe Tropical Storm" },
    { colorKey: "TS", code: "S", label: "Tropical Storm" },
    { colorKey: "TD", code: "D", label: "Tropical Depression" },
    { colorKey: "LPA", code: "L", label: "Low Pressure Area" },
  ];
  const HAZARD_VOLCANOES = [
    { key: "bulusan", name: "Bulusan", latitude: 12.7693, longitude: 124.0561 },
    { key: "kanlaon", name: "Kanlaon", latitude: 10.4128, longitude: 123.1326 },
    { key: "mayon", name: "Mayon", latitude: 13.2571, longitude: 123.6856 },
    { key: "pinatubo", name: "Pinatubo", latitude: 15.1429, longitude: 120.3496 },
    { key: "taal", name: "Taal", latitude: 14.0021, longitude: 120.9937 },
  ];
  const HAZARD_ALERT_COLORS = ["#72d84c", "#ffd75b", "#ff9a4d", "#dc302f", "#8b5cf6", "#4c1d95"];
  const HAZARD_ALERT_LABELS = ["No alert", "Alert level 1", "Alert level 2", "Alert level 3", "Alert level 4", "Alert level 5"];
  const HAZARD_VOLCANO_STATUS_LABELS = {
    bulusan: ["Quiet or No Alert", "Low Level of Volcanic Unrest", "Moderate Level of Volcanic Unrest", "High Level of Volcanic Unrest", "Hazardous Eruption Imminent", "Hazardous Eruption in Progress"],
    kanlaon: ["No Alert (Normal)", "Low Level of Volcanic Unrest", "Moderate Level of Volcanic Unrest", "High Level of Volcanic Unrest", "Hazardous Eruption Imminent", "Hazardous Eruption in Progress"],
    mayon: ["No Alert", "Abnormal", "Increasing Unrest", "Increased Tendency Towards Hazardous Eruption", "Hazardous Eruption Imminent", "Hazardous Eruption Ongoing"],
    pinatubo: ["Normal", "Low-Level Unrest", "Increasing Unrest", "Intensified Unrest / Magmatic Unrest", "Hazardous Eruption Imminent", "Highly Hazardous Eruption in Progress"],
    taal: ["Normal", "Low-Level Unrest", "Increasing Unrest", "Intensified Unrest / Magmatic Unrest", "Hazardous Eruption Imminent", "Highly Hazardous Eruption in Progress"],
  };
  const HAZARD_KANLAON_CRITERIA = [
    {
      monitoring: "All monitored parameters within background levels. Unremarkable level of volcanic earthquakes occurring within the volcano area.",
      interpretation: "Quiescence; no magmatic eruption is foreseen. However, there are perennial hazards (sudden explosions, rockfalls and landslides) within the four (4) kilometer-radius Permanent Danger Zone (PDZ) that may occur suddenly and without warning.",
      recommendation: "",
    },
    {
      monitoring: "Slight increase in volcanic earthquake and steam/gas activity. Sporadic explosions from the summit crater or new vents. Notable increase in the temperature, acidity and volcanic gas concentrations of monitored springs and fumaroles. Slight inflation or swelling of the edifice.",
      interpretation: "Hydrothermal, magmatic, or tectonic disturbances may be underway. The source of activity may be shallow, near the summit crater or in the vicinity of the edifice. Entry into the PDZ must be prohibited.",
      recommendation: "",
    },
    {
      monitoring: "Elevated levels of any of the following parameters: volcanic earthquake, temperature, acidity and volcanic gas concentrations of monitored springs and fumaroles, steam and ash explosions from the summit crater or new vents, inflation or swelling of the edifice.",
      interpretation: "Probable intrusion of magma at depth, which may or may not lead to magmatic eruption. Entry within PDZ must be prohibited.",
      recommendation: "",
    },
    {
      monitoring: "Sustained increases in the levels of volcanic earthquakes, some of which may be perceptible. More energetic and frequent steam/ash explosions. Sustained increases in the temperature, acidity and volcanic gas concentrations of springs and fumaroles, and in the levels of ground deformation or swelling of the edifice. Activity at the summit may involve sluggish lava extrusion with resultant rockfall.",
      interpretation: "Magmatic intrusion to shallow levels of the edifice is driving unrest, with indications that hazardous eruption could occur in weeks. Danger zones may be expanded to a radius of six (6) kilometers from the summit crater or active vent.",
      recommendation: "",
    },
    {
      monitoring: "Intensifying unrest characterized by earthquake swarms and volcanic tremor, many of which may be perceptible. Frequent strong ash explosions. Increasing rates of ground deformation and swelling of the edifice. Increasing rates of lava extrusion with increased frequency and volume of rockfall and volcanic gas flux, or abrupt decrease in volcanic gas flux due to plugging of lava at the summit crater or active vent.",
      interpretation: "Low-level magmatic eruption underway, which can progress to highly hazardous major eruption within hours or days. Danger zones may be expanded to a radius of ten (10) kilometers or more from the summit crater or active vent.",
      recommendation: "",
    },
    {
      monitoring: "Magmatic eruption characterized by explosive production of tall ash-laden eruption columns, and/or descent and frequent failure of voluminous lava flows. Generation of deadly pyroclastic flows, surges and/or lateral blasts and widespread tephra fall (ashfall). Lahars generate along river channels.",
      interpretation: "Life-threatening major eruption producing volcanic hazards that endanger communities. Danger zones may be expanded to fourteen (14) kilometers as eruption progresses.",
      recommendation: "",
    },
  ];
  const HAZARD_BULUSAN_CRITERIA = [
    {
      monitoring: "All monitored parameters within background levels. Unremarkable level of volcanic earthquakes occurring within the volcano area. Generally weak steam emission.",
      interpretation: "Quiescence; no magmatic eruption is foreseen. However, there are hazards (explosions, rockfalls and landslides) that may suddenly occur within the four-kilometer radius Permanent Danger Zone (PDZ).",
      recommendation: "",
    },
    {
      monitoring: "Slight increase in volcanic earthquake and steam/gas activity. Sporadic explosions from existing or new vents. Notable increase in the temperature of hot springs. Slight inflation or swelling of the edifice.",
      interpretation: "Hydrothermal, magmatic, or tectonic disturbances. The source of activity is shallow, near crater or in the vicinity of Irosin Caldera. Entry into the PDZ must be prohibited.",
      recommendation: "",
    },
    {
      monitoring: "Elevated levels of any of the following: volcanic earthquake, steam/gas emission, ground deformation and hot spring temperature. Intermittent steam/ash explosion and above baseline Sulfur Dioxide (SO2) emission rates. Increased swelling of volcanic edifice.",
      interpretation: "Probable intrusion of magma at depth, which can lead to magmatic eruption. Entry within PDZ must be prohibited. Other areas within five (5) kilometers of the active vent may be included in the danger zone.",
      recommendation: "",
    },
    {
      monitoring: "Sustained increases in the levels of volcanic earthquakes, some may be perceptible. Occurrence of low-frequency earthquakes, volcanic tremor, rumbling sounds. Forceful and voluminous steam/ash ejections. Sustained increases in SO2 emission rates, ground deformation/swelling of the edifice. Activity at the summit may involve dome growth and/or lava flow, resultant rockfall.",
      interpretation: "Magma is near or at the surface, and activity could lead to hazardous eruption in weeks. Danger zones may be expanded up to eight (8) kilometers from the active crater.",
      recommendation: "",
    },
    {
      monitoring: "Intensifying unrest characterized by earthquake swarms and volcanic tremor, many perceptible. Frequent strong ash explosions. Sustained increase, or sudden drop, of SO2 emission. Increasing rates of ground deformation and swelling of the edifice. Lava dome growth and/or lava flow increases, with increased frequency and volume of rockfall.",
      interpretation: "Magmatic processes or effusive eruption underway, which can progress into highly hazardous eruption. Danger Zone may be extended up to nine (9) kilometers or more from the active crater.",
      recommendation: "",
    },
    {
      monitoring: "Magmatic eruption characterized by explosive production of tall ash-laden eruption columns, or by massive collapses of summit lava dome. Generation of deadly pyroclastic flows, surges and/or lateral blasts and widespread ashfall.",
      interpretation: "Life-threatening eruption producing volcanic hazards that endanger communities. Additional danger areas may be declared as eruption progresses.",
      recommendation: "",
    },
  ];
  const HAZARD_VOLCANO_CRITERIA = {
    bulusan: HAZARD_BULUSAN_CRITERIA,
    kanlaon: HAZARD_KANLAON_CRITERIA,
    mayon: [
      { monitoring: "Quiet. All monitored parameters within background levels.", interpretation: "No eruption in foreseeable future. Entry in the 6-km radius Permanent Danger Zone (PDZ) is not advised because phreatic explosions and ash puffs may occur without precursors.", recommendation: "" },
      { monitoring: "Low level unrest. Slight increase in seismicity. Slight increase in SO2 gas output above the background level. Very faint glow of the crater may occur but no conclusive evidence of magma ascent. Phreatic explosion or ash puffs may occur.", interpretation: "No eruption imminent. Activity may be hydrothermal, magmatic or tectonic in origin. No entry in the 6-km radius PDZ.", recommendation: "" },
      { monitoring: "Moderate unrest. Low to moderate level of seismic activity. Increasing SO2 flux. Faint / intermittent crater glow. Swelling of edifice may be detected. Confirmed reports of decrease in flow of wells and springs during rainy season.", interpretation: "Unrest probably of magmatic origin; could eventually lead to eruption. 6-km radius Danger Zone may be extended to 7 km in the sector where the crater rim is low.", recommendation: "" },
      { monitoring: "Relatively high unrest. Volcanic quakes and tremor may become more frequent. Further increase in SO2 flux. Occurrence of rockfalls in summit area. Vigorous steaming / sustained crater glow. Persistent swelling of edifice.", interpretation: "Magma is close or at the crater. If trend is one of increasing unrest, eruption is possible within weeks. Extension of Danger Zone in the sector where the crater rim is low will be considered.", recommendation: "" },
      { monitoring: "Intense unrest. Persistent tremor, many “low frequency”-type earthquakes. SO2 emission level may show sustained increase or abrupt decrease. Intense crater glow. Incandescent lava dome, lava fountain, lava flow in the summit area.", interpretation: "Hazardous eruption is possible within days. Extension of Danger zone to 8 km or more in the sector where the crater rim is low will be recommended.", recommendation: "" },
      { monitoring: "Hazardous eruption ongoing. Occurrence of pyroclastic flows, tall eruption columns and extensive ashfall.", interpretation: "Pyroclastic flows may sweep down along gullies and channels, especially along those fronting the low part(s) of the crater rim. Additional danger areas may be identified as eruption progresses. Danger to aircraft, by way of ash cloud encounter, depending on height of eruption column and/or wind drift.", recommendation: "" },
    ],
    pinatubo: [
      { monitoring: "Background parameters: Volcanic earthquakes typically <5/day; Caldera lake CO2 flux <1000 tonnes/day.", interpretation: "Quiescence; no major eruption in foreseeable future.", recommendation: "Communities at risk must continue preparedness efforts." },
      { monitoring: "Abnormal parameters: Volcanic earthquake clusters along regional faults or lineaments or within the hydrothermal system; Changes in fumarolic activity in the crater; increased crater lake CO2 flux and CO2/H2S ratio changes.", interpretation: "Hydrothermal or local tectonic activity beneath/near the volcano may be occurring; no eruption imminent.", recommendation: "Extreme caution when venturing into the Pinatubo Caldera recommended." },
      { monitoring: "Increasing changes in parameters: Increased and shallowing high-frequency (HF) or volcano-tectonic (VT) earthquake clusters, shallow sporadic low-level tremor with long-period (LP) or low-frequency (LF) events, DLPs (deep long period) events at sub-crustal depths; Continued increases in crater lake CO2 flux and CO2/H2S ratios, significant SO2 emission may be detected; Increased fumarolic activity with discrete weak phreatic eruptions; Ground deformation detected by satellite systems.", interpretation: "Deep-seated magmatic intrusion and/ or increased hydrothermal activity may be occurring, with increased chances of phreatic, gas or hydrothermal explosions; could eventually lead to an eruption.", recommendation: "No entry into Pinatubo Caldera; Preparation of communities in case of escalation of unrest." },
      { monitoring: "Intensifying changes in parameters: VT/ HF earthquake clusters or swarms within shallow depths of the edifice, increase in the intensity and duration of LP/LF events, DLP clusters at lower crustal depths; Sustained or increasing SO2 emission, increased phreatic activity with explosion-type earthquakes or tremor episodes; Increasing ground deformation or inflation of the edifice.", interpretation: "Certain magmatic intrusion into the shallow magma system or edifice, with higher chances of a major eruption; precursory eruptive activity due to disruption of the hydrothermal system; lava dome growth may occur.", recommendation: "Evacuation of upland communities up to 10-kilometers from the summit caldera." },
      { monitoring: "Accelerating changes or abrupt decline in parameters: Strong VT/ HF earthquakes within a few kilometers depth of the edifice with felt intensities, episodic swarms of hybrid or LP earthquakes, episodic tremor with continuous ash emission, sustained and intensifying volcanic tremor, episodic explosion earthquakes with explosive activity; Increasing incidence and magnitudes of volcanic earthquakes; Successive explosions with pronounced eruption columns and small-volume pyroclastic density currents (PDCs); Intense ground deformation or bulging of the summit region; Abrupt increase or drop in SO2/volcanic gas flux.", interpretation: "Phreatomagmatic or pre-climactic magmatic eruption; If magma ascent rates increase, highly explosive eruption probable within hours to a few days; if magma ascent rates decrease, prolonged lava dome growth may occur.", recommendation: "Evacuation of communities within pre-determined hazard zones for PDCs, heavy ashfall and syn-eruption lahars." },
      { monitoring: "Highly explosive magmatic eruption ongoing: Successive explosion-type earthquakes or large-amplitude volcanic tremor and VT earthquakes; Successive or sustained explosions with large eruption column and pronounced umbrella cloud that could exceed 20-kilometer heights above the crater; extensive PDCs emplaced around the edifice; widespread ashfall; syn-eruption lahars.", interpretation: "Climactic Subplinian to Plinian eruption; Volcanic hazards expected within 30-kilometer radius of the crater and downwind of the eruption plume.", recommendation: "Evacuation of additional communities, downwind of the eruption plume, along major river systems and in buffer extensions of hazard zones." },
    ],
    taal: [
      { monitoring: "Background parameters: Volcanic earthquakes typically <5/day; Main Crater Lake gas (diffuse CO2) emission within 1,000 tonnes/day, average water temperature < 35ºC and acidity >pH2.5; General stationary or deflationary trends in ground deformation.", interpretation: "Quiescence; no major eruption in foreseeable future, but steam-driven and gas eruptions can occur without warning.", recommendation: "Permanent habitation on Taal Volcano Island (TVI) must not be allowed." },
      { monitoring: "Abnormal parameters: Moderate level of seismic activity with some felt events; Main Crater Lake gas (diffuse CO2) emission >1,000 tonnes/day, slight increases in fumarole and/or Main Crater Lake temperatures and acidity; Slight and/or localized inflationary ground deformation changes in TVI.", interpretation: "Hydrothermal or tectonic activity beneath the volcano may be occurring; steam-driven, gas or hydrothermal explosions can occur without warning.", recommendation: "Entry into the TVI Main Crater, the Daang Kastila fissure area and the Mt. Tabaro eruption site must not be allowed." },
      { monitoring: "Increasing changes in parameters: Elevated level of seismic activity with some felt events in TVI and Taal Caldera (TC); Occurrence of earthquake swarms and low-frequency events; Sustained increases in inflationary ground deformation including ground tilt in TVI; Slight positive microgravity changes in TVI and TC; Increasing fumarole temperature and acidity and upwelling in the Main Crater Lake; Significant increases in CO2 emission, instrumental detection of airborne SO2 >500 tonnes/day.", interpretation: "Shallow hydrothermal unrest and/or deep-seated magmatic intrusion may be occurring, bringing higher chances of steam-driven, gas or hydrothermal explosions.", recommendation: "Entry into TVI must not be allowed. Communities in pre-defined areas of the highest hazard must ready for possible evacuation." },
      { monitoring: "Intensifying changes in parameters: Sudden increase or decline in seismic activity; Perceptible earthquakes, occurrence of swarms of volcano-tectonic and/or hybrid earthquakes; Elevating SO2 flux; Significant changes in Main Crater Lake temperature and/or acidity; Accelerating increase in ground inflation, rapid increase in ground tilt in TVI; Precursory phreatic or weak phreatomagmatic eruptions commence.", interpretation: "Magmatic or explosive phreatomagmatic eruption is imminent; precursory eruptive activity may be taking place and generating ashfall, ballistics and/or short lava flows.", recommendation: "TVI, Taal Lake and pre-defined lakeshore communities of Batangas facing the active vent must be evacuated." },
      { monitoring: "Accelerating changes or abrupt decline in parameters: Rapidly intensifying volcanic earthquakes, continuous volcanic tremor, frequent felt earthquakes; Profuse degassing or ash explosions along existing or new vents and fissures; Elevated and/or sudden drop in SO2 flux; Accelerating increase or reversal of ground deformation patterns and ground fissuring; Explosive eruption or lava effusion with or without volcanic lightning commence.", interpretation: "Strong phreatomagmatic or magmatic eruption is taking place, which may or may not lead to violently explosive eruption. Widespread ashfall and ballistics, lava flows and minor pyroclastic density currents (PDCs) on TVI may be generated.", recommendation: "Communities in pre-determined worst-case or scenario-based volcanic hazards zones must be evacuated." },
      { monitoring: "Violently explosive magmatic eruption ongoing: Continuous intense seismic activity, including explosion-type volcanic earthquakes and strong felt events; Sustained tall eruption column with expansive umbrella cloud accompanied by loud booming sounds and volcanic lightning; Generation of PDCs/base surges and volcanic tsunami that transport across Taal Lake and lakeshore towns; Ground fissuring and large-particle tephra fall impacting lakeside communities and ashfall impacting farther areas.", interpretation: "Plinian/ Subplinian/ Violent phreatomagmatic eruption is taking place. Extreme life-threatening hazards of base surges/PDCs, volcanic tsunami, thick tephra fall/ashfall, fissuring, lahars and landslides could impact communities around the lake and downwind of the eruption plume.", recommendation: "Additional areas for evacuation should be considered based on prevailing conditions." },
    ],
  };
  const HAZARD_MIN_EARTHQUAKE_MAGNITUDE = 4;
  const HAZARD_MAGNITUDE_BANDS = [
    { min: 4, label: "4.0–4.9", color: "#84cfe0" },
    { min: 5, label: "5.0–5.9", color: "#91c98f" },
    { min: 6, label: "6.0–6.9", color: "#f4d85f" },
    { min: 7, label: "7.0–7.9", color: "#f2a331" },
    { min: 8, label: "≥ 8.0", color: "#e8752f" },
  ];
  // Keep Leaflet's pixel markers in lockstep with the 1rem (16px) legend
  // swatches. The same SVG viewbox geometry drives the legend and map dots.
  const HAZARD_LEGEND_SWATCH_SIZE = 16;
  const HAZARD_VOLCANO_MARKER_SIZE = { width: HAZARD_LEGEND_SWATCH_SIZE * 1.155, height: HAZARD_LEGEND_SWATCH_SIZE };
  const HAZARD_EARTHQUAKE_LEGEND_VIEWBOX = 20;
  const HAZARD_EARTHQUAKE_LEGEND_RADIUS = 8;
  const HAZARD_EARTHQUAKE_LEGEND_INNER_RADIUS = 2.1;
  const HAZARD_EARTHQUAKE_MARKER_RADIUS = HAZARD_LEGEND_SWATCH_SIZE * HAZARD_EARTHQUAKE_LEGEND_RADIUS / HAZARD_EARTHQUAKE_LEGEND_VIEWBOX;
  const HAZARD_EARTHQUAKE_INNER_RADIUS = HAZARD_LEGEND_SWATCH_SIZE * HAZARD_EARTHQUAKE_LEGEND_INNER_RADIUS / HAZARD_EARTHQUAKE_LEGEND_VIEWBOX;
  deepFreeze(HAZARD_VOLCANOES);
  deepFreeze(HAZARD_VOLCANO_STATUS_LABELS);
  deepFreeze(HAZARD_BULUSAN_CRITERIA);
  deepFreeze(HAZARD_KANLAON_CRITERIA);
  deepFreeze(HAZARD_VOLCANO_CRITERIA);
  deepFreeze(HAZARD_MAGNITUDE_BANDS);
  const STANDING_STAGE_COLORS = ["#3aa9e8", "#08b765", "#ffbd59", "#f15b2a"];
  const CHART_DATA_FONT_FAMILY = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  const CHART_UI_FONT_FAMILY = '"Inter", ui-sans-serif, system-ui, sans-serif';
  const state = { geo: {}, lookups: { code: new Map(), codeByLevel: {}, name: new Map(), nameMatches: new Map() }, psgcReference: null, referenceOnlyLocationsAdded: false, maps: {}, baseLayers: {}, baseBounds: {}, boundaryLevels: {}, basemaps: {}, mapControls: {}, mapThemes: {}, mapPalettes: {}, mapLegendPositions: {}, affectedAreasVisible: { "general-map": true }, affectedBoundaryLabelsVisible: { "general-map": false }, affectedAreaLists: {}, affectedBoundaryLabels: {}, affectedBoundaryLabelContext: {}, mapEmptyStateRequested: {}, standingPaletteCustomized: false, selectedLayers: {}, layers: {}, legends: {}, pagasa: {}, coordinateGrids: {}, cartography: {}, overviews: {}, mapLoading: {}, mapCanvasPresets: {}, mapResizePreserveView: {}, initialExtentApplied: {}, mapResizeFrames: {}, mapResizeObservers: {}, mapResizePendingExtent: {}, general: null, standing: null, hazards: null, charts: {}, fullscreenMapId: null, currentMode: "general", helpReturnMode: "general", helpReturnFocus: null, helpModule: "" };
  let baseGeometryPromise = null;
  const statusTimers = new Map();
  const STATUS_TIMEOUTS = { success: 6000, warning: 8000, error: 10000, info: 6000 };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  function fetchWithTimeout(resource, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs || 10000);
    return fetch(resource, { ...(options || {}), signal: controller.signal }).finally(() => window.clearTimeout(timeout));
  }
  const SIDEBAR_STORAGE_KEY = "mapStudio.sidebarOpen";
  const ACTIVE_MODE_STORAGE_KEY = "mapStudio.activeMode";
  const MAP_PREFERENCES_STORAGE_KEY = "mapStudio.mapPreferences.v1";
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  function howToUseMapSections(startNumber, moduleKey) {
    const layerText = moduleKey === "standing"
      ? "Switch basemaps, move the legend, and toggle PAR, TCAD, TCID, the TC track, and distance-buffer overlays."
      : moduleKey === "hazards"
        ? "Switch basemaps, move the legend, and keep the hazard markers and overlays readable on the map."
        : "Switch basemaps, move the legend, and toggle boundary levels, affected areas, affected-boundary labels, and the legend.";
    const clearText = moduleKey === "standing"
      ? "Remove the active crop data, validation state, charts, and mapped values."
      : moduleKey === "hazards"
        ? "Remove the earthquake data and alert values, returning the map and summary to their empty state."
        : "Remove the uploaded CSV, validation state, summary, and mapped values.";
    const layerPopupText = moduleKey === "standing"
      ? "Open Basemap and map layers to choose Default, OpenStreetMap, or Satellite; set the legend position; and toggle PAR, TCAD, TCID, the TC track, and TC buffer."
      : moduleKey === "hazards"
        ? "Open Basemap and map layers to choose Default, OpenStreetMap, or Satellite and set the legend position for the hazard map."
        : "Open Basemap and map layers to choose Default, OpenStreetMap, or Satellite; set the legend position; and toggle boundary levels, affected areas, boundary labels, and the legend.";
    return [
      { title: startNumber + ". Use map controls", layout: "cards-3", items: [
        { label: "Reset map extent", icon: "reset", text: "Return the map to its default extent after panning or zooming." },
        { label: "Zoom in", icon: "plus", text: "Increase the map scale to inspect a smaller area." },
        { label: "Zoom out", icon: "minus", text: "Decrease the map scale to see more of the Philippines." },
        { label: "Fullscreen", icon: "expand", text: "Expand the map to the browser window for a larger working view." },
        { label: "Customize map appearance", icon: "appearance", text: "Choose the map background theme and color palette used by the rendered map." },
        { label: "Basemap and map layers", icon: "layers", text: layerText },
        { label: "Show or hide map actions", icon: "hideControls", text: "Show or hide the map action controls when you need a clearer canvas." },
        { label: "Clear uploaded data", icon: "clear", text: clearText },
        { label: "Copy visible map", icon: "copy", text: "Copy the current map canvas to the clipboard, including its title, legend, labels, and cartography." },
        { label: "Resize map canvas", icon: "resize", text: "Choose a portrait, landscape, wide, or square canvas size before exporting." },
        { label: "Export map as PNG", icon: "download", text: "Download a PNG of the current map canvas with its title, legend, labels, and cartography." },
      ] },
      { title: (startNumber + 1) + ". Read map-control popups", layout: "cards-3", popupPreviews: moduleKey, items: [
        { label: "Background theme and color palette popup", icon: "appearance", text: "Open Customize map appearance to choose a Background theme and Color palette. The canvas colors, grid, labels, fills, and control contrast update immediately." },
        { label: "Basemap and layers popup", icon: "layers", text: layerPopupText },
        { label: "Resize canvas popup", icon: "resize", text: "Open Resize map canvas to view Reset canvas and the Province Portrait, Province Landscape, Province Wide, or Square presets before copying or exporting." },
      ] },
    ];
  }
  const HOW_TO_USE_GUIDES = {
    general: {
      eyebrow: "Boundary Mapping",
      title: "Map CSV file with boundary data",
      intro: "Use a validated CSV to shade Philippine boundaries, inspect location values, and export a clean map image.",
      sections: [
        { title: "1. Prepare your CSV", items: [
          { label: "Required columns", text: "Use PSGC Code, Location Name, then one or more numeric value columns. The downloadable PSGC Mapping Template includes the matching fields." },
          { label: "Template note", text: "The download template includes multiple PSGC validation fields for reference, but an upload only needs one matching identifier column (PSGC_code or correspondence_code), plus location_name and at least one numeric value column." },
          { label: "Location matching", text: "Use a 10-digit PSGC code or 9-digit correspondence code, with or without the PH prefix. Location names are retained as readable reference text." },
        ] },
        { title: "2. Upload and validate", items: [
          { label: "Choose a CSV file", visual: "csv-upload", text: "Select the file in the upload area. The pre-check confirms the CSV shape before you submit it." },
          { label: "Validate", visual: "validate-button", text: "Click Validate to match rows to the bundled PSGC reference. View result opens the validation details, including warnings and skipped rows." },
          { label: "List of Validation Errors", type: "validation-errors", messages: [
            "Choose a CSV file first.",
            "The CSV must not exceed 5 MB.",
            "The CSV needs a header row and at least one data row.",
            "Use at least three columns: PSGC code, location name, and one metric.",
            "The CSV cannot contain more than 50 columns.",
            "The CSV cannot contain more than 5,000 data rows.",
            "Every metric column needs a header.",
            "CSV headers must be unique.",
            "Row N has M columns; expected K.",
            "Location name is blank.",
            "Location name … was not found in the Philippine PSGC database.",
            "Location … has no PSGC code and matches more than one geographic location.",
            "Location … has an unsupported PSGC format (…).",
            "PSGC code … for … was not found in the Philippine PSGC database.",
            "Location mismatch: name … does not match PSGC code ….",
            "[Metric] is not a non-negative number.",
            "This administrative location appears more than once on rows N, M.",
            "[Metric] does not match. The child rows total …, but this parent row contains ….",
            "Dataset-level: No valid data rows were available after validation."
          ] },
          { label: "List of Validation Warnings", type: "validation-warnings", messages: [
            "[Location] · PSGC [code] is recognized by the PSA 2Q 2026 PSGC reference, but its map boundary is not bundled and will not render.",
            "Partial administrative coverage: [n] of [n] [child-level] rows were supplied for this [parent-level] row. This is allowed when the report intentionally covers selected areas. Possible fix: add the remaining [n] row(s) if a complete consolidation is needed."
          ] },
          { label: "List of Validation Info", type: "validation-info", messages: [
            "Dataset-level: Multiple geographic levels are present. HUC rows are treated as Province / HUC; the default map level is [level] because it contains the most rows."
          ] },
          { label: "Clear inputs", visual: "clear-button", text: "Use Clear inputs to remove the current file, map styling, summary, and validation state." },
        ] },
        { title: "3. Configure the map", items: [
          { label: "Map level dropdown", text: "Choose Region, Province / HUC, or Municipality / City from the Map level dropdown. The map redraws using the selected geography." },
          { label: "Metric dropdown", text: "Choose the numeric CSV column from the Metric dropdown. Its values shade the boundaries and populate the summary." },
          { label: "Legend label and unit text inputs", text: "Type a clear label and unit in the Legend label and unit text inputs to describe the selected metric on the map. Double-check both fields so the rendered legend title and unit are correct." },
          { label: "Boundary selection", text: "Select a boundary on the map to open its popup with the location name, geographic level, PSGC code, and mapped value." },
        ] },
        ...howToUseMapSections(4, "general"),
        { title: "6. Read the results", items: [
          { label: "Rendered map", visual: "reference-map", text: "Review the rendered map to see the selected metric shaded across the boundaries, with the legend showing the value ranges." },
          { label: "Legend", text: "Colors represent value ranges; boundaries with no value stay unfilled. The legend updates with the selected metric and unit." },
          { label: "Boundary tooltip", visual: "reference-tooltip", text: "Click a colored boundary to open its tooltip. The popup shows the location name, geographic level, PSGC code, metric, and value." },
        ] },
        { title: "7. Review the Column Summary", items: [
          { label: "Summary graph", visual: "column-summary-reference", text: "The right-side Column Summary lists populated text columns and renders numeric column totals as a horizontal bar graph." },
          { label: "View breakdown", visual: "column-breakdown-reference", text: "Click View breakdown to open the dedicated table view grouped by the selected geographic level, with the source values and totals." },
        ] },
      ],
    },
    standing: {
      eyebrow: "Standing Crops",
      title: "Summarize Corn or Rice",
      intro: "Upload a reviewed Corn or Rice template to compare standing-crop area by geography, classification, and growth stage on a map and in charts.",
      sections: [
        { title: "1. Choose and fill a crop template", items: [
          { label: "Corn template", visual: "standing-template-corn", text: "Download the Corn Standing Crops Template. It has 17 columns for Yellow, White, and Grand Total groups." },
          { label: "Rice template", visual: "standing-template-rice", text: "Download the Rice Standing Crops Template. It has 22 columns for Irrigated, Rainfed, Upland, and Grand Total groups." },
          { label: "Two header rows", visual: "standing-template-headers", text: "Keep the group labels in row 1 and the growth-stage or Total headings in row 2. The first two identifier columns remain PSGC_code and location_name." },
          { label: "Location identifiers", icon: "location", text: "Do not rename the first two columns. Map Studio pairs each row with the PSA 2Q 2026 PSGC reference using the code and location name." },
        ] },
        { title: "2. Upload and validate", items: [
          { label: "Choose corn CSV", visual: "standing-upload-corn", text: "Select the completed Corn file. Pre-validation checks the 17-column shape, two header rows, row widths, and the 5,000-row limit." },
          { label: "Choose rice CSV", visual: "standing-upload-rice", text: "Select the completed Rice file. Pre-validation checks the 22-column shape, two header rows, row widths, and the 5,000-row limit." },
          { label: "Validate", visual: "validate-button", text: "Click the crop card’s Validate button to match locations, check category and Grand Total values, and calculate map and chart data." },
          { label: "View result", visual: "validation-result", text: "Open View result after validation to review file structure, location pairing, geographic normalization, row totals, skipped rows, and source notes." },
          { label: "List of Validation Errors", type: "validation-errors", messages: [
            "A Standing Crops CSV needs two header rows and at least one data row.",
            "The file must contain 17 columns for Corn or 22 columns for Rice.",
            "The first Standing Crops header row must begin with PSGC_code and location_name.",
            "The second header row must leave the PSGC_code and location_name columns blank.",
            "The first header row is missing a crop group label.",
            "The second header row is missing a growth-stage or total column heading.",
            "Row N has M columns; expected K for Corn or Rice Standing Crops.",
            "[Class] · Total does not match. The four growth stages total …, but the uploaded total is ….",
            "Grand Total · [stage] does not match.",
            "Location … was not found in the Philippine PSGC database.",
            "Dataset-level: No valid Standing Crops rows were available after validation."
          ] },
          { label: "List of Validation Warnings", type: "validation-warnings", messages: [
            "[Location] · PSGC [code] is recognized by the PSA 2Q 2026 PSGC reference, but its map boundary is not bundled and will not render.",
            "Partial administrative coverage: [n] of [n] child rows were supplied for this parent row."
          ] },
          { label: "List of Validation Info", type: "validation-info", messages: [
            "Source lineage: national aggregate rows, blank historical grouping rows, and HUC source-detail rows may be excluded from map analysis to avoid double counting."
          ] },
          { label: "Clear inputs", visual: "clear-button", text: "Use Clear inputs to remove the current crop file, validation state, charts, and mapped values." },
        ] },
        { title: "3. Configure the crop map", items: [
          { label: "Commodity selector", visual: "standing-filters", text: "When both files are loaded, use Commodity to switch between Corn and Rice without uploading again." },
          { label: "Map crops by boundary", icon: "map", text: "Choose Province / HUC or Municipality / City under Map level to shade crop area by administrative boundary. Select a boundary on the map to inspect its exact crop, class, stage, and area value." },
          { label: "Map level", text: "Choose Region, Province / HUC, or Municipality / City. The available levels follow the validated crop rows, with the deepest available level selected by default." },
          { label: "Classification", text: "Choose All classifications or one class: Yellow / White for Corn, or Irrigated / Rainfed / Upland for Rice." },
          { label: "Growth stage", text: "Choose Total area or Newly planted / Seedling, Vegetative, Reproductive, or Maturity. The palette, legend, map, and charts update together." },
          { label: "PAGASA layers", icon: "layers", text: "The Standing Crops map can show PAR, TCAD, TCID, the live TC track, and 50 / 100 / 150 km TC buffers. If the DOST-PAGASA feed is unavailable, the map reports that the live track cannot be loaded." },
        ] },
        { title: "4. Read the map and charts", items: [
          { label: "Rendered crop map", visual: "standing-map", text: "Review the selected crop, class, and stage shaded across the chosen geographic level. Boundaries without an area value remain unfilled." },
          { label: "Boundary popup", visual: "standing-popup", text: "Select a boundary to inspect its location, geographic level, classification, growth stage, and mapped area value." },
          { label: "Regional Breakdown", visual: "standing-region-chart", text: "The stacked bar chart compares area by region and growth stage. Hover a bar for exact values and the total." },
          { label: "Stage and classification charts", visual: "standing-donut-charts", text: "Donut charts summarize area by growth stage and crop classification. Each tooltip shows the area and share." },
          { label: "Chart tooltips", text: "Hover a regional bar or doughnut segment to see exact area values and, for doughnut charts, the share of the total." },
        ] },
        ...howToUseMapSections(5, "standing"),
        { title: "7. Verify and reset", items: [
          { label: "Trust the validation state", text: "A clean result confirms that the template structure, location pairing, geographic levels, and row totals were checked. Review warnings before interpreting partial coverage." },
          { label: "Source lineage", text: "National aggregates, historical grouping rows, and HUC source-detail rows can be retained as notes but excluded from map analysis when they would double count mapped rows." },
          { label: "Clear inputs", text: "Use Clear inputs to remove the active crop data, or clear the individual Corn or Rice upload card when you want to replace one file." },
        ] },
      ],
    },
    hazards: {
      eyebrow: "Geologic Hazards",
      title: "Monitor volcanoes and earthquakes",
      intro: "Combine PHIVOLCS volcano alert levels with earthquake events above magnitude 4.0 on one map, with a clear summary and criteria reference.",
      sections: [
        { title: "1. Enter volcano alerts", items: [
          { label: "Alert level fields", visual: "hazard-alert-form", text: "Enter an integer from 0 to 5 for Bulusan, Kanlaon, Mayon, Pinatubo, and Taal. Level 0 remains a visible reference point." },
          { label: "Alert levels as of", text: "Choose the date represented by the alert levels. The input displays MMM DD, YYYY and rejects dates later than today." },
          { label: "Status colors", text: "The volcano input, map triangle, legend, and Summary status use the established PHIVOLCS alert-level colors and volcano-specific status labels." },
          { label: "Validation rule", type: "validation-errors", messages: [
            "Each volcano alert level must be an integer from 0 to 5.",
            "Alert levels date cannot be later than today."
          ] },
        ] },
        { title: "2. Load earthquake events", items: [
          { label: "Choose earthquake CSV", visual: "hazard-earthquake-upload", text: "Use the Earthquake Template or a compatible DOST-PHIVOLCS CSV with Date - Time, Latitude, Longitude, Depth, Mag, and Location." },
          { label: "Update map", visual: "update-map-button", text: "Choose an earthquake CSV before clicking Update map. The parser accepts a units row when present and reports invalid rows that were skipped." },
          { label: "Magnitude filter", text: "Only events with magnitude greater than 4.0 render on the map and count in the Summary. Smaller events are ignored by the display threshold." },
          { label: "Date reference", text: "The map title reports the detected earthquake date range using a compact month format and avoiding duplicate month names when possible." },
          { label: "List of CSV validation errors", type: "validation-errors", messages: [
            "The earthquake CSV needs a header row and at least one event row.",
            "Earthquake CSV is missing required column(s): date/time, latitude, longitude, depth, magnitude, or location.",
            "The earthquake CSV cannot contain more than 12 columns.",
            "Row N has M columns; expected K.",
            "Row N has an invalid date/time, latitude, longitude, depth, magnitude, or location.",
            "No valid earthquake events were found in the CSV."
          ] },
        ] },
        { title: "3. Read the hazard map", items: [
          { label: "Volcano markers", visual: "hazard-map", text: "Triangles show Bulusan, Kanlaon, Mayon, Pinatubo, and Taal. Their fill color identifies the current alert level." },
          { label: "Earthquake markers", text: "Earthquakes use a colored circle with a centered dot. Color identifies the magnitude band and marker size follows the map’s earthquake symbol scale." },
          { label: "Hazard popup", text: "Select a volcano or earthquake to see its name, alert or magnitude band, date/time, depth, coordinates, and other available details." },
        ] },
        { title: "4. Read the summary and criteria", items: [
          { label: "Volcano status", visual: "hazard-summary", text: "The Summary card lists the five volcanoes with their current PHIVOLCS status descriptions." },
          { label: "Earthquake summary", text: "Review Total events above M4.0 and the count in each magnitude band: 4.0–4.9, 5.0–5.9, 6.0–6.9, 7.0–7.9, and ≥ 8.0." },
          { label: "View criteria", visual: "hazard-criteria", text: "Open the row-per-volcano table to read the monitoring criteria plus the current level’s interpretation and recommendation." },
          { label: "Invalid rows", text: "If the CSV contains malformed records, the Summary reports how many were skipped while valid events remain available for mapping." },
        ] },
        ...howToUseMapSections(5, "hazards"),
        { title: "7. Verify and reset", items: [
          { label: "No data state", text: "Before a CSV is submitted, the map and legend show No data loaded. The loading animation appears alone while data is being processed." },
          { label: "Clear inputs", visual: "clear-button", text: "Clear inputs removes the earthquake data and alert values, returning the map and summary to their empty state." },
        ] },
      ],
    },
    psgc: {
      eyebrow: "PSGC 2Q 2026",
      title: "Browse the geographic reference",
      intro: "Use the bundled PSA Philippine Standard Geographic Code reference to search codes, names, administrative levels, and hierarchy context used by the map modules.",
      sections: [
        { title: "1. Search the reference", items: [
          { label: "Search reference", visual: "psgc-search", text: "Enter a PSGC code, correspondence code, location name, region, or province. Results filter as you type across all of those fields." },
          { label: "Search behavior", text: "The search is case-insensitive and normalizes punctuation, so a code or location name remains findable when spacing or punctuation differs." },
          { label: "Geographic level", visual: "psgc-level-filter", text: "Filter the table to Region, Province / HUC, Municipality / City, or All levels." },
        ] },
        { title: "2. Filter and browse", items: [
          { label: "Result count", text: "The upper-right count updates with the current search and level filter, showing records or a clear no-matches state." },
          { label: "All levels", visual: "psgc-hierarchy", text: "Choose All levels to see Region, Province / HUC, and Municipality / City rows together. Parent rows use visual hierarchy and remain sticky while you scroll." },
          { label: "Context columns", text: "The table adds Province / HUC and Region context when the selected level needs it, so a municipality remains tied to its administrative parents." },
        ] },
        { title: "3. Read the table", items: [
          { label: "Reference columns", visual: "psgc-table", text: "Each row shows the PSGC code, correspondence code, location name, and geographic level; filtered views include the relevant parent context columns." },
          { label: "Codes", text: "Treat the PSGC code and correspondence code as copy-ready identifiers for uploads and matching. The table’s location name and level help confirm that the code is correct." },
          { label: "No matches", text: "If the table says No matching PSGC records, broaden the search or choose All levels before checking the spelling or code." },
        ] },
        { title: "4. Use the reference in uploads", items: [
          { label: "Boundary Mapping", icon: "map", text: "Copy a PSGC code or correspondence code into the first column of a metric CSV and confirm the location name in the next column." },
          { label: "Standing Crops", icon: "metric", text: "Keep the crop template’s PSGC_code and location_name fields aligned with the matching row in this reference." },
          { label: "Geologic Hazards", icon: "location", text: "Hazards uses fixed PHIVOLCS volcano points and a locally uploaded earthquake CSV rather than PSGC rows." },
        ] },
        { title: "5. Confirm the reference scope", items: [
          { label: "Publication", text: "This bundled reference is the PSA Philippine Standard Geographic Code 2Q 2026 publication dated 30 June 2026." },
          { label: "Map geometry", text: "A location can be recognized in the reference even when a corresponding Map Studio boundary is not bundled; mapping guides identify that condition as a warning." },
          { label: "Use as a matching aid", text: "Use the table to verify identifiers and hierarchy before uploading. The mapping modules still validate every uploaded row locally." },
        ] },
      ],
    },
  };
  const fmt = (value, digits) => Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: digits || 0 });
  const GENERAL_BAR_VALUE_LABELS_PLUGIN = {
    id: "generalBarValueLabels",
    afterDatasetsDraw(chart) {
      const dataset = chart.data.datasets[0];
      const bars = chart.getDatasetMeta(0)?.data || [];
      const chartArea = chart.chartArea;
      if (!dataset || !chartArea || !bars.length) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 9px " + CHART_DATA_FONT_FAMILY;
      ctx.textBaseline = "middle";
      bars.forEach((bar, index) => {
        const value = Number(dataset.data[index]);
        if (!Number.isFinite(value)) return;
        const label = fmt(value, 2);
        const width = ctx.measureText(label).width;
        const positive = value >= 0;
        let x = positive ? bar.x + 6 : bar.x - 6;
        let align = positive ? "left" : "right";
        let color = "#53655a";
        if (positive && x + width > chartArea.right && bar.x - width - 6 > chartArea.left) {
          x = bar.x - 6;
          align = "right";
          color = "#ffffff";
        } else if (!positive && x - width < chartArea.left && bar.x + width + 6 < chartArea.right) {
          x = bar.x + 6;
          align = "left";
          color = "#ffffff";
        }
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.fillText(label, x, bar.y);
      });
      ctx.restore();
    },
  };
  const fileSizeLabel = (bytes) => bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / (1024 * 1024)).toFixed(1) + " MB";
  const levelLabel = (level) => LEVEL_LABELS[level] || level;
  function ensureMapLoadingOverlay(id) {
    const map = state.maps[id];
    if (!map || id.includes("-export-")) return null;
    const container = map.getContainer();
    let overlay = container.querySelector(".map-studio-loading");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "map-studio-loading";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-atomic", "true");
    overlay.innerHTML = '<img class="map-studio-loading__animation" src="' + mapAsset("assets/map-loader.gif") + '" alt="" aria-hidden="true"><span class="map-studio-loading__status">Loading map layers…</span>';
    container.appendChild(overlay);
    return overlay;
  }
  function restoreMapEmptyStateAfterLoading(id) {
    const delay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 160;
    window.setTimeout(() => {
      if (state.mapLoading[id]?.tasks?.size) return;
      setMapEmptyState(id, state.mapEmptyStateRequested[id] ?? false);
    }, delay);
  }
  function beginMapLoading(id, label) {
    const overlay = ensureMapLoadingOverlay(id);
    if (!overlay) return () => {};
    const loading = state.mapLoading[id] || { tasks: new Map() };
    const token = Symbol(id + "-loading");
    loading.tasks.set(token, label || "Loading map layers…");
    state.mapLoading[id] = loading;
    // Keep the loading indicator as the only visible map status. The empty
    // state is restored by the final task when its requested visibility still
    // applies (for example, after base layers finish with no upload).
    setMapEmptyState(id, state.mapEmptyStateRequested[id] ?? false);
    overlay.querySelector(".map-studio-loading__status").textContent = loading.tasks.get(token);
    overlay.classList.add("is-visible");
    state.maps[id].getContainer().setAttribute("aria-busy", "true");
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      loading.tasks.delete(token);
      if (loading.tasks.size) {
        const labels = [...loading.tasks.values()];
        overlay.querySelector(".map-studio-loading__status").textContent = labels[labels.length - 1];
        return;
      }
      overlay.classList.remove("is-visible");
      state.maps[id]?.getContainer().removeAttribute("aria-busy");
      // Let the GIF fade out completely before revealing the empty-state card.
      restoreMapEmptyStateAfterLoading(id);
    };
  }
  function setMapEmptyState(id, visible) {
    state.mapEmptyStateRequested[id] = Boolean(visible);
    const map = state.maps[id];
    if (!map || id.includes("-export-")) return;
    const container = map.getContainer();
    let empty = container.querySelector(".map-studio-empty-state");
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "map-studio-empty-state";
      empty.setAttribute("role", "status");
      const title = document.createElement("strong");
      title.textContent = "No data loaded";
      empty.append(title);
      container.appendChild(empty);
    }
    const loading = Boolean(state.mapLoading[id]?.tasks?.size);
    const showEmptyState = Boolean(visible) && !loading;
    empty.hidden = !showEmptyState;
    empty.setAttribute("aria-hidden", showEmptyState ? "false" : "true");
  }
  const normalizePaletteKey = (value, fallback) => {
    const aliases = { green: "ylgn", yellow: "ylorrd" };
    const normalized = aliases[value] || value;
    return Object.prototype.hasOwnProperty.call(MAP_PALETTES, normalized) ? normalized : fallback;
  };
  const normalizeLegendPosition = (value, fallback) => ["bottomleft", "topleft"].includes(value) ? value : (fallback || "bottomleft");
  function loadMapPreferences(id) {
    const defaults = { theme: id === "standing-map" ? "light" : "lightest", basemap: "default", palette: id === "standing-map" ? STANDING_DEFAULT_PALETTES.corn : "blue", legendPosition: "bottomleft" };
    try {
      const saved = JSON.parse(localStorage.getItem(MAP_PREFERENCES_STORAGE_KEY) || "{}")[id] || {};
      return {
        theme: Object.prototype.hasOwnProperty.call(MAP_THEMES, saved.theme) ? saved.theme : defaults.theme,
        basemap: Object.prototype.hasOwnProperty.call(MAP_BASEMAPS, saved.basemap) ? saved.basemap : defaults.basemap,
        palette: normalizePaletteKey(saved.palette, defaults.palette),
        legendPosition: normalizeLegendPosition(saved.legendPosition, defaults.legendPosition),
        paletteCustomized: id === "standing-map" && saved.paletteCustomized === true,
      };
    } catch (_) {
      return defaults;
    }
  }
  function saveMapPreferences(id) {
    try {
      const preferences = JSON.parse(localStorage.getItem(MAP_PREFERENCES_STORAGE_KEY) || "{}");
      preferences[id] = { theme: state.mapThemes[id], basemap: state.basemaps[id]?.key || "default", palette: state.mapPalettes[id], legendPosition: normalizeLegendPosition(state.mapLegendPositions[id]), ...(id === "standing-map" ? { paletteCustomized: state.standingPaletteCustomized } : {}) };
      localStorage.setItem(MAP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch (_) { /* storage unavailable */ }
  }
  const REGION_NAME_ALIASES = {
    barmm: "Bangsamoro Autonomous Region In Muslim Mindanao (BARMM)",
    car: "Cordillera Administrative Region (CAR)",
    ncr: "National Capital Region (NCR)",
    nir: "Negros Island Region (NIR)",
    "rfo i": "Region I (Ilocos Region)",
    "rfo ii": "Region II (Cagayan Valley)",
    "rfo iii": "Region III (Central Luzon)",
    "rfo iva": "Region IV-A (CALABARZON)",
    "rfo iv a": "Region IV-A (CALABARZON)",
    "rfo ivb": "MIMAROPA Region",
    "rfo iv b": "MIMAROPA Region",
    "rfo v": "Region V (Bicol Region)",
    "rfo vi": "Region VI (Western Visayas)",
    "rfo vii": "Region VII (Central Visayas)",
    "rfo viii": "Region VIII (Eastern Visayas)",
    "rfo ix": "Region IX (Zamboanga Peninsula)",
    "rfo x": "Region X (Northern Mindanao)",
    "rfo xi": "Region XI (Davao Region)",
    "rfo xii": "Region XII (SOCCSKSARGEN)",
    "rfo xiii": "Region XIII (Caraga)",
  };
  const normalizeName = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  function locationNameVariants(value) {
    let normalized = normalizeName(value).replace(/\bnot a province\b/g, "").replace(/\s+/g, " ").trim();
    normalized = normalizeName(REGION_NAME_ALIASES[normalized] || normalized);
    const variants = new Set([normalized]);
    if (normalized.startsWith("city of ")) variants.add(normalized.slice(8));
    if (normalized.endsWith(" city")) variants.add(normalized.slice(0, -5));
    return [...variants].filter(Boolean);
  }
  const codeVariants = (value) => {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return [];
    const digits = raw.replace(/\D/g, "");
    const variants = [raw, raw.replace(/^PH/, ""), digits];
    if (digits.length === 2) variants.push("PH" + digits, "PH" + digits + "00000000");
    return [...new Set(variants.filter(Boolean))];
  };
  const locationCodeVariants = (value) => {
    const variants = codeVariants(value);
    const digits = String(value || "").trim().replace(/\D/g, "");
    // CSV exports often coerce PSGC codes to numbers and drop the leading
    // zero. Restore the two canonical widths used by the boundary assets:
    // 10-digit official PSGC codes and 9-digit correspondence codes.
    if (digits.length === 9) variants.push("0" + digits);
    if (digits.length === 8) variants.push("0" + digits);
    const padded = digits.length === 9 || digits.length === 8 ? "0" + digits : "";
    if (padded) variants.push("PH" + padded);
    return [...new Set(variants.filter(Boolean))];
  };
  function psgcCodeInfo(value) {
    const raw = String(value == null ? "" : value).trim().toUpperCase();
    const digits = raw.replace(/\D/g, "");
    const hasPrefix = /^PH/.test(raw);
    const format = digits.length === 10 ? "10-digit PSGC" : digits.length === 9 ? "9-digit correspondence / PSGC" : digits.length === 8 ? "8-digit spreadsheet-shortened correspondence" : "Unsupported PSGC format";
    return { raw, digits, hasPrefix, format, valid: [8, 9, 10].includes(digits.length) && (!/[A-Z]/.test(raw.replace(/^PH/, ""))) };
  }
  function setCodeLookup(variant, location) {
    const levelLookup = state.lookups.codeByLevel[location.level] || (state.lookups.codeByLevel[location.level] = new Map());
    const levelExisting = levelLookup.get(variant);
    const locationIsCanonical = location.sourceLevel === location.level;
    const existingIsCanonical = levelExisting?.sourceLevel === levelExisting?.level;
    if (!levelExisting || (locationIsCanonical && !existingIsCanonical)) levelLookup.set(variant, location);
    const existing = state.lookups.code.get(variant);
    if (!existing || LOCATION_LOOKUP_PRIORITY[location.level] > LOCATION_LOOKUP_PRIORITY[existing.level] || (location.level === existing.level && locationIsCanonical && existing.sourceLevel !== existing.level)) state.lookups.code.set(variant, location);
  }
  function locationIdentityCodeValues(location) {
    const properties = location?.properties || {};
    return [location?.code, properties.psgc_code, properties.psgc_id, properties.correspondence_code].filter((value) => String(value || "").trim());
  }
  function registerLookupLocation(location) {
    // Register only identifiers owned by this location. Parent and ancestor
    // fields (parent_psgc_code, ADM1_PCODE, etc.) describe the hierarchy and
    // must never overwrite the region/province/municipality that owns them.
    locationIdentityCodeValues(location).forEach((value) => locationCodeVariants(value).forEach((variant) => setCodeLookup(variant, location)));
    locationNameVariants(location.name).forEach((nameKey) => {
      if (!state.lookups.name.has(location.sourceLevel + ":" + nameKey)) state.lookups.name.set(location.sourceLevel + ":" + nameKey, location);
      const matches = state.lookups.nameMatches.get(nameKey) || [];
      if (!matches.includes(location)) matches.push(location);
      state.lookups.nameMatches.set(nameKey, matches);
    });
  }
  function locationCodeSet(location) {
    const values = locationIdentityCodeValues(location).flatMap((value) => locationCodeVariants(value));
    return new Set(values);
  }
  function sameLocation(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    for (const code of locationCodeSet(left)) if (locationCodeSet(right).has(code)) return true;
    return false;
  }
  function isHucFeature(properties) {
    return String(properties?.city_class || properties?.geographic_level || properties?.reporting_area_type || "").trim().toUpperCase() === "HUC";
  }
  function isNcrFeature(properties) {
    const regionCode = String(properties?.region_code || properties?.ADM1_PCODE || "").trim().toUpperCase();
    const regionName = normalizeName(properties?.region_name || properties?.ADM1_EN || "");
    return regionCode === "PH13" || regionName.includes("national capital") || locationCodeVariants(properties?.psgc_code || properties?.psgc_id).some((code) => code.replace(/^PH/, "").startsWith("13"));
  }
  function normalizedGeoLevel(requestedLevel, properties) {
    if (requestedLevel === "municipality_city" && isHucFeature(properties) && !isNcrFeature(properties)) return "province_huc";
    return requestedLevel;
  }
  function canonicalDigits(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 9 ? "0" + digits : digits;
  }
  function psgcReferenceFor(value) {
    const code = canonicalDigits(value);
    return code.length === 10 ? state.psgcReference?.byCode.get(code) || null : null;
  }
  async function loadPsgcReference() {
    if (state.psgcReference) return state.psgcReference;
    const response = await fetchWithTimeout(mapAsset("assets/psgc_lookup.json"), {}, 10000);
    if (!response.ok) throw new Error("Unable to load the PSA PSGC reference.");
    const reference = await response.json();
    state.psgcReference = { ...reference, byCode: new Map((reference.rows || []).map((row) => [canonicalDigits(row.psgc_code), row])) };
    return state.psgcReference;
  }
  function psgcReferenceTableColumns(selectedLevel) {
    const columns = [
      { key: "psgc_code", label: "PSGC Code", className: "psgc-reference-code" },
      { key: "correspondence_code", label: "Correspondence Code", className: "psgc-reference-code" },
      { key: "name", label: "Location Name", rowHeader: true },
      { key: "level", label: "Geographic Level", formatter: psgcReferenceGeographicLevelLabel },
    ];
    if (!selectedLevel || selectedLevel === "municipality_city") columns.push({ key: "province", label: "Province / HUC" });
    if (!selectedLevel || selectedLevel !== "region") columns.push({ key: "region", label: "Region" });
    return columns;
  }
  function psgcReferenceTableHead(columns) {
    return "<tr>" + columns.map((column) => "<th scope=\"col\">" + esc(column.label) + "</th>").join("") + "</tr>";
  }
  function psgcReferenceLevel(row) {
    return row.level === "municipality_city" && isReferenceHuc(row) ? "province_huc" : row.level;
  }
  function psgcReferenceGeographicLevelLabel(row) {
    const sourceLevel = String(row.geographic_level || "").trim();
    if (String(row.city_class || "").trim().toUpperCase() === "HUC") return "HUC";
    return ({ Reg: "Region", Prov: "Province", City: "City", Mun: "Municipality" }[sourceLevel]) || (sourceLevel || levelLabel(psgcReferenceLevel(row)));
  }
  function comparePsgcReferenceRows(left, right) {
    const leftCode = canonicalDigits(left.psgc_code) || "9999999999";
    const rightCode = canonicalDigits(right.psgc_code) || "9999999999";
    const codeOrder = leftCode.localeCompare(rightCode, "en");
    if (codeOrder) return codeOrder;
    const levelOrder = { region: 0, province_huc: 1, municipality_city: 2 };
    return (levelOrder[psgcReferenceLevel(left)] ?? 9) - (levelOrder[psgcReferenceLevel(right)] ?? 9);
  }
  let psgcReferenceStickyFrame = null;
  function schedulePsgcReferenceStickyRows() {
    if (psgcReferenceStickyFrame !== null) return;
    psgcReferenceStickyFrame = window.requestAnimationFrame(() => {
      psgcReferenceStickyFrame = null;
      syncPsgcReferenceStickyRows();
    });
  }
  function syncPsgcReferenceStickyRows() {
    const wrap = $(".psgc-reference-table-wrap");
    const table = $(".psgc-reference-table");
    const body = $("#psgc-reference-body");
    if (!wrap || !table || !body) return;
    const rows = [...body.querySelectorAll("tr[data-psgc-level]")];
    const regionRows = rows.filter((row) => row.dataset.psgcLevel === "region");
    const provinceRows = rows.filter((row) => row.dataset.psgcLevel === "province_huc");
    rows.forEach((row) => row.classList.remove("psgc-reference-sticky-region", "psgc-reference-sticky-province"));
    if (!table.classList.contains("psgc-reference-table--all-levels") || !regionRows.length) return;
    const head = table.querySelector("thead");
    const headHeight = head?.getBoundingClientRect().height || 36;
    wrap.style.setProperty("--psgc-reference-table-head-height", headHeight + "px");
    const wrapTop = wrap.getBoundingClientRect().top;
    const threshold = wrapTop + headHeight + 1;
    const currentRegion = regionRows.filter((row) => row.getBoundingClientRect().top <= threshold).at(-1);
    if (!currentRegion) return;
    currentRegion.classList.add("psgc-reference-sticky-region");
    const regionHeight = currentRegion.getBoundingClientRect().height || 34;
    wrap.style.setProperty("--psgc-reference-region-height", regionHeight + "px");
    const currentRegionKey = currentRegion.dataset.psgcRegion;
    const provinceThreshold = threshold + regionHeight;
    const currentProvince = provinceRows
      .filter((row) => row.dataset.psgcRegion === currentRegionKey && row.getBoundingClientRect().top <= provinceThreshold)
      .at(-1);
    currentProvince?.classList.add("psgc-reference-sticky-province");
  }
  function psgcReferenceTableRow(row, columns, allLevels) {
    const value = (field) => row[field] || "—";
    const effectiveLevel = psgcReferenceLevel(row);
    const rowClass = allLevels && ["region", "province_huc", "municipality_city"].includes(effectiveLevel) ? " class=\"psgc-reference-row--" + effectiveLevel + "\"" : "";
    const rowData = allLevels ? " data-psgc-level=\"" + esc(effectiveLevel) + "\" data-psgc-region=\"" + esc(normalizeName(row.region || row.name)) + "\"" : "";
    return "<tr" + rowClass + rowData + ">" + columns.map((column) => {
      const tag = column.rowHeader ? "th" : "td";
      const className = column.className ? " class=\"" + column.className + "\"" : "";
      const content = column.formatter ? column.formatter({ ...row, level: effectiveLevel }) : value(column.key);
      return "<" + tag + className + (column.rowHeader ? " scope=\"row\"" : "") + ">" + esc(content) + "</" + tag + ">";
    }).join("") + "</tr>";
  }
  async function renderPsgcReference() {
    const table = $(".psgc-reference-table"); const head = $("#psgc-reference-head"); const body = $("#psgc-reference-body"); const count = $("#psgc-reference-count"); const status = $("#psgc-reference-status");
    if (!body || !count || !status) return;
    const levelSelect = $("#psgc-reference-level-select");
    const selectedLevel = levelSelect ? levelSelect.value : "region";
    const columns = psgcReferenceTableColumns(selectedLevel);
    table?.classList.toggle("psgc-reference-table--all-levels", selectedLevel === "");
    if (head) head.innerHTML = psgcReferenceTableHead(columns);
    if (!state.psgcReference) {
      body.innerHTML = '<tr><td class="psgc-reference-empty" colspan="' + columns.length + '">Loading PSA PSGC reference…</td></tr>';
      count.textContent = "Loading reference…";
      try { await loadPsgcReference(); } catch (error) {
        count.textContent = "Reference unavailable";
        status.hidden = false;
        status.textContent = error.message || "Unable to load the PSA PSGC reference.";
        body.innerHTML = '<tr><td class="psgc-reference-empty" colspan="' + columns.length + '">The PSA PSGC reference could not be loaded.</td></tr>';
        return;
      }
    }
    const query = normalizeName($("#psgc-reference-search-input")?.value || "");
    const rows = state.psgcReference.rows || [];
    const filtered = rows.filter((row) => {
      if (selectedLevel && psgcReferenceLevel(row) !== selectedLevel) return false;
      if (!query) return true;
      return normalizeName([row.psgc_code, row.correspondence_code, row.name, row.region, row.province].join(" ")).includes(query);
    }).sort(comparePsgcReferenceRows);
    count.textContent = fmt(filtered.length) + (filtered.length === 1 ? " record" : " records");
    status.hidden = true;
    status.textContent = "";
    body.innerHTML = filtered.length ? filtered.map((row) => psgcReferenceTableRow(row, columns, selectedLevel === "")).join("") : '<tr><td class="psgc-reference-empty" colspan="' + columns.length + '">No matching PSGC records.</td></tr>';
    syncPsgcReferenceStickyRows();
  }
  function referenceOnlyLocation(row) {
    const properties = {
      psgc_code: row.psgc_code,
      psgc_name: row.name,
      correspondence_code: row.correspondence_code || "",
      geographic_level: row.geographic_level || "",
      city_class: row.city_class || "",
      parent_psgc_code: row.parent_psgc_code || "",
      region_name: row.region || "",
      province_huc_name: row.province || "",
      psgc_type: row.level,
    };
    return { feature: null, properties, sourceLevel: "reference", level: row.level, code: row.psgc_code, name: row.name, region: properties.region_name, province: properties.province_huc_name, parentCode: row.parent_psgc_code || "", reportingAreaType: "", hasGeometry: false };
  }
  function addReferenceOnlyLocations() {
    if (state.referenceOnlyLocationsAdded || !state.psgcReference) return;
    const mappedCodes = new Set();
    LEVEL_ORDER.forEach((level) => (state.geo[level]?.features || []).forEach((feature) => {
      const code = canonicalDigits(feature.properties?.psgc_code || feature.properties?.psgc_id);
      if (code.length === 10) mappedCodes.add(code);
    }));
    state.psgcReference.rows.forEach((row) => {
      const code = canonicalDigits(row.psgc_code);
      if (code.length === 10 && !mappedCodes.has(code)) registerLookupLocation(referenceOnlyLocation(row));
    });
    state.referenceOnlyLocationsAdded = true;
  }
  function locationRegionCode(location) {
    const properties = location?.properties || {};
    const explicit = canonicalDigits(properties.region_code || properties.ADM1_PCODE);
    if (explicit.length >= 2) return explicit.length === 2 ? explicit + "00000000" : explicit;
    const locationCode = canonicalDigits(location?.code);
    return locationCode.length === 10 ? locationCode.slice(0, 2) + "00000000" : "";
  }
  function reportingAreaCodeForLocation(location) {
    const locationCode = canonicalDigits(location?.code);
    if (locationRegionCode(location) === NCR_REGION_CODE) return NCR_REGION_CODE;
    if (locationCode === CITY_OF_ISABELA_LOCATION_CODE) return CITY_OF_ISABELA_REPORTING_CODE;
    if (isHucFeature(location?.properties || {})) return locationCode;
    return locationCode.length === 10 ? locationCode.slice(0, 5) + "00000" : "";
  }
  function uniqueLocations(locations) {
    const unique = new Map();
    locations.forEach((location) => {
      const key = locationCodeVariants(location.code)[0] || location.level + ":" + normalizeName(location.name);
      if (!unique.has(key)) unique.set(key, location);
    });
    return [...unique.values()];
  }
  function nameMatches(name) {
    return uniqueLocations(locationNameVariants(name).flatMap((variant) => state.lookups.nameMatches.get(variant) || []));
  }
  function namedLocation(name, level) {
    return nameMatches(name).find((location) => location.level === level) || null;
  }
  function matchUploadedLocation(code, name) {
    const normalizedName = normalizeName(name);
    const codeInfo = psgcCodeInfo(code);
    if (!normalizedName) return { error: "Location name is blank." };
    const candidates = nameMatches(name);
    if (!String(code || "").trim()) {
      if (!candidates.length) return { error: "Location name “" + String(name || "blank") + "” was not found in the Philippine PSGC database." };
      if (candidates.length === 1) return { location: candidates[0], codeInfo: null, nameOnly: true };
      return { error: "Location “" + String(name) + "” has no PSGC code and matches more than one geographic location. Add a 9-digit correspondence code or 10-digit PSGC code." };
    }
    if (!codeInfo.valid) return { error: "Location “" + String(name) + "” has an unsupported PSGC format (“" + String(code) + "”). Use a 9-digit correspondence code, a 10-digit PSGC code, or the same code with a PH prefix." };
    const codeLocation = locationCodeVariants(code).map((variant) => state.lookups.code.get(variant)).find(Boolean);
    if (!codeLocation) return { error: "PSGC code “" + String(code) + "” for “" + String(name) + "” was not found in the Philippine PSGC database." };
    if (!candidates.some((candidate) => sameLocation(candidate, codeLocation))) {
      return { error: "Location mismatch: name “" + String(name) + "” does not match PSGC code “" + String(code) + "” (" + codeLocation.name + ")." };
    }
    return { location: codeLocation, codeInfo };
  }
  function datasetLevelInfo(rows) {
    const counts = Object.fromEntries(LEVEL_ORDER.map((level) => [level, 0]));
    rows.forEach((row) => { if (Object.prototype.hasOwnProperty.call(counts, row.location.level)) counts[row.location.level] += 1; });
    const observed = LEVEL_ORDER.filter((level) => counts[level] > 0);
    const defaultLevel = observed.reduce((best, level) => counts[level] > counts[best] || (counts[level] === counts[best] && LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(best)) ? level : best, observed[0] || "region");
    const firstObserved = observed.length ? Math.min(...observed.map((level) => LEVEL_ORDER.indexOf(level))) : LEVEL_ORDER.length - 1;
    return { counts, observed, defaultLevel, availableLevels: LEVEL_ORDER.slice(firstObserved) };
  }
  function validationState(errors, warnings) {
    return errors.length ? "error" : warnings.length ? "warning" : "valid";
  }
  function validationStatusText(validation) {
    if (!validation) return "";
    if (validation.state === "error") return "Needs correction · " + fmt(validation.errors.length) + " validation error(s). Open View result for details.";
    if (validation.state === "warning") return "Validated with warnings · " + fmt(validation.matchedRowCount) + " matched rows · " + fmt(validation.warnings.length) + " warning(s). Open View result for details.";
    return "Validated " + fmt(validation.matchedRowCount) + " matched rows.";
  }
  function validationIssueRank(issue) {
    const message = String(issue || "");
    if (/^Dataset-level:/i.test(message)) return 0;
    if (/header|columns?; expected|data row|CSV cannot|Every metric column|CSV headers must/i.test(message)) return 10;
    if (/Location mismatch|PSGC code|Location name|Philippine PSGC database|unsupported PSGC format/i.test(message)) return 20;
    if (/invalid .* value|invalid .* total|not a non-negative number/i.test(message)) return 30;
    if (/appears more than once|duplicate/i.test(message)) return 40;
    if (/four growth stages|stages total|totals sum|category totals|row total/i.test(message)) return 45;
    if (/does not match|Partial administrative coverage|administrative consolidation/i.test(message)) return 50;
    return 60;
  }
  function orderValidationIssues(issues) {
    return (issues || []).map((issue, index) => ({ issue, index })).sort((left, right) => validationIssueRank(left.issue) - validationIssueRank(right.issue) || left.index - right.index).map(({ issue }) => issue);
  }
  function addValidationCheck(checks, label, state, detail) {
    checks.push({ label, state, detail: detail || (state === "pass" ? "Passed" : state === "warning" ? "Review" : "Failed") });
  }
  function validationResult(errors, warnings, checks, sourceRowCount, matchedRowCount, levels, infos) {
    const orderedErrors = orderValidationIssues(errors);
    const orderedWarnings = orderValidationIssues(warnings);
    return { state: validationState(orderedErrors, orderedWarnings), errors: orderedErrors, warnings: orderedWarnings, infos: infos || [], checks, sourceRowCount, matchedRowCount, levels };
  }
  const numberValue = (value) => {
    const raw = String(value == null ? "" : value).trim();
    if (!raw || raw === "-" || raw === "—" || raw.toLowerCase() === "n/a") return null;
    const parsed = Number(raw.replace(/,/g, ""));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
  };


  async function loadGeo(level) {
    if (state.geo[level]) return state.geo[level];
    await loadPsgcReference();
    const file = level === "municipality_city" ? "municipalities" : level === "province_huc" ? "provinces" : "regions";
    const response = await fetchWithTimeout(mapAsset("assets/geo/" + file + ".geojson"), {}, 15000);
    if (!response.ok) throw new Error("Unable to load " + levelLabel(level) + " boundaries.");
    const geo = await response.json();
    const sourceFeatures = geo.features || [];
    sourceFeatures.forEach((feature) => {
      const sourceProperties = feature.properties || {};
      const reference = psgcReferenceFor(sourceProperties.psgc_code || sourceProperties.psgc_id);
      const properties = reference ? {
        ...sourceProperties,
        psgc_name: reference.name,
        correspondence_code: reference.correspondence_code || sourceProperties.correspondence_code || "",
        parent_psgc_code: reference.parent_psgc_code || sourceProperties.parent_psgc_code || "",
        region_name: reference.region || sourceProperties.region_name || sourceProperties.ADM1_EN || "",
        province_huc_name: reference.province || sourceProperties.province_huc_name || sourceProperties.ADM2_EN || "",
      } : sourceProperties;
      feature.properties = properties;
      const normalizedLevel = normalizedGeoLevel(level, properties);
      const location = { feature, properties, sourceLevel: level, level: normalizedLevel, code: properties.psgc_code || properties.psgc_id || "", name: properties.psgc_name || properties.ADM3_EN || properties.ADM2_EN || properties.ADM1_EN || "Unknown", region: properties.region_name || properties.ADM1_EN || "", province: properties.province_huc_name || properties.ADM2_EN || "", parentCode: properties.parent_psgc_code || "", reportingAreaType: properties.reporting_area_type || properties.city_class || "", hasGeometry: true };
      registerLookupLocation(location);
    });
    const renderFeatures = level === "municipality_city"
      ? sourceFeatures.filter((feature) => !isHucFeature(feature.properties || {}) || isNcrFeature(feature.properties || {}))
      : level === "province_huc"
        ? sourceFeatures.filter((feature) => feature.properties?.is_reporting_area !== false)
        : sourceFeatures;
    state.geo[level] = { ...geo, features: renderFeatures };
    return state.geo[level];
  }
  async function loadAllLookups() { await loadPsgcReference(); await Promise.all(LEVEL_ORDER.map((level) => loadGeo(level))); addReferenceOnlyLocations(); }
  function resolveLocation(code, name, preferredLevel) {
    if (preferredLevel) {
      const levelLookup = state.lookups.codeByLevel[preferredLevel] || new Map();
      for (const variant of locationCodeVariants(code)) { const found = levelLookup.get(variant); if (found) return found; }
      const named = namedLocation(name, preferredLevel); if (named) return named;
    }
    for (const variant of locationCodeVariants(code)) { const found = state.lookups.code.get(variant); if (found) return found; }
    const matches = nameMatches(name);
    if (!matches.length) return null;
    return matches.find((location) => location.level === "province_huc") || matches.find((location) => location.level === "region") || matches[0];
  }
  function resolveParent(location, targetLevel) {
    if (!location || LEVEL_ORDER.indexOf(targetLevel) < LEVEL_ORDER.indexOf(location.level)) return null;
    if (location.level === targetLevel) return location;
    if (targetLevel === "province_huc" && isHucFeature(location.properties || {})) return location;
    const explicitParentCode = String(location.parentCode || location.properties?.parent_psgc_code || "").trim();
    if (explicitParentCode) {
      const levelLookup = state.lookups.codeByLevel[targetLevel] || new Map();
      const explicitParent = locationCodeVariants(explicitParentCode).map((variant) => levelLookup.get(variant)).find(Boolean);
      if (explicitParent) return explicitParent;
    }
    if (targetLevel === "province_huc") {
      const reportingCode = reportingAreaCodeForLocation(location);
      const levelLookup = state.lookups.codeByLevel.province_huc || new Map();
      for (const variant of locationCodeVariants(reportingCode)) {
        const reportingArea = levelLookup.get(variant);
        if (reportingArea) return reportingArea;
      }
      return namedLocation(location.province === "City of Isabela (Not a Province)" ? "City of Isabela" : location.province, "province_huc");
    }
    if (targetLevel === "region") {
      // Use the official PSGC hierarchy first. Uploaded rows and older
      // geometry attributes can use different region labels, but the first
      // two digits of a current PSGC code identify the region reliably.
      const regionCode = locationRegionCode(location);
      const levelLookup = state.lookups.codeByLevel.region || new Map();
      for (const variant of locationCodeVariants(regionCode)) {
        const region = levelLookup.get(variant);
        if (region) return region;
      }
      return namedLocation(location.region, "region");
    }
    return null;
  }
  const BOUNDARY_TEMPLATE_SCOPES = {
    region: { levels: ["region"], fileName: "boundary-mapping-regions-template.csv" },
    province_huc: { levels: ["province_huc"], fileName: "boundary-mapping-provinces-huc-template.csv" },
    municipality_city: { levels: ["municipality_city"], fileName: "boundary-mapping-municipalities-template.csv" },
    all: { levels: LEVEL_ORDER, fileName: "boundary-mapping-all-levels-template.csv" },
  };
  function boundaryTemplateReferenceLocation(row, level) {
    const location = referenceOnlyLocation(row);
    return level && location ? { ...location, level } : location;
  }
  function isReferenceHuc(row) {
    return String(row.city_class || "").trim().toUpperCase() === "HUC";
  }
  function boundaryTemplateSortKey(location) {
    const region = location.level === "region" ? location : resolveParent(location, "region");
    const province = location.level === "province_huc" ? location : location.level === "municipality_city" ? resolveParent(location, "province_huc") : null;
    const levelOrder = { region: 0, province_huc: 1, municipality_city: 2 };
    const regionCode = canonicalDigits(region?.code || location.code) || "9999999999";
    // Keep the parent path ahead of the row depth. This produces one complete
    // PSGC branch at a time: Region, its Province/HUC, then its Municipalities
    // / Cities, before the next Region begins.
    const provinceCode = location.level === "region"
      ? "0000000000"
      : canonicalDigits(province?.code || location.code) || "9999999999";
    return [
      regionCode,
      provinceCode,
      String(levelOrder[location.level] ?? 9),
      canonicalDigits(location.code),
      normalizeName(location.name),
    ];
  }
  function compareBoundaryTemplateLocations(left, right) {
    const leftKey = boundaryTemplateSortKey(left); const rightKey = boundaryTemplateSortKey(right);
    for (let index = 0; index < leftKey.length; index += 1) {
      const comparison = String(leftKey[index]).localeCompare(String(rightKey[index]), "en");
      if (comparison) return comparison;
    }
    return 0;
  }
  function boundaryTemplateLocations(scope) {
    const configuration = BOUNDARY_TEMPLATE_SCOPES[scope] || BOUNDARY_TEMPLATE_SCOPES.region;
    const locations = new Map();
    (state.psgcReference?.rows || []).forEach((row) => {
      const scopeLevel = row.level === "region"
        ? "region"
        : row.level === "province_huc" || isReferenceHuc(row)
          ? "province_huc"
          : "municipality_city";
      if (!configuration.levels.includes(row.level) && !(scope === "province_huc" && scopeLevel === "province_huc")) return;
      if (scope === "municipality_city" && scopeLevel !== "municipality_city") return;
      if (scope === "all" || scopeLevel === "region" || scopeLevel === "province_huc" || scopeLevel === "municipality_city") {
        const location = boundaryTemplateReferenceLocation(row, scopeLevel);
        if (location?.code && location?.name) locations.set(location.level + ":" + locationKey(location), location);
      }
    });
    return [...locations.values()].sort(compareBoundaryTemplateLocations);
  }
  function boundaryTemplateCode(location) {
    const digits = canonicalDigits(location.code);
    return digits ? "PH" + digits : "";
  }
  function boundaryTemplateCorrespondenceCode(location) {
    const digits = String(location?.properties?.correspondence_code || "").replace(/\D/g, "");
    return digits ? "PH" + digits.padStart(9, "0") : "";
  }
  function boundaryTemplateCSV(scope) {
    const rows = [["PSGC_code", "correspondence_code", "location_name", "metric_value"]].concat(boundaryTemplateLocations(scope).map((location) => [boundaryTemplateCode(location), boundaryTemplateCorrespondenceCode(location), location.name, ""]));
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  const STANDING_TEMPLATE_CONFIGS = {
    corn: { fileName: "corn-standing-crops-template.csv", codeHeader: "PSGC_code", locationHeader: "location_name", groupLabels: ["YELLOW", "WHITE", "GRAND TOTAL"] },
    rice: { fileName: "rice-standing-crops-template.csv", codeHeader: "PSGC_code", locationHeader: "location_name", groupLabels: ["IRRIGATED", "RAINFED", "UPLAND", "GRAND TOTAL"] },
  };
  function standingTemplateHeaderRows(crop) {
    const configuration = STANDING_TEMPLATE_CONFIGS[crop];
    if (!configuration) throw new Error("Choose a Corn or Rice template.");
    const groupHeader = [configuration.codeHeader, configuration.locationHeader];
    const metricHeader = ["", ""];
    configuration.groupLabels.forEach((label) => {
      groupHeader.push(label, "", "", "", "");
      metricHeader.push("Newly Planted/Seedling Stage (ha)", "Vegetative Stage (ha)", "Reproductive Stage (ha)", crop === "rice" ? "Maturing Stage (ha)" : "Maturity Stage (ha)", "Total");
    });
    return [groupHeader, metricHeader];
  }
  function standingTemplateCSV(crop) {
    const configuration = STANDING_TEMPLATE_CONFIGS[crop];
    const expectedColumns = crop === "corn" ? 17 : crop === "rice" ? 22 : 0;
    if (!configuration || !expectedColumns) throw new Error("Choose a Corn or Rice template.");
    const locations = boundaryTemplateLocations("all");
    const rows = standingTemplateHeaderRows(crop)
      .concat(locations.map((location) => [boundaryTemplateCode(location), location.name].concat(new Array(expectedColumns - 2).fill(""))));
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  const EARTHQUAKE_TEMPLATE_HEADERS = ["Date - Time", "Latitude", "Longitude", "Depth", "Mag", "Location"];
  function earthquakeTemplateCSV() {
    return EARTHQUAKE_TEMPLATE_HEADERS.map(csvCell).join(",") + "\r\n";
  }
  function setDialogStatus(selector, message, stateName) {
    const status = $(selector);
    if (!status) return;
    status.textContent = message || "";
    if (stateName) status.dataset.state = stateName;
    else status.removeAttribute("data-state");
  }
  const setStandingTemplateStatus = (message, stateName) => setDialogStatus("#standing-template-status", message, stateName);
  const setBoundaryTemplateStatus = (message, stateName) => setDialogStatus("#boundary-template-status", message, stateName);
  const setGeopackageDownloadStatus = (message, stateName) => setDialogStatus("#geopackage-download-status", message, stateName);

  function openDialog(id) {
    const dialog = $("#" + id);
    if (!dialog) return null;
    if (!dialog.open) dialog.showModal();
    syncDialogTriggerState(dialog.id, true);
    return dialog;
  }
  function closeDialog(id) {
    const dialog = $("#" + id);
    if (dialog?.open) dialog.close();
  }
  function triggerBrowserDownload(source, fileName) {
    const isBlob = typeof Blob !== "undefined" && source instanceof Blob;
    const url = isBlob ? URL.createObjectURL(source) : String(source);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (isBlob) window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function prepareStandingTemplateDialog() {
    const confirm = $("#standing-template-confirm");
    if (confirm) confirm.disabled = true;
    setStandingTemplateStatus("Loading local PSGC records…");
    try {
      await loadPsgcReference();
      const locationCount = boundaryTemplateLocations("all").length;
      setStandingTemplateStatus(locationCount ? "Ready · " + fmt(locationCount) + " PSGC rows" : "No PSGC locations are available.", locationCount ? "success" : "error");
      if (confirm) confirm.disabled = !locationCount;
    } catch (error) {
      setStandingTemplateStatus(error.message, "error");
    }
  }
  function openStandingTemplateDialog() {
    if (!openDialog("standing-template-dialog")) return;
    prepareStandingTemplateDialog();
  }
  function closeStandingTemplateDialog() {
    closeDialog("standing-template-dialog");
  }
  async function downloadStandingTemplate(crop) {
    const configuration = STANDING_TEMPLATE_CONFIGS[crop];
    const button = $("#standing-template-confirm");
    if (!configuration || !button) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Preparing…";
    setStandingTemplateStatus("Preparing the " + crop + " template…");
    try {
      await loadPsgcReference();
      const locations = boundaryTemplateLocations("all");
      if (!locations.length) throw new Error("No PSA PSGC locations are available for this template.");
      const csv = standingTemplateCSV(crop);
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
      triggerBrowserDownload(blob, configuration.fileName);
      setStandingTemplateStatus("Downloaded " + crop + " template · " + fmt(locations.length) + " PSGC rows.", "success");
    } catch (error) {
      setStandingTemplateStatus(error.message, "error");
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = "Download CSV";
    }
  }
  async function prepareBoundaryTemplateDialog() {
    const confirm = $("#boundary-template-confirm");
    if (confirm) confirm.disabled = true;
    setBoundaryTemplateStatus("Loading local PSGC records…");
    try {
      await loadAllLookups();
      Object.keys(BOUNDARY_TEMPLATE_SCOPES).forEach((scope) => {
        const count = $("[data-template-row-count=\"" + scope + "\"]");
        if (count) count.textContent = fmt(boundaryTemplateLocations(scope).length) + " rows";
      });
      setBoundaryTemplateStatus("");
      if (confirm) confirm.disabled = false;
    } catch (error) {
      setBoundaryTemplateStatus(error.message, "error");
    }
  }
  function openBoundaryTemplateDialog() {
    if (!openDialog("boundary-template-dialog")) return;
    prepareBoundaryTemplateDialog();
  }
  function closeBoundaryTemplateDialog() {
    closeDialog("boundary-template-dialog");
  }
  async function downloadBoundaryTemplate() {
    const scope = $("input[name=\"boundary-template-scope\"]:checked")?.value || "region";
    const configuration = BOUNDARY_TEMPLATE_SCOPES[scope] || BOUNDARY_TEMPLATE_SCOPES.region;
    const confirm = $("#boundary-template-confirm");
    if (confirm) { confirm.disabled = true; confirm.textContent = "Preparing…"; }
    try {
      await loadAllLookups();
      const csv = boundaryTemplateCSV(scope);
      const locationCount = boundaryTemplateLocations(scope).length;
      if (!locationCount) throw new Error("No PSGC locations are available for this template.");
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
      triggerBrowserDownload(blob, configuration.fileName);
      setBoundaryTemplateStatus("Downloaded " + fmt(locationCount) + " rows.", "success");
    } catch (error) {
      setBoundaryTemplateStatus(error.message, "error");
    } finally {
      if (confirm) { confirm.disabled = false; confirm.textContent = "Download CSV"; }
    }
  }
  const GEOPACKAGE_DOWNLOADS = {
    administrative: { label: "Administrative Base Map", href: "downloads/philippines-base-map.gpkg", fileName: "philippines-base-map.gpkg" },
    barangays: { label: "Barangay Boundaries", href: "downloads/philippines-barangay-boundaries.gpkg", fileName: "philippines-barangay-boundaries.gpkg" },
  };
  function openGeopackageDownloadDialog() {
    if (!openDialog("geopackage-download-dialog")) return;
    setGeopackageDownloadStatus("");
  }
  function closeGeopackageDownloadDialog() {
    closeDialog("geopackage-download-dialog");
  }
  function downloadGeopackage() {
    const key = $("input[name=\"geopackage-download\"]:checked")?.value || "administrative";
    const configuration = GEOPACKAGE_DOWNLOADS[key] || GEOPACKAGE_DOWNLOADS.administrative;
    const button = $("#geopackage-download-confirm");
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "Preparing…";
    }
    setGeopackageDownloadStatus("Starting " + configuration.label + " download…");
    triggerBrowserDownload(configuration.href, configuration.fileName);
    setGeopackageDownloadStatus("Download started · " + configuration.label, "success");
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = "Download GeoPackage";
    }
  }
  function downloadEarthquakeTemplate() {
    const blob = new Blob(["\uFEFF", earthquakeTemplateCSV()], { type: "text/csv;charset=utf-8" });
    triggerBrowserDownload(blob, "earthquake-template.csv");
  }
  function showStatus(kind, message, id, options = {}) {
    const timerKey = String(id || "");
    const previousTimer = statusTimers.get(timerKey);
    if (previousTimer) window.clearTimeout(previousTimer);
    statusTimers.delete(timerKey);
    const element = $("#" + id + "-status");
    if (!element) return;
    element.className = "status-message " + (kind || "");
    element.textContent = message || "";
    if (!message || options.persistent) return;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : STATUS_TIMEOUTS[kind] || STATUS_TIMEOUTS.info;
    if (timeoutMs <= 0) return;
    statusTimers.set(timerKey, window.setTimeout(() => {
      const current = $("#" + id + "-status");
      if (current === element && current.textContent === String(message)) showStatus("", "", id);
      else statusTimers.delete(timerKey);
    }, timeoutMs));
  }
  function emptyUploadIcon(input) {
    if (input?.dataset.standingCrop === "corn") return '<img src="' + mapAsset("assets/crop-icons/corn.png") + '" alt="" aria-hidden="true">';
    if (input?.dataset.standingCrop === "rice") return '<img src="' + mapAsset("assets/crop-icons/rice.png") + '" alt="" aria-hidden="true">';
    return "↑";
  }
  function updateFileDrop(input) {
    const drop = input?.closest(".file-drop"); if (!drop) return;
    const title = drop.querySelector("strong"); const detail = drop.querySelector("small"); const icon = drop.querySelector(".upload-icon"); const file = input.files?.[0];
    drop.classList.remove("is-invalid");
    if (file) {
      drop.classList.add("has-file"); title.textContent = file.name; title.title = file.name; detail.textContent = fileSizeLabel(file.size) + " · Ready to validate"; icon.textContent = "✓";
    } else {
      drop.classList.remove("has-file"); title.textContent = drop.dataset.emptyTitle; title.removeAttribute("title"); detail.textContent = drop.dataset.emptyDetail; icon.innerHTML = emptyUploadIcon(input);
    }
  }
  function setSidebarOpen(isOpen) {
    const open = Boolean(isOpen);
    const layout = document.querySelector(".app-layout");
    const toggle = document.querySelector("[data-sidebar-toggle]");
    const sidebar = document.querySelector(".app-sidebar");
    if (!layout || !toggle) return;
    const isSmallScreen = window.matchMedia("(max-width: 960px)").matches;
    if (!open && sidebar?.contains(document.activeElement)) toggle.focus();
    layout.classList.toggle("is-sidebar-collapsed", !open);
    toggle.classList.toggle("is-collapsed", !open);
    document.documentElement.classList.remove("sidebar-state-collapsed");
    document.body.classList.toggle("sidebar-drawer-open", open && isSmallScreen);
    sidebar?.toggleAttribute("inert", !open);
    sidebar?.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Hide sidebar" : "Show sidebar");
    toggle.title = open ? "Hide sidebar" : "Show sidebar";
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? "true" : "false"); } catch (_) { /* storage unavailable */ }
    Object.values(state.maps).forEach((map) => window.setTimeout(() => safeInvalidateMapSize(map), 260));
  }
  function initializeSidebar() {
    if (!document.querySelector(".app-layout")) return;
    const toggle = document.querySelector("[data-sidebar-toggle]");
    if (!toggle) return;
    const sidebar = document.querySelector(".app-sidebar");
    const overlay = document.querySelector("[data-sidebar-overlay]");
    const drawerClose = document.querySelector("[data-sidebar-drawer-close]");
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const drawerFocusable = () => [...(sidebar?.querySelectorAll(focusableSelector) || [])].filter((element) => !element.hasAttribute("inert"));
    const restoreToggleFocus = () => window.setTimeout(() => toggle.focus(), 0);
    let open = true;
    try {
      const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (stored !== null) open = stored === "true";
    } catch (_) { /* storage unavailable */ }
    toggle.addEventListener("click", () => {
      const layout = document.querySelector(".app-layout");
      const nextOpen = Boolean(layout?.classList.contains("is-sidebar-collapsed"));
      setSidebarOpen(nextOpen);
      if (nextOpen && window.matchMedia("(max-width: 960px)").matches) window.setTimeout(() => (drawerClose || drawerFocusable()[0])?.focus(), 0);
      else if (!nextOpen) restoreToggleFocus();
    });
    overlay?.addEventListener("click", () => { setSidebarOpen(false); restoreToggleFocus(); });
    drawerClose?.addEventListener("click", () => { setSidebarOpen(false); restoreToggleFocus(); });
    document.addEventListener("keydown", (event) => {
      if (!document.body.classList.contains("sidebar-drawer-open")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
        restoreToggleFocus();
        return;
      }
      if (event.key !== "Tab") return;
      const items = drawerFocusable();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    setSidebarOpen(open);
  }
  function initializePrivacyReminder() {
    const toggles = [...document.querySelectorAll("[data-privacy-toggle]")];
    const message = document.querySelector("#privacy-message");
    if (!toggles.length || !message) return;
    const setOpen = (open) => {
      toggles.forEach((toggle) => {
        toggle.setAttribute("aria-label", open ? "Hide temporary data reminder" : "Show temporary data reminder");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
      message.hidden = !open;
      message.classList.toggle("is-open", open);
    };
    toggles.forEach((toggle) => toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(message.hidden);
    }));
    document.addEventListener("click", (event) => {
      const insideToggle = toggles.some((toggle) => toggle.contains(event.target));
      if (!message.hidden && !insideToggle && !message.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
    setOpen(false);
  }
  async function readFile(input) {
    const file = input.files[0];
    if (!file) throw new Error("Choose a CSV file first.");
    if (file.size > MAX_BYTES) throw new Error("The CSV must not exceed 5 MB.");
    return { file, text: await file.text() };
  }
  function locationKey(location) { return codeVariants(location?.code)[0] || normalizeName(location?.name); }
  function hierarchyLevelForAggregation(location) {
    if (!location) return "";
    const knownLevel = LEVEL_ORDER.includes(location.level) ? location.level : "";
    // Keep HUCs at the Province / HUC level, then use the official PSGC
    // shape to classify rows even when a CSV or a legacy lookup omitted the
    // level label. This prevents parent rows from being mixed into child
    // totals during province and region consolidation.
    if (knownLevel === "province_huc" && isHucFeature(location.properties || {})) return knownLevel;
    const code = canonicalDigits(location.code);
    if (code.length === 10 && /^\d{2}0{8}$/.test(code)) return "region";
    if (code.length === 10 && /^\d{5}0{5}$/.test(code)) return "province_huc";
    return knownLevel;
  }
  function locationDescriptor(locationOrCode, name) {
    const location = locationOrCode && typeof locationOrCode === "object" ? locationOrCode : null;
    const locationName = location?.name || name || "Unknown location";
    const code = location?.code || (location ? "" : locationOrCode);
    return String(locationName).trim() + " · " + (String(code || "").trim() ? "PSGC " + String(code).trim() : "PSGC code unavailable");
  }
  function rowIssue(rowNumber, code, name, message) { return "Row " + rowNumber + " · " + locationDescriptor(code, name) + ": " + message; }
  function standingValueSum(values, keys) {
    if (keys.some((key) => Number.isNaN(values[key]))) return NaN;
    return keys.reduce((sum, key) => sum + (Number.isFinite(values[key]) ? values[key] : 0), 0);
  }
  function standingValueTolerance(expected) { return Math.max(.01, Math.abs(expected) * .00001); }
  function validateStandingRowTotals(classes, values, rowNumber, code, name) {
    const errors = []; let checked = 0; let skipped = 0;
    const classLabels = classes.map(([, label]) => label).join(" + ");
    const stageKeys = STAGES.map(([stageKey]) => stageKey);
    classes.forEach(([classKey, classLabel]) => {
      const group = values[classKey] || {};
      const expected = standingValueSum(group, stageKeys);
      const actual = group.total;
      if (Number.isNaN(expected) || Number.isNaN(actual)) { skipped += 1; return; }
      checked += 1;
      if (Math.abs(expected - actual) > standingValueTolerance(expected)) {
        errors.push(rowIssue(rowNumber, code, name, classLabel + " · Total does not match. The four growth stages total " + fmt(expected, 2) + ", but the uploaded total is " + fmt(actual, 2) + "."));
      }
    });
    const grandTotal = values.grand_total || {};
    STAGES.forEach(([stageKey, stageLabel]) => {
      const categoryValues = Object.fromEntries(classes.map(([classKey]) => [classKey, values[classKey]?.[stageKey]]));
      const expected = standingValueSum(categoryValues, classes.map(([classKey]) => classKey));
      const actual = grandTotal[stageKey];
      if (Number.isNaN(expected) || Number.isNaN(actual)) { skipped += 1; return; }
      checked += 1;
      if (Math.abs(expected - actual) > standingValueTolerance(expected)) {
        errors.push(rowIssue(rowNumber, code, name, "Grand Total · " + stageLabel + " does not match. The " + classLabels + " stages total " + fmt(expected, 2) + ", but the uploaded value is " + fmt(actual, 2) + "."));
      }
    });
    const categoryTotals = Object.fromEntries(classes.map(([classKey]) => [classKey, values[classKey]?.total]));
    const expectedGrandTotal = standingValueSum(categoryTotals, classes.map(([classKey]) => classKey));
    const actualGrandTotal = grandTotal.total;
    if (Number.isNaN(expectedGrandTotal) || Number.isNaN(actualGrandTotal)) skipped += 1;
    else {
      checked += 1;
      if (Math.abs(expectedGrandTotal - actualGrandTotal) > standingValueTolerance(expectedGrandTotal)) {
        errors.push(rowIssue(rowNumber, code, name, "Grand Total · Total does not match. The " + classLabels + " totals sum to " + fmt(expectedGrandTotal, 2) + ", but the uploaded total is " + fmt(actualGrandTotal, 2) + "."));
      }
    }
    return { errors, checked, skipped };
  }
  function missingBoundaryWarnings(rows) {
    const locations = [...new Map(rows.filter((row) => row.location && !row.location.hasGeometry).map((row) => [locationKey(row.location), row.location])).values()];
    return locations.map((location) => locationDescriptor(location) + " is recognized by the PSA 2Q 2026 PSGC reference, but its map boundary is not bundled and will not render.");
  }
  function metricIsAdditive(title) { return !/(%|\b(percent|percentage|rate|ratio|share|index|average|avg|yield loss|per)\b)/i.test(String(title || "")); }
  function hierarchyRelationKey(parentLevel, childLevel, parentKey) { return parentLevel + ":" + childLevel + ":" + parentKey; }
  function buildHierarchyIndex(rows, relations) {
    const childrenByParent = new Map();
    const rowsByLocation = new Map();
    rows.forEach((row) => {
      const rowKey = row.location.level + ":" + locationKey(row.location);
      const group = rowsByLocation.get(rowKey) || [];
      group.push(row); rowsByLocation.set(rowKey, group);
    });
    relations.forEach(({ parentLevel, childLevel }) => {
      rows.forEach((row) => {
        if (row.location.level !== childLevel) return;
        if (parentLevel === "province_huc" && childLevel === "municipality_city" && isHucFeature(row.location.properties || {})) return;
        const parent = resolveParent(row.location, parentLevel);
        if (!parent) return;
        const key = hierarchyRelationKey(parentLevel, childLevel, locationKey(parent));
        const children = childrenByParent.get(key) || [];
        children.push(row); childrenByParent.set(key, children);
      });
    });
    const expectedChildCounts = new Map();
    const addExpectedChild = (child, parentLevel, childLevel) => {
      if (!child || child.level !== childLevel) return;
      if (parentLevel === "province_huc" && childLevel === "municipality_city" && isHucFeature(child.properties || {})) return;
      const parent = resolveParent(child, parentLevel);
      if (!parent) return;
      const key = hierarchyRelationKey(parentLevel, childLevel, locationKey(parent));
      expectedChildCounts.set(key, (expectedChildCounts.get(key) || 0) + 1);
    };
    const referenceRows = state.psgcReference?.rows || [];
    if (referenceRows.length) {
      referenceRows.forEach((row) => {
        const child = referenceOnlyLocation(row);
        relations.forEach(({ parentLevel, childLevel }) => addExpectedChild(child, parentLevel, childLevel));
      });
    } else {
      relations.forEach(({ parentLevel, childLevel }) => {
        const geo = state.geo[childLevel];
        (geo?.features || []).forEach((feature) => {
          const props = feature.properties || {};
          const child = resolveLocation(props.psgc_code || props.psgc_id, props.psgc_name || props.ADM3_EN || props.ADM2_EN || props.ADM1_EN, childLevel);
          addExpectedChild(child, parentLevel, childLevel);
        });
      });
    }
    return {
      directRows: (parent, parentLevel) => rowsByLocation.get(parentLevel + ":" + locationKey(parent)) || [],
      children: (parent, parentLevel, childLevel) => childrenByParent.get(hierarchyRelationKey(parentLevel, childLevel, locationKey(parent))) || [],
      expectedChildren: (parent, parentLevel, childLevel) => expectedChildCounts.get(hierarchyRelationKey(parentLevel, childLevel, locationKey(parent))) || 0,
    };
  }
  function legacyProvinceGroup(location) {
    const digits = String(location?.properties?.correspondence_code || "").replace(/\D/g, "");
    return digits.length >= 4 ? digits.slice(0, 4) : "";
  }
  function validateHierarchy(rows, metricDefinitions, valueGetter) {
    const errors = []; const warnings = []; const checks = [];
    let scopedParentCount = 0;
    const observed = new Set(rows.map((row) => row.location.level));
    const additiveMetrics = metricDefinitions.filter((metric) => metric.additive !== false);
    const hierarchyRelations = ["province_huc", "region"].map((parentLevel) => {
      const parentIndex = LEVEL_ORDER.indexOf(parentLevel);
      const childLevels = LEVEL_ORDER.slice(0, parentIndex).filter((level) => observed.has(level));
      return observed.has(parentLevel) && childLevels.length ? { parentLevel, childLevel: childLevels[childLevels.length - 1] } : null;
    }).filter(Boolean);
    const hierarchyIndex = buildHierarchyIndex(rows, hierarchyRelations);
    const duplicateIndex = new Map();
    rows.forEach((row) => {
      const key = row.location.level + ":" + locationKey(row.location);
      const group = duplicateIndex.get(key) || [];
      group.push(row); duplicateIndex.set(key, group);
    });
    const duplicateGroups = [...duplicateIndex.values()].filter((group) => group.length > 1).map((group) => ({ rows: group }));
    duplicateGroups.forEach((group) => {
      const first = group.rows[0];
      const rowNumbers = group.rows.map((row) => row.rowNumber).join(", ");
      errors.push(rowIssue(first.rowNumber, first.location.code, first.location.name, "this administrative location appears more than once on rows " + rowNumbers + ". Possible fix: keep one row per PSGC code and consolidate its values before uploading."));
    });
    if (duplicateGroups.length) addValidationCheck(checks, "Unique administrative rows", "error", duplicateGroups.length + " duplicate location group(s) found");
    else addValidationCheck(checks, "Unique administrative rows", "pass", "One row per PSGC location");
    // Standing Crops subtotals sometimes include an affiliated HUC in its
    // former province and sometimes report it independently at region level.
    // Use the interpretation with the lower aggregate reconciliation error,
    // while retaining the HUC's official independent geography for rendering.
    const affiliatedHucParents = new Map();
    const reportingRows = rows.filter((row) => row.location.level === "province_huc");
    const provinceRows = reportingRows.filter((row) => !isHucFeature(row.location.properties || {}));
    reportingRows.filter((row) => isHucFeature(row.location.properties || {})).forEach((hucRow) => {
      const group = legacyProvinceGroup(hucRow.location);
      const provinceRow = group && provinceRows.find((candidate) => legacyProvinceGroup(candidate.location) === group && locationRegionCode(candidate.location) === locationRegionCode(hucRow.location));
      if (!provinceRow) return;
      const officialChildren = hierarchyIndex.children(provinceRow.location, "province_huc", "municipality_city");
      let excludedError = 0; let includedError = 0;
      additiveMetrics.forEach((metric) => {
        const provinceValue = valueGetter(provinceRow, metric.key);
        const officialTotal = officialChildren.reduce((sum, row) => { const value = valueGetter(row, metric.key); return sum + (Number.isFinite(value) ? value : 0); }, 0);
        const hucValue = valueGetter(hucRow, metric.key);
        const normalizedProvince = Number.isFinite(provinceValue) ? provinceValue : 0;
        const normalizedHuc = Number.isFinite(hucValue) ? hucValue : 0;
        excludedError += Math.abs(normalizedProvince - officialTotal);
        includedError += Math.abs(normalizedProvince - officialTotal - normalizedHuc);
      });
      if (includedError < excludedError) affiliatedHucParents.set(locationKey(hucRow.location), locationKey(provinceRow.location));
    });
    metricDefinitions.filter((metric) => metric.additive === false).forEach((metric) => addValidationCheck(checks, metric.title + " total reconciliation", "warning", "Skipped because this metric is non-additive."));
    ["province_huc", "region"].forEach((parentLevel) => {
      const parentIndex = LEVEL_ORDER.indexOf(parentLevel);
      const childLevels = LEVEL_ORDER.slice(0, parentIndex).filter((level) => observed.has(level));
      if (!observed.has(parentLevel) || !childLevels.length) return;
      const childLevel = childLevels[childLevels.length - 1];
      const parents = [...new Map(rows.filter((row) => row.location.level === parentLevel).map((row) => [locationKey(row.location), row.location])).values()];
      parents.forEach((parent) => {
        // A highly urbanized city is represented as a standalone Province / HUC
        // reporting area in the map hierarchy. It can contain barangays, but it
        // must not be reconciled against municipality / city children.
        if (parentLevel === "province_huc" && isHucFeature(parent.properties || {})) return;
        const directParents = hierarchyIndex.directRows(parent, parentLevel);
        const parentRow = directParents[0];
        const scopedChildRows = hierarchyIndex.children(parent, parentLevel, childLevel);
        const hasScopedChildRows = scopedChildRows.length > 0;
        let children = scopedChildRows;
        if (parentLevel === "province_huc" && hasScopedChildRows) {
          children = children.concat(reportingRows.filter((row) => affiliatedHucParents.get(locationKey(row.location)) === locationKey(parent)));
        } else if (parentLevel === "region" && hasScopedChildRows) {
          children = children.filter((row) => !affiliatedHucParents.has(locationKey(row.location)));
        }
        let expected = hierarchyIndex.expectedChildren(parent, parentLevel, childLevel);
        const expectedCoverage = expected;
        if (parentLevel === "province_huc" && hasScopedChildRows) expected += reportingRows.filter((row) => affiliatedHucParents.get(locationKey(row.location)) === locationKey(parent)).length;
        if (parentLevel === "region" && hasScopedChildRows) expected -= reportingRows.filter((row) => affiliatedHucParents.has(locationKey(row.location)) && locationRegionCode(row.location) === locationRegionCode(parent)).length;
        const hasParentValue = additiveMetrics.some((metric) => directParents.some((row) => Number.isFinite(valueGetter(row, metric.key))));
        // Coverage is meaningful only when this specific parent has at least
        // one supplied child. A child from another province or region must not
        // make every parent row look partially covered.
        if (!hasScopedChildRows) return;
        scopedParentCount += 1;
        if (expectedCoverage > scopedChildRows.length && hasParentValue) {
          const childLabel = levelLabel(childLevel);
          const parentLabel = levelLabel(parentLevel);
          const message = "Partial administrative coverage: " + scopedChildRows.length + " of " + expectedCoverage + " " + childLabel.toLowerCase() + " rows were supplied for this " + parentLabel.toLowerCase() + " row. This is allowed when the report intentionally covers selected areas. Possible fix: add the remaining " + (expectedCoverage - scopedChildRows.length) + " row(s) if a complete consolidation is needed.";
          warnings.push(rowIssue(parentRow?.rowNumber || "?", parent.code, parent.name, message));
          addValidationCheck(checks, parent.name + " " + childLabel + " coverage", "warning", "Row " + (parentRow?.rowNumber || "?") + " · " + scopedChildRows.length + "/" + expectedCoverage + " supplied");
          return;
        }
        additiveMetrics.forEach((metric) => {
          const childTotal = children.reduce((sum, row) => { const value = valueGetter(row, metric.key); return sum + (Number.isFinite(value) ? value : 0); }, 0);
          const parentTotal = directParents.reduce((sum, row) => { const value = valueGetter(row, metric.key); return sum + (Number.isFinite(value) ? value : 0); }, 0);
          const hasParentValue = directParents.some((row) => Number.isFinite(valueGetter(row, metric.key)));
          if (!hasParentValue) return;
          // Administrative totals should reconcile exactly apart from small
          // source-rounding differences. The previous 0.1% tolerance could
          // hide material discrepancies in large provincial totals.
          const tolerance = Math.max(.01, Math.abs(parentTotal) * .00001);
          const difference = Math.abs(childTotal - parentTotal);
          const label = locationDescriptor(parent) + " · " + metric.title;
          if (difference <= tolerance) addValidationCheck(checks, label, "pass", "Matches within tolerance");
          else {
            const childLabel = levelLabel(childLevel);
            const parentLabel = levelLabel(parentLevel);
            const message = metric.title + " does not match. The " + childLabel.toLowerCase() + " rows total " + fmt(childTotal, 2) + ", but this uploaded " + parentLabel.toLowerCase() + " row contains " + fmt(parentTotal, 2) + ". Possible fix: correct the " + childLabel.toLowerCase() + " values or update the parent value so both totals match.";
            errors.push(rowIssue(parentRow?.rowNumber || "?", parent.code, parent.name, message));
            addValidationCheck(checks, label, "error", "Row " + (parentRow?.rowNumber || "?") + " · difference " + fmt(difference, 2));
          }
        });
      });
    });
    addValidationCheck(checks, "Administrative consolidation", errors.length ? "error" : warnings.length ? "warning" : "pass", errors.length ? errors.length + " row-level issue(s) need correction" : warnings.length ? "Review partial parent/child coverage" : scopedParentCount ? "Parent totals match their supplied child rows" : "Skipped; no parent-specific child rows were supplied");
    return { errors, warnings, checks };
  }
  function closeValidationDialog() {
    const dialog = $("#map-validation-dialog");
    if (dialog?.open) dialog.close();
    if (dialog) syncDialogTriggerState(dialog.id, false);
  }
  function syncDialogTriggerState(dialogId, open) {
    $$('[aria-controls="' + dialogId + '"]').forEach((trigger) => trigger.setAttribute("aria-expanded", open ? "true" : "false"));
  }
  function enableDialogBackdropClose(dialog) {
    if (!dialog || dialog.dataset.backdropClose === "true") return;
    dialog.dataset.backdropClose = "true";
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => syncDialogTriggerState(dialog.id, false));
  }
  function ensureValidationDialog() {
    let dialog = $("#map-validation-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "map-validation-dialog";
    dialog.className = "validation-dialog";
    dialog.setAttribute("aria-labelledby", "validation-dialog-title");
    enableDialogBackdropClose(dialog);
    document.body.appendChild(dialog);
    return dialog;
  }
  function validationMetricTitles(id, dataset) {
    if (id === "general") return (dataset.metrics || []).map((metric) => metric.title);
    const groups = (dataset.classes || []).concat([["grand_total", "Grand Total"]]);
    return groups.flatMap(([, classLabel]) => STAGES.map(([, stageLabel]) => classLabel + " · " + stageLabel).concat(classLabel + " · Total"));
  }
  function validationIssueGroups(issues) {
    const groups = new Map();
    (issues || []).forEach((issue) => {
      const text = String(issue);
      const group = groups.get(text) || { issue: text, count: 0 };
      group.count += 1; groups.set(text, group);
    });
    return [...groups.values()];
  }
  function validationIssueHTML(issue, tone, metricTitles, count) {
    const title = metricTitles.filter((candidate) => String(issue).includes(candidate)).sort((a, b) => b.length - a.length)[0];
    const message = title
      ? esc(issue).replace(esc(title), '<strong class="validation-dialog__issue-metric">' + esc(title) + "</strong>")
      : esc(issue);
    const repeated = count > 1 ? '<span class="validation-dialog__issue-count">Repeated ' + fmt(count) + '×</span>' : "";
    return '<li class="validation-dialog__issue is-' + tone + '"><strong class="validation-dialog__issue-type">' + (tone === "error" ? "Error" : tone === "warning" ? "Warning" : "Info") + '</strong><span>' + message + "</span>" + repeated + "</li>";
  }
  function validationDialogHTML(validation, id, dataset) {
    const checkDetail = (label, fallback) => validation.checks.find((check) => check.label === label)?.detail || fallback;
    const levels = (dataset.availableLevels || []).map(levelLabel);
    const defaultLevel = dataset.deepest ? levelLabel(dataset.deepest) : "";
    const mapCoverage = levels.length
      ? levels.join(", ") + (levels.length > 1 && defaultLevel ? " · default: " + defaultLevel : "")
      : "No matched locations";
    const detailRows = [
      ["File structure", checkDetail("File structure", "Reviewed")],
      ["Location matching", checkDetail("Location name + PSGC pairing", "Reviewed")],
      ["Map coverage", mapCoverage],
      ...(id === "standing" ? [["Row totals", checkDetail("Row totals", "Not applicable")]] : []),
      ["Administrative consolidation", checkDetail("Administrative consolidation", "Not applicable")],
    ];
    const metricTitles = validationMetricTitles(id, dataset);
    const infoIssues = (validation.infos || []).filter((issue) => !issue.startsWith("Dataset-level: Multiple geographic levels are present."));
    const noteGroups = validationIssueGroups(validation.errors).map((group) => ({ ...group, tone: "error" }))
      .concat(validationIssueGroups(validation.warnings).map((group) => ({ ...group, tone: "warning" })))
      .concat(validationIssueGroups(infoIssues).map((group) => ({ ...group, tone: "info" })));
    const visibleGroups = noteGroups.slice(0, VALIDATION_DIALOG_ISSUE_LIMIT);
    const visibleIssueCount = visibleGroups.reduce((total, group) => total + group.count, 0);
    const totalIssueCount = validation.errors.length + validation.warnings.length + infoIssues.length;
    const issueSummary = totalIssueCount
      ? '<p class="validation-dialog__issue-summary" role="status">' + (visibleIssueCount < totalIssueCount ? "Showing " + fmt(visibleIssueCount) + " of " + fmt(totalIssueCount) + " review items to keep this view responsive." : fmt(totalIssueCount) + " review item(s) found.") + "</p>"
      : "";
    const notes = visibleGroups.map((group) => validationIssueHTML(group.issue, group.tone, metricTitles, group.count));
    const counts = [validation.errors.length ? fmt(validation.errors.length) + " error(s)" : "", validation.warnings.length ? fmt(validation.warnings.length) + " warning(s)" : ""].filter(Boolean).join(" · ");
    return '<div class="validation-dialog__header"><div><h2 id="validation-dialog-title">Validation Details</h2><p>' + esc(counts || "No errors or warnings") + '</p></div><button type="button" class="validation-dialog__close" data-validation-close aria-label="Close validation details">×</button></div>'
      + '<ul class="validation-dialog__summary-list" aria-label="Validation summary">' + detailRows.map((row) => '<li><strong>' + esc(row[0]) + '</strong><span>' + esc(row[1]) + '</span></li>').join("") + '</ul>'
      + (notes.length ? '<section class="validation-dialog__section validation-dialog__notes"><h3>' + (validation.errors.length || validation.warnings.length ? "Review items" : "Dataset notes") + '</h3>' + issueSummary + '<ul class="validation-dialog__issues">' + notes.join("") + '</ul></section>' : '');
  }
  function openValidationDialog(validation, id, dataset) {
    const dialog = ensureValidationDialog();
    dialog.innerHTML = validationDialogHTML(validation, id, dataset);
    dialog.querySelector("[data-validation-close]")?.addEventListener("click", () => dialog.close());
    if (!dialog.open) dialog.showModal();
    syncDialogTriggerState(dialog.id, true);
  }
  function showValidation(validation, id, dataset) {
    const buttons = id === "standing"
      ? (dataset?.crop ? [$("#standing-view-result-" + dataset.crop)].filter(Boolean) : $$("[data-standing-view-result]"))
      : [$("#general-view-result")].filter(Boolean);
    if (!validation) {
      buttons.forEach((button) => {
        button.disabled = true;
        button.className = "ghost-button validation-result-button";
        button.onclick = null;
      });
      closeValidationDialog();
      return;
    }
    const button = buttons[0];
    if (!button) return;
    if ($("#map-validation-dialog")?.open) closeValidationDialog();
    const infoCount = (validation.infos || []).length;
    const tone = validation.errors.length ? "is-error" : validation.warnings.length ? "is-warning" : infoCount ? "is-info" : "is-valid";
    button.disabled = false;
    button.className = "ghost-button validation-result-button " + tone;
    button.setAttribute("aria-label", (dataset?.crop ? dataset.crop[0].toUpperCase() + dataset.crop.slice(1) + " " : "") + "view validation result");
    button.onclick = () => openValidationDialog(validation, id, dataset);
  }
  function standingHeaderRows(crop, expected) {
    const configuration = STANDING_TEMPLATE_CONFIGS[crop];
    const metricLabels = ["Newly Planted/Seedling Stage (ha)", "Vegetative Stage (ha)", "Reproductive Stage (ha)", crop === "rice" ? "Maturing Stage (ha)" : "Maturity Stage (ha)", "Total"];
    const groupOffsets = configuration.groupLabels.map((_, index) => 2 + index * 5);
    return { configuration, metricLabels, groupOffsets, expected };
  }
  function standingHeaderErrors(csv, crop, expected) {
    const { configuration, metricLabels, groupOffsets } = standingHeaderRows(crop, expected);
    const groupHeader = csv[0] || [];
    const metricHeader = csv[1] || [];
    const errors = [];
    const headerValue = (row, index) => String(row[index] == null ? "" : row[index]).trim();
    const headerKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const equalsHeader = (actual, expectedValue) => headerKey(actual) === headerKey(expectedValue);
    const codeLike = /^(?:PH)?\d{9,10}$/i.test(headerValue(metricHeader, 0).replace(/\s+/g, ""));

    const codeHeaderAliases = [configuration.codeHeader, "Geocode", "PSGC code"];
    const locationHeaderAliases = [configuration.locationHeader, "Province / Municipality", "Province / City / Municipality", "Location Name"];
    if (!codeHeaderAliases.some((alias) => equalsHeader(headerValue(groupHeader, 0), alias)) || !locationHeaderAliases.some((alias) => equalsHeader(headerValue(groupHeader, 1), alias))) {
      errors.push("The first Standing Crops header row must begin with PSGC_code and location_name.");
    }
    if (headerValue(metricHeader, 0) || headerValue(metricHeader, 1)) {
      errors.push(codeLike || headerValue(metricHeader, 1)
        ? "Standing Crops requires two header rows. Row 2 looks like data (PSGC/location), so add the missing group-header row or download a fresh template."
        : "The second Standing Crops header row must leave the PSGC_code and location_name columns blank.");
    }
    configuration.groupLabels.forEach((label, index) => {
      if (!equalsHeader(headerValue(groupHeader, groupOffsets[index]), label)) {
        errors.push("The first Standing Crops header row is missing the " + label + " group label in column " + String.fromCharCode(65 + groupOffsets[index]) + ".");
      }
    });
    const missingMetricHeader = Array.from({ length: expected - 2 }, (_, index) => index + 2).find((index) => !headerValue(metricHeader, index));
    if (missingMetricHeader !== undefined) errors.push("The second Standing Crops header row is missing a growth-stage or total column heading at column " + String.fromCharCode(65 + missingMetricHeader) + ".");
    return [...new Set(errors)];
  }
  function rowWidthError(row, rowNumber, expected, label) {
    if (!row || row.length === expected) return "";
    return "Row " + rowNumber + " has " + row.length + " columns; expected " + expected + " for " + label + ". Possible fix: remove extra fields or add the missing comma/value so every row matches the header.";
  }
  function preflightCsv(kind, text) {
    const csv = parseCSV(text);
    if (kind === "general") {
      if (csv.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
      if (csv[0].length < 3) throw new Error("Use at least three columns: PSGC code, location name, and one metric.");
      if (csv[0].length > 50) throw new Error("The CSV cannot contain more than 50 columns.");
      if (csv.length - 1 > MAX_ROWS) throw new Error("The CSV cannot contain more than " + fmt(MAX_ROWS) + " data rows.");
      if (csv[0].some((header) => !String(header).trim())) throw new Error("Every metric column needs a header.");
      const generalWidthError = csv.slice(1).map((row, index) => rowWidthError(row, index + 2, csv[0].length, "Boundary Mapping")).find(Boolean);
      if (generalWidthError) throw new Error(generalWidthError);
      return { label: "General Map CSV", rows: csv.length - 1, columns: csv[0].length };
    }
    if (csv.length < 3) throw new Error("A Standing Crops CSV needs two header rows and at least one data row.");
    const detected = csv[0].length === 17 ? "Corn" : csv[0].length === 22 ? "Rice" : "";
    if (!detected) throw new Error("The file must contain 17 columns for Corn or 22 columns for Rice.");
    if (csv[1].length !== csv[0].length) throw new Error("Row 2 has " + csv[1].length + " columns; expected " + csv[0].length + " to match the first " + detected + " header row. Possible fix: add the missing comma/value or remove the extra field.");
    const crop = detected.toLowerCase();
    const headerErrors = standingHeaderErrors(csv, crop, csv[0].length);
    if (headerErrors.length) throw new Error(headerErrors[0]);
    const standingWidthError = csv.slice(2).map((row, index) => rowWidthError(row, index + 3, csv[0].length, detected + " Standing Crops")).find(Boolean);
    if (standingWidthError) throw new Error(standingWidthError);
    if (csv.length - 2 > MAX_ROWS) throw new Error("The CSV cannot contain more than " + fmt(MAX_ROWS) + " data rows.");
    return { label: detected + " Standing Crops template", rows: csv.length - 2, columns: csv[0].length };
  }
  function setFileDropStatus(input, message, invalid) {
    const drop = input?.closest(".file-drop"); if (!drop) return;
    drop.classList.toggle("is-invalid", Boolean(invalid));
    const detail = drop.querySelector("small"); if (detail) detail.textContent = message;
    const icon = drop.querySelector(".upload-icon"); if (icon) icon.textContent = invalid ? "×" : input.files?.[0] ? "✓" : "↑";
  }
  function setValidationButtonState(kind, enabled) {
    const button = $("#" + kind + "-form .primary-button");
    if (button) button.disabled = !enabled;
  }
  function standingState() {
    if (!state.standing || !Object.prototype.hasOwnProperty.call(state.standing, "activeCrop")) state.standing = { corn: null, rice: null, activeCrop: "corn" };
    return state.standing;
  }
  function activeStandingCrop() { return state.standing?.activeCrop || "corn"; }
  function activeStandingDataset() { return state.standing?.[activeStandingCrop()] || null; }
  function standingDataset(crop) { return state.standing?.[crop] || null; }
  function standingFileInput(crop) { return $("#standing-file-" + crop); }
  function standingValidateButton(crop) { return $("[data-standing-validate=\"" + crop + "\"]"); }
  function applyStandingDefaultPalette(crop) {
    if (state.standingPaletteCustomized) return;
    applyMapPalette("standing-map", STANDING_DEFAULT_PALETTES[crop] || STANDING_DEFAULT_PALETTES.corn, { persist: false });
  }
  function syncStandingDatasetSelector() {
    const selector = $("#standing-active-crop"); const current = state.standing;
    if (!selector) return;
    ["corn", "rice"].forEach((crop) => { const option = selector.querySelector("option[value=\"" + crop + "\"]"); if (option) option.disabled = !current?.[crop]; });
    selector.value = activeStandingCrop(); selector.disabled = !current?.corn && !current?.rice;
    $$('[data-standing-upload]').forEach((card) => card.classList.toggle("is-active", card.dataset.standingUpload === activeStandingCrop() && Boolean(current?.[activeStandingCrop()])));
  }
  function clearStandingDisplayedState(crop) {
    $("#standing-summary")?.classList.add("is-hidden"); $("#standing-controls")?.classList.add("is-hidden");
    $("#standing-analytics-content")?.classList.add("is-hidden");
    const breakdownButton = $("#standing-summary-breakdown");
    if (breakdownButton) { breakdownButton.disabled = true; breakdownButton.hidden = true; }
    const breakdownDialog = $("#standing-breakdown-dialog");
    if (breakdownDialog?.open) breakdownDialog.close();
    $("#standing-breakdown-metrics")?.replaceChildren();
    const breakdownMetricsLabel = $("#standing-breakdown-metrics-label");
    if (breakdownMetricsLabel) breakdownMetricsLabel.textContent = "All metric columns";
    showValidation(null, "standing", crop ? { crop } : undefined); showStatus("", "", "standing");
    const mapId = "standing-map"; setBoundaryVisibility(mapId, null);
    clearBoundarySelection(mapId, { closePopup: true });
    if (state.layers[mapId]) { state.maps[mapId].removeLayer(state.layers[mapId]); state.layers[mapId] = null; }
    renderDefaultLegend("standing");
    Object.values(state.charts).forEach((chart) => chart.destroy()); state.charts = {};
  }
  function resetStandingCard(crop) {
    const input = standingFileInput(crop); const button = standingValidateButton(crop);
    if (input) { input.value = ""; updateFileDrop(input); }
    if (button) button.disabled = true;
  }
  function clearStandingDataset(crop) {
    if (state.standing) state.standing[crop] = null;
    const button = standingValidateButton(crop); if (button) button.disabled = true;
    showValidation(null, "standing", { crop });
    if (activeStandingCrop() === crop) clearStandingDisplayedState(crop);
    syncStandingDatasetSelector();
  }
  function clearDisplayedDataset(kind) {
    state[kind] = null;
    setValidationButtonState(kind, false);
    $("#" + kind + "-summary")?.classList.add("is-hidden");
    $("#" + kind + "-controls")?.classList.add("is-hidden");
    showValidation(null, kind); showStatus("", "", kind);
    const mapId = kind + "-map";
    setBoundaryVisibility(mapId, null);
    clearBoundarySelection(mapId, { closePopup: true });
    if (state.layers[mapId]) { state.maps[mapId].removeLayer(state.layers[mapId]); state.layers[mapId] = null; }
    renderDefaultLegend(kind);
    if (kind === "general") {
      $("#general-legend-label").value = DEFAULT_GENERAL_LEGEND_LABEL;
      $("#general-unit").value = DEFAULT_GENERAL_UNIT;
      clearGeneralDataSummary();
    }
    if (kind === "standing") clearStandingDisplayedState();
  }
  async function handleFileSelection(input) {
    const kind = input.id.startsWith("standing") ? "standing" : "general";
    const crop = input.dataset.standingCrop;
    if (kind === "standing" && crop) { clearStandingDataset(crop); updateFileDrop(input); }
    else { updateFileDrop(input); clearDisplayedDataset(kind); }
    if (!input.files?.[0]) return;
    try {
      const result = await readFile(input); const preflight = preflightCsv(kind, result.text.replace(/^\uFEFF/, ""));
      setFileDropStatus(input, fileSizeLabel(result.file.size) + " · Pre-validation passed", false);
      if (kind === "standing" && crop) standingValidateButton(crop).disabled = false;
      else setValidationButtonState(kind, true);
      if (kind === "general") renderGeneralDataSummary(result.text.replace(/^\uFEFF/, ""));
      showStatus("success", (crop ? crop[0].toUpperCase() + crop.slice(1) + " " : "") + "upload pre-validation passed · " + preflight.label + " · " + fmt(preflight.rows) + " rows. Ready to validate locations and totals.", kind);
    } catch (error) {
      setFileDropStatus(input, "Pre-validation failed · Choose a correct file", true);
      showStatus("error", "Upload pre-validation failed · " + error.message, kind);
    }
  }

  function parseGeneral(text, fileName) {
    const csv = parseCSV(text);
    if (csv.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
    const headers = csv[0].map((value) => String(value).trim());
    if (headers.length < 3) throw new Error("Use at least three columns: PSGC code, location name, and one metric.");
    if (headers.length > 50) throw new Error("The CSV cannot contain more than 50 columns.");
    if (csv.length - 1 > MAX_ROWS) throw new Error("The CSV cannot contain more than " + fmt(MAX_ROWS) + " data rows.");
    if (headers.some((header) => !header)) throw new Error("Every metric column needs a header.");
    const normalized = headers.map((header) => header.toLowerCase());
    if (new Set(normalized).size !== normalized.length) throw new Error("CSV headers must be unique.");
    const metrics = headers.slice(2).map((title, index) => ({ key: "metric_" + index, title, additive: metricIsAdditive(title) }));
    const errors = []; const rows = [];
    csv.slice(1).forEach((raw, index) => {
      const rowNumber = index + 2;
      if (raw.length !== headers.length) { errors.push(rowIssue(rowNumber, raw[0], raw[1], "has " + raw.length + " columns; expected " + headers.length + ".")); return; }
      const match = matchUploadedLocation(raw[0], raw[1]);
      if (match.error) { errors.push(rowIssue(rowNumber, raw[0], raw[1], match.error)); return; }
      const location = match.location;
      const values = {}; let valid = true;
      metrics.forEach((metric, metricIndex) => {
        const parsed = numberValue(raw[metricIndex + 2]);
        if (Number.isNaN(parsed)) { errors.push(rowIssue(rowNumber, raw[0], raw[1], metric.title + " is not a non-negative number.")); valid = false; }
        values[metric.key] = parsed;
      });
      if (valid) rows.push({ location, values, rowNumber, nameOnly: Boolean(match.nameOnly) });
    });
    const levels = datasetLevelInfo(rows);
    const deepest = levels.defaultLevel;
    const hierarchy = validateHierarchy(rows, metrics, (row, key) => row.values[key]);
    const boundaryWarnings = missingBoundaryWarnings(rows);
    const infos = levels.observed.length > 1 ? ["Dataset-level: Multiple geographic levels are present. HUC rows are treated as Province / HUC; the default map level is " + levelLabel(deepest) + " because it contains the most rows."] : [];
    const checks = [];
    const structureErrors = errors.filter((error) => validationIssueRank(error) === 10);
    addValidationCheck(checks, "File structure", structureErrors.length ? "error" : "pass", structureErrors.length ? structureErrors.length + " row-level structure issue(s) need correction" : headers.length + " columns · " + (csv.length - 1) + " data rows");
    const pairingError = errors.some((error) => /Location mismatch|PSGC code|Location name/.test(error));
    const nameOnlyCount = rows.filter((row) => row.nameOnly).length;
    addValidationCheck(checks, "Location name + PSGC pairing", pairingError ? "error" : "pass", pairingError ? "Review row errors" : nameOnlyCount ? nameOnlyCount + " unique name-only row(s) accepted" : "All rows paired");
    addValidationCheck(checks, "Geographic normalization", rows.length ? "pass" : "error", rows.length ? levels.observed.map(levelLabel).join(", ") : "No matched locations");
    if (!rows.length) errors.push("Dataset-level: No valid data rows were available after validation.");
    const validation = validationResult(errors.concat(hierarchy.errors), hierarchy.warnings.concat(boundaryWarnings), checks.concat(hierarchy.checks), csv.length - 1, rows.length, levels, infos);
    return { fileName, metrics, rows, baseRows: rows.filter((row) => row.location.level === deepest), validation, availableLevels: levels.availableLevels, deepest };
  }

  function parseStanding(text, fileName, requestedCrop) {
    const csv = parseCSV(text);
    if (csv.length < 3) throw new Error("A Standing Crops CSV needs two header rows and at least one data row.");
    const detectedCrop = csv[0].length === 17 ? "corn" : csv[0].length === 22 ? "rice" : "";
    const crop = requestedCrop === "auto" ? detectedCrop : requestedCrop;
    const expected = crop === "corn" ? 17 : crop === "rice" ? 22 : 0;
    if (!expected) throw new Error("The file must contain 17 columns for Corn or 22 columns for Rice.");
    if (csv[0].length !== expected || csv[1].length !== expected) throw new Error((crop === "corn" ? "Corn" : "Rice") + " templates require " + expected + " columns in both header rows.");
    if (csv.length - 2 > MAX_ROWS) throw new Error("The CSV cannot contain more than " + fmt(MAX_ROWS) + " data rows.");
    const classes = CROP_CLASSES[crop];
    const offsets = crop === "corn" ? [2, 7] : [2, 7, 12];
    const grandTotalOffset = crop === "corn" ? 12 : 17;
    const valueOffsets = offsets.concat(grandTotalOffset);
    const errors = standingHeaderErrors(csv, crop, expected).map((issue) => "Dataset-level: " + issue);
    const rows = [];
    let sourceParentLocation = null;
    let nationalRows = 0;
    let historicalHeaderRows = 0;
    let sourceDetailRows = 0;
    let rowTotalErrorCount = 0;
    let rowTotalChecked = 0;
    let rowTotalSkipped = 0;
    csv.slice(2).forEach((raw, index) => {
      const rowNumber = index + 3;
      const widthError = rowWidthError(raw, rowNumber, expected, (crop === "corn" ? "Corn" : "Rice") + " Standing Crops");
      if (widthError) { errors.push(widthError); return; }
      const code = raw[0]; const name = raw[1] || raw[0];
      const hasReportedValue = valueOffsets.some((offset) => [0, 1, 2, 3, 4].some((stageOffset) => {
        const value = String(raw[offset + stageOffset] == null ? "" : raw[offset + stageOffset]).trim();
        return value && value !== "-" && value !== "—" && value.toLowerCase() !== "n/a";
      }));
      if (normalizeName(name) === "philippines") { nationalRows += 1; return; }
      const match = matchUploadedLocation(code, name);
      if (match.error) {
        const childDigits = String(code || "").replace(/\D/g, "");
        const belongsToSourceParent = sourceParentLocation && isHucFeature(sourceParentLocation.properties || {}) && [...locationCodeSet(sourceParentLocation)].some((parentCode) => {
          const parentDigits = String(parentCode || "").replace(/\D/g, "");
          if (childDigits.length !== parentDigits.length) return false;
          if (childDigits.length === 10) return childDigits.slice(0, 5) === parentDigits.slice(0, 5);
          if (childDigits.length === 9) return childDigits.slice(0, 6) === parentDigits.slice(0, 6);
          return false;
        });
        if (belongsToSourceParent) { sourceDetailRows += 1; return; }
        const isLegacyAggregateHeader = childDigits.length === 9 && (childDigits.endsWith("0000000") || childDigits.endsWith("00000"));
        if (!hasReportedValue && isLegacyAggregateHeader) { historicalHeaderRows += 1; return; }
        errors.push(rowIssue(rowNumber, code, name, match.error)); return;
      }
      const location = match.location;
      if (String(code || "").trim()) sourceParentLocation = location;
      const values = {}; let hasValue = false;
      classes.forEach(([classKey], classIndex) => {
        values[classKey] = {};
        STAGES.forEach(([stageKey], stageIndex) => {
          const parsed = numberValue(raw[offsets[classIndex] + stageIndex]);
          if (Number.isNaN(parsed)) errors.push(rowIssue(rowNumber, code, name, "invalid " + classKey + " value in " + stageKey.replace(/_/g, " ") + "."));
          values[classKey][stageKey] = parsed;
          if (parsed !== null && !Number.isNaN(parsed)) hasValue = true;
        });
        const total = numberValue(raw[offsets[classIndex] + 4]);
        if (Number.isNaN(total)) errors.push(rowIssue(rowNumber, code, name, "invalid " + classKey + " total."));
        values[classKey].total = total === null ? STAGES.reduce((sum, stage) => sum + (values[classKey][stage[0]] || 0), 0) : total;
        if (values[classKey].total > 0) hasValue = true;
      });
      values.grand_total = {};
      STAGES.forEach(([stageKey], stageIndex) => {
        const categoryTotal = classes.reduce((sum, [classKey]) => {
          const value = values[classKey][stageKey];
          return Number.isNaN(value) ? NaN : sum + (Number.isFinite(value) ? value : 0);
        }, 0);
        const parsed = numberValue(raw[grandTotalOffset + stageIndex]);
        if (Number.isNaN(parsed)) errors.push(rowIssue(rowNumber, code, name, "invalid Grand Total value in " + stageKey.replace(/_/g, " ") + "."));
        values.grand_total[stageKey] = parsed === null && Number.isFinite(categoryTotal) ? categoryTotal : parsed;
        if (parsed !== null && !Number.isNaN(parsed)) hasValue = true;
      });
      const categoryTotal = classes.reduce((sum, [classKey]) => {
        const value = values[classKey].total;
        return Number.isNaN(value) ? NaN : sum + (Number.isFinite(value) ? value : 0);
      }, 0);
      const grandTotal = numberValue(raw[grandTotalOffset + 4]);
      if (Number.isNaN(grandTotal)) errors.push(rowIssue(rowNumber, code, name, "invalid Grand Total total."));
      values.grand_total.total = grandTotal === null && Number.isFinite(categoryTotal) ? categoryTotal : grandTotal;
      if (grandTotal !== null && !Number.isNaN(grandTotal)) hasValue = true;
      const rowTotalCheck = validateStandingRowTotals(classes, values, rowNumber, code, name);
      errors.push(...rowTotalCheck.errors);
      rowTotalErrorCount += rowTotalCheck.errors.length;
      rowTotalChecked += rowTotalCheck.checked;
      rowTotalSkipped += rowTotalCheck.skipped;
      if (hasValue) rows.push({ location, values, rowNumber, nameOnly: Boolean(match.nameOnly) });
    });
    const levels = datasetLevelInfo(rows);
    const deepest = levels.defaultLevel;
    const hierarchyClasses = classes.concat([["grand_total", "Grand Total"]]);
    const metricDefinitions = hierarchyClasses.flatMap(([classKey, classLabel]) => [
      ...STAGES.map(([stageKey, stageLabel]) => ({ key: classKey + "." + stageKey, title: classLabel + " · " + stageLabel, additive: true })),
      { key: classKey + ".total", title: classLabel + " · Total", additive: true },
    ]);
    const hierarchy = validateHierarchy(rows, metricDefinitions, (row, key) => { const [classKey, stageKey] = key.split("."); return row.values[classKey]?.[stageKey]; });
    const boundaryWarnings = missingBoundaryWarnings(rows);
    const infos = levels.observed.length > 1 ? ["Dataset-level: Multiple geographic levels are present. HUC rows are treated as Province / HUC; the default map level is " + levelLabel(deepest) + " because it contains the most rows."] : [];
    if (nationalRows) infos.push("Source lineage: " + nationalRows + " national aggregate row(s) were retained in the uploaded file and excluded from map analysis.");
    if (historicalHeaderRows) infos.push("Source lineage: " + historicalHeaderRows + " blank historical grouping row(s) were excluded from map analysis.");
    if (sourceDetailRows) infos.push("Source lineage: " + sourceDetailRows + " HUC source-detail row(s) were excluded from map analysis to avoid double counting their mapped city aggregate.");
    const checks = [];
    const structureErrors = errors.filter((error) => validationIssueRank(error) <= 10);
    addValidationCheck(checks, "File structure", structureErrors.length ? "error" : "pass", structureErrors.length ? structureErrors.length + " file or row structure issue(s) need correction" : (crop === "corn" ? "Corn" : "Rice") + " template · " + (csv.length - 2) + " data rows");
    const pairingError = errors.some((error) => /Location mismatch|PSGC code|Location name/.test(error));
    const nameOnlyCount = rows.filter((row) => row.nameOnly).length;
    addValidationCheck(checks, "Location name + PSGC pairing", pairingError ? "error" : "pass", pairingError ? "Review row errors" : nameOnlyCount ? nameOnlyCount + " unique name-only row(s) accepted" : "All rows paired");
    addValidationCheck(checks, "Geographic normalization", "pass", levels.observed.map(levelLabel).join(", "));
    addValidationCheck(checks, "Row totals", rowTotalErrorCount ? "error" : "pass", rowTotalErrorCount
      ? rowTotalErrorCount + " row-level total issue(s) need correction"
      : rowTotalSkipped
        ? "Checked valid numeric rows; review invalid values separately"
        : rowTotalChecked
          ? "Category and Grand Total values reconcile"
          : "No populated metric rows to check");
    if (!rows.length) errors.push("Dataset-level: No valid Standing Crops rows were available after validation.");
    const validation = validationResult(errors.concat(hierarchy.errors), hierarchy.warnings.concat(boundaryWarnings), checks.concat(hierarchy.checks), csv.length - 2, rows.length, levels, infos);
    return { fileName, crop, rows, analysisRows: rows.filter((row) => row.location.level === deepest), deepest, availableLevels: levels.availableLevels, validation, classes };
  }

  function sumMetric(rows, getter) { return rows.reduce((total, row) => { const value = getter(row); return total + (Number.isFinite(value) ? value : 0); }, 0); }
  function standingMetric(row, classKey, stageKey) {
    const dataset = activeStandingDataset(); const classes = classKey === "all" ? (dataset?.classes || []).map((item) => item[0]) : [classKey];
    return classes.reduce((total, key) => total + (Number.isFinite(row.values[key] && row.values[key][stageKey]) ? row.values[key][stageKey] : 0), 0);
  }
  function mapKind(id) { return id.replace(/-map$/, ""); }
  function mapStatus(id, kind, message, type) {
    showStatus(type || "success", message, kind);
  }
  function createMapButton(parent, className, label, title, action, iconMarkup) {
    const button = L.DomUtil.create("button", className, parent);
    button.type = "button";
    button.setAttribute("aria-label", title);
    button.title = title;
    if (iconMarkup) button.innerHTML = iconMarkup; else button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }
  function bindMapOptionKeyboardNavigation(buttons) {
    const items = Array.from(buttons || []);
    items.forEach((button, index) => button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (index + 1) % items.length;
      if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (index - 1 + items.length) % items.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = items.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      items[nextIndex]?.focus();
    }));
  }
  function syncFullscreenButtons() {
    Object.entries(state.mapControls).forEach(([id, controls]) => {
      const active = state.fullscreenMapId === id;
      controls.fullscreenButton.setAttribute("aria-pressed", active ? "true" : "false");
      controls.fullscreenButton.setAttribute("aria-label", active ? "Exit map fullscreen" : "Expand map to browser window");
      controls.fullscreenButton.innerHTML = active ? MAP_ICONS.compress : MAP_ICONS.expand;
      safeInvalidateMapSize(state.maps[id]);
    });
  }
  function interfaceForTheme(themeKey) {
    if (themeKey === "sky") return MAP_INTERFACE_THEMES.sky;
    return MAP_THEMES[themeKey]?.tone === "dark" ? MAP_INTERFACE_THEMES.dark : MAP_INTERFACE_THEMES.light;
  }
  function applyMapTheme(id, themeKey) {
    const theme = MAP_THEMES[themeKey] || MAP_THEMES.light;
    const map = state.maps[id];
    state.mapThemes[id] = themeKey in MAP_THEMES ? themeKey : "light";
    const uiTheme = interfaceForTheme(state.mapThemes[id]);
    map.getContainer().style.backgroundColor = theme.color;
    map.getContainer().dataset.mapTheme = state.mapThemes[id];
    Object.entries({ "--map-accent-color": MAP_PALETTES[state.mapPalettes[id] || "blue"].accent, "--map-control-color": theme.controlColor, "--map-ui-surface": uiTheme.surface, "--map-glass-hover": uiTheme.glassHover, "--map-ui-surface-hover": uiTheme.surfaceHover, "--map-popup-surface": uiTheme.popupSurface, "--map-popup-surface-opaque": uiTheme.popupSurfaceOpaque, "--map-ui-text": uiTheme.text, "--map-ui-muted": uiTheme.muted, "--map-ui-border": uiTheme.border, "--map-ui-focus": uiTheme.focus, "--map-ui-accent": uiTheme.accent, "--map-ui-accent-surface": uiTheme.accentSurface, "--map-ui-control-bg": uiTheme.controlSurface, "--map-ui-control-bg-hover": uiTheme.controlSurfaceHover, "--map-ui-control-border": uiTheme.controlBorder, "--map-ui-control-icon": uiTheme.controlIcon, "--map-ui-control-focus": uiTheme.controlFocus, "--map-ui-control-active-bg": uiTheme.controlActiveBg, "--map-ui-control-active-text": uiTheme.controlActiveText, "--map-ui-shadow": uiTheme.shadow, "--map-grid-color": theme.gridColor, "--map-cartography-color": theme.cartographyColor, "--map-cartography-secondary-color": theme.cartographySecondaryColor, "--map-boundary-label-buffer-width": "1.2px", "--map-boundary-label-buffer": "rgba(9,9,11,.94)" }).forEach(([property, value]) => map.getContainer().style.setProperty(property, value));
    const overview = state.overviews[id];
    if (overview) {
      overview.node.style.backgroundColor = theme.overviewColor || theme.color;
      overview.viewport.setStyle({ color: uiTheme.focus, fillColor: uiTheme.focus });
    }
    state.coordinateGrids[id]?.refreshStyle();
    refreshBaseBoundaryStyle(id);
    // Dataset layers are GeoJSON for Boundary/Standing maps, but Geologic
    // Hazards uses a LayerGroup for its mixed volcano and earthquake markers.
    // Only style layers that expose Leaflet's setStyle method.
    state.layers[id]?.setStyle?.(dataBoundaryStrokeStyle(id));
    if (state.selectedLayers[id]) state.selectedLayers[id].setStyle(boundarySelectionStyle(id));
    refreshPagasaThemeStyles(id);
    const controls = state.mapControls[id];
    if (controls) {
      controls.themePanel.dataset.mapBackground = theme.tone;
      controls.themePanel.dataset.mapBackgroundKey = state.mapThemes[id];
      controls.themeOptions.forEach((button) => button.setAttribute("aria-pressed", button.dataset.mapThemeOption === state.mapThemes[id] ? "true" : "false"));
    }
    if (!id.includes("-export-")) saveMapPreferences(id);
  }
  function addBasemap(id, basemapKey) {
    const map = state.maps[id];
    const definition = MAP_BASEMAPS[basemapKey] || MAP_BASEMAPS.default;
    const previous = state.basemaps[id];
    previous?.cleanup?.();
    if (previous?.layer && map.hasLayer(previous.layer)) map.removeLayer(previous.layer);
    let layer = null; let cleanup = null;
    if (definition.url) {
      layer = L.tileLayer(definition.url, { ...definition.options, crossOrigin: true });
      let finishLoading = null;
      const startLoading = () => { finishLoading?.(); finishLoading = beginMapLoading(id, "Loading basemap…"); };
      const stopLoading = () => { finishLoading?.(); finishLoading = null; };
      layer.on("loading", startLoading); layer.on("load", stopLoading); layer.on("remove", stopLoading);
      cleanup = () => { stopLoading(); layer.off("loading", startLoading); layer.off("load", stopLoading); layer.off("remove", stopLoading); };
      layer.addTo(map);
    }
    state.basemaps[id] = { key: basemapKey in MAP_BASEMAPS ? basemapKey : "default", layer, cleanup };
    const controls = state.mapControls[id];
    if (controls) {
      controls.basemapOptions.forEach((button) => button.setAttribute("aria-pressed", button.dataset.mapBasemapOption === state.basemaps[id].key ? "true" : "false"));
      controls.basemapPanel.dataset.mapBasemap = state.basemaps[id].key;
    }
    saveMapPreferences(id);
    refreshBaseBoundaryStyle(id);
  }
  function applyMapLegendPosition(id, position, options) {
    const settings = options || {};
    const normalized = normalizeLegendPosition(position);
    const map = state.maps[id];
    state.mapLegendPositions[id] = normalized;
    const legend = state.legends[mapKind(id)];
    if (legend && map) legend.setPosition(normalized);
    const controls = state.mapControls[id];
    controls?.legendPositionOptions?.forEach((button) => button.setAttribute("aria-pressed", button.dataset.mapLegendPosition === normalized ? "true" : "false"));
    if (map) map.getContainer().dataset.mapLegendPosition = normalized;
    syncAffectedAreasPosition(id);
    if (settings.persist !== false && !id.includes("-export-")) saveMapPreferences(id);
  }

  function oppositeLegendPosition(position) {
    return normalizeLegendPosition(position) === "topleft" ? "bottomleft" : "topleft";
  }

  function syncAffectedAreasPosition(id) {
    if (id !== "general-map") return;
    const host = state.affectedAreaLists[id]?.host || state.maps[id]?.getContainer?.().querySelector(".map-studio-affected-areas-host");
    if (!host) return;
    host.dataset.mapAffectedPosition = oppositeLegendPosition(state.mapLegendPositions[id]);
  }

  function syncAffectedAreasToggle(id) {
    const toggle = state.mapControls[id]?.affectedAreasToggle;
    if (!toggle) return;
    const list = state.affectedAreaLists[id];
    const hasLocations = Boolean(list?.locations?.length);
    const visible = Boolean(state.affectedAreasVisible[id]) && hasLocations;
    toggle.disabled = !hasLocations;
    const label = toggle.querySelector(".map-studio-basemap-toggle-option__label");
    if (label) label.textContent = list?.locations?.length === 1 ? "Affected Area" : "Affected Areas";
    toggle.setAttribute("aria-pressed", visible ? "true" : "false");
    toggle.setAttribute("aria-label", (visible ? "Hide" : "Show") + " affected areas");
    toggle.title = (visible ? "Hide" : "Show") + " affected areas";
    const stateLabel = toggle.querySelector(".map-studio-basemap-toggle-option__state");
    if (stateLabel) stateLabel.textContent = hasLocations ? (visible ? "Shown" : "Hidden") : "No data";
  }

  function syncAffectedBoundaryLabelsToggle(id) {
    const toggle = state.mapControls[id]?.affectedBoundaryLabelsToggle;
    if (!toggle) return;
    const labels = state.affectedBoundaryLabels[id];
    const hasLabels = Boolean(labels?.getLayers?.().length);
    const visible = Boolean(state.affectedBoundaryLabelsVisible[id]) && hasLabels;
    toggle.disabled = !hasLabels;
    toggle.setAttribute("aria-pressed", visible ? "true" : "false");
    toggle.setAttribute("aria-label", (visible ? "Hide" : "Show") + " boundary labels");
    toggle.title = (visible ? "Hide" : "Show") + " boundary labels";
    const stateLabel = toggle.querySelector(".map-studio-basemap-toggle-option__state");
    if (stateLabel) stateLabel.textContent = hasLabels ? (visible ? "Shown" : "Hidden") : "No data";
  }

  function toggleAffectedAreas(id) {
    const list = state.affectedAreaLists[id];
    if (!list?.locations?.length) return;
    state.affectedAreasVisible[id] = !state.affectedAreasVisible[id];
    const visible = Boolean(state.affectedAreasVisible[id]);
    list.host.hidden = !visible;
    list.host.setAttribute("aria-hidden", visible ? "false" : "true");
    syncAffectedAreasToggle(id);
  }

  function toggleAffectedBoundaryLabels(id) {
    const labels = state.affectedBoundaryLabels[id];
    const map = state.maps[id];
    if (!labels?.getLayers?.().length || !map) return;
    state.affectedBoundaryLabelsVisible[id] = !state.affectedBoundaryLabelsVisible[id];
    const visible = Boolean(state.affectedBoundaryLabelsVisible[id]);
    if (visible && !map.hasLayer(labels)) labels.addTo(map);
    if (!visible && map.hasLayer(labels)) map.removeLayer(labels);
    syncAffectedBoundaryLabelsToggle(id);
  }

  function affectedAreaLocations(aggregatedRows, targetLevel) {
    const locations = new Map();
    aggregatedRows.forEach((row) => {
      const value = row.values?.value;
      if (!Number.isFinite(value) || value <= 0) return;
      const location = targetLevel === "municipality_city" ? resolveParent(row.location, "province_huc") : row.location;
      if (!location) return;
      const key = locationKey(location);
      const existing = locations.get(key);
      if (existing) existing.value += value;
      else locations.set(key, { location, value });
    });
    return [...locations.values()].sort((left, right) => right.value - left.value || String(left.location.name || "").localeCompare(String(right.location.name || ""), "en", { sensitivity: "base" }));
  }

  function renderAffectedAreas(locations, targetLevel) {
    const id = "general-map";
    const map = state.maps[id];
    if (!map) return;
    removeAffectedBoundaryLabels(id);
    const previous = state.affectedAreaLists[id];
    previous?.host?.remove();
    if (!locations?.length) {
      delete state.affectedAreaLists[id];
      syncAffectedAreasToggle(id);
      return;
    }
    const host = document.createElement("div");
    host.className = "map-studio-affected-areas-host";
    host.id = "general-map-affected-areas";
    host.setAttribute("role", "group");
    host.setAttribute("aria-label", locations.length === 1 ? "Affected Area" : "Affected Areas");
    const panel = document.createElement("div");
    panel.className = "map-studio-affected-areas";
    const title = document.createElement("div");
    title.className = "map-studio-affected-areas__title";
    title.textContent = locations.length === 1 ? "Affected Area" : "Affected Areas";
    const content = document.createElement("div");
    content.className = "map-studio-affected-areas__content";
    const list = document.createElement("ul");
    list.className = "map-studio-affected-areas__list";
    locations.forEach((location) => {
      const item = document.createElement("li");
      item.textContent = location.location.name;
      list.appendChild(item);
    });
    content.appendChild(list);
    panel.append(title, content);
    host.appendChild(panel);
    map.getContainer().appendChild(host);
    state.affectedAreaLists[id] = { host, locations, targetLevel };
    host.hidden = !state.affectedAreasVisible[id];
    host.setAttribute("aria-hidden", host.hidden ? "true" : "false");
    syncAffectedAreasPosition(id);
    syncAffectedAreasToggle(id);
  }

  function removeAffectedBoundaryLabels(id) {
    const labels = state.affectedBoundaryLabels[id];
    const map = state.maps[id];
    if (labels && map?.hasLayer(labels)) map.removeLayer(labels);
    delete state.affectedBoundaryLabels[id];
    delete state.affectedBoundaryLabelContext[id];
    syncAffectedBoundaryLabelsToggle(id);
  }

  function syncAffectedBoundaryLabelsZoom(id) {
    if (id !== "general-map") return;
    const map = state.maps[id];
    if (!map) return;
    const zoom = Number(map.getZoom());
    const fontSize = Number.isFinite(zoom) ? Math.max(.42, Math.min(.68, .35 + Math.max(0, zoom) * .045)) : .56;
    map.getContainer().style.setProperty("--map-boundary-label-font-size", fontSize.toFixed(3) + "rem");
  }

  function refreshAffectedBoundaryLabels(id) {
    const context = state.affectedBoundaryLabelContext[id];
    if (!context) return;
    renderAffectedBoundaryLabels(id, context.targetLevel, context.valuesByCode);
  }

  function boundaryLabelCenter(layer) {
    const rings = [];
    const collectRings = (value) => {
      if (!Array.isArray(value) || !value.length) return;
      if (value.every((item) => item && Number.isFinite(item.lat) && Number.isFinite(item.lng))) { rings.push(value); return; }
      value.forEach(collectRings);
    };
    collectRings(layer.getLatLngs?.());
    let totalArea = 0; let totalLat = 0; let totalLng = 0;
    rings.forEach((ring) => {
      if (ring.length < 3) return;
      let areaTwice = 0; let centroidLat = 0; let centroidLng = 0;
      ring.forEach((point, index) => {
        const next = ring[(index + 1) % ring.length]; const cross = point.lng * next.lat - next.lng * point.lat;
        areaTwice += cross; centroidLng += (point.lng + next.lng) * cross; centroidLat += (point.lat + next.lat) * cross;
      });
      if (Math.abs(areaTwice) < 1e-9) return;
      const area = areaTwice / 2; const weight = Math.abs(area);
      totalArea += weight; totalLng += (centroidLng / (3 * areaTwice)) * weight; totalLat += (centroidLat / (3 * areaTwice)) * weight;
    });
    if (totalArea > 0) return L.latLng(totalLat / totalArea, totalLng / totalArea);
    try { return layer.getBounds().getCenter(); } catch (_) { return null; }
  }

  const BOUNDARY_LABEL_COLLISION_CELL_SIZE = 128;
  function boundaryLabelCollisionIndex(cellSize = BOUNDARY_LABEL_COLLISION_CELL_SIZE) {
    return { cellSize, cells: new Map() };
  }
  function boundaryLabelCollisionCellRange(box, cellSize, padding = 0) {
    return {
      minX: Math.floor((box.left - padding) / cellSize),
      maxX: Math.floor((box.right + padding) / cellSize),
      minY: Math.floor((box.top - padding) / cellSize),
      maxY: Math.floor((box.bottom + padding) / cellSize),
    };
  }
  function indexBoundaryLabelBox(index, box) {
    const range = boundaryLabelCollisionCellRange(box, index.cellSize);
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const key = x + ":" + y;
        const bucket = index.cells.get(key) || [];
        bucket.push(box);
        index.cells.set(key, bucket);
      }
    }
  }
  function boundaryLabelCollides(candidate, accepted, padding) {
    const intersects = (item) => candidate.left < item.right + padding && candidate.right > item.left - padding && candidate.top < item.bottom + padding && candidate.bottom > item.top - padding;
    if (!accepted?.cells) return accepted.some(intersects);
    const range = boundaryLabelCollisionCellRange(candidate, accepted.cellSize, padding);
    const checked = new Set();
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        const bucket = accepted.cells.get(x + ":" + y) || [];
        for (const item of bucket) {
          if (checked.has(item)) continue;
          checked.add(item);
          if (intersects(item)) return true;
        }
      }
    }
    return false;
  }

  function renderAffectedBoundaryLabels(id, targetLevel, valuesByCode) {
    removeAffectedBoundaryLabels(id);
    const map = state.maps[id];
    const dataLayer = state.layers[id];
    if (id !== "general-map" || !map || !dataLayer || !valuesByCode?.size) return;
    const labels = [];
    const candidates = [];
    const seen = new Set();
    dataLayer.eachLayer((layer) => {
      const properties = layer.feature?.properties || {};
      const location = resolveLocation(properties.psgc_code, properties.psgc_name, targetLevel);
      const key = location ? locationKey(location) : "";
      const value = key ? valuesByCode.get(key) : null;
      if (!location || !key || seen.has(key) || !Number.isFinite(value) || value <= 0) return;
      const center = boundaryLabelCenter(layer);
      if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;
      seen.add(key);
      const name = String(location.name || properties.psgc_name || "Unknown");
      const point = map.latLngToContainerPoint(center);
      const labelFontPx = Math.max(7, 16 * (Number.parseFloat(map.getContainer().style.getPropertyValue("--map-boundary-label-font-size")) || .56));
      const labelWidth = Math.max(labelFontPx * 2.5, name.length * labelFontPx * .48);
      const labelHeight = labelFontPx * 1.35;
      let featureArea = 0;
      try { const bounds = layer.getBounds(); const southWest = map.latLngToContainerPoint(bounds.getSouthWest()); const northEast = map.latLngToContainerPoint(bounds.getNorthEast()); featureArea = Math.abs((northEast.x - southWest.x) * (southWest.y - northEast.y)); } catch (_) { /* Keep the candidate when geometry bounds cannot be projected. */ }
      candidates.push({ center, name, featureArea, box: { left: point.x - labelWidth / 2, right: point.x + labelWidth / 2, top: point.y - labelHeight / 2, bottom: point.y + labelHeight / 2 } });
    });
    const zoom = Number(map.getZoom()); const collisionPadding = Number.isFinite(zoom) && zoom < 6 ? 7 : 4; const collisionIndex = boundaryLabelCollisionIndex();
    candidates.sort((left, right) => right.featureArea - left.featureArea || left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
    candidates.forEach((candidate) => {
      if (boundaryLabelCollides(candidate.box, collisionIndex, collisionPadding)) return;
      indexBoundaryLabelBox(collisionIndex, candidate.box);
      labels.push(L.marker(candidate.center, {
        icon: L.divIcon({
          className: "map-studio-boundary-label",
          html: '<span class="map-studio-boundary-label__text">' + esc(candidate.name) + "</span>",
          iconSize: null,
          iconAnchor: [0, 0],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 100,
      }));
    });
    if (!labels.length) return;
    const labelLayer = L.layerGroup(labels);
    state.affectedBoundaryLabels[id] = labelLayer;
    state.affectedBoundaryLabelContext[id] = { targetLevel, valuesByCode };
    syncAffectedBoundaryLabelsZoom(id);
    if (state.affectedBoundaryLabelsVisible[id]) labelLayer.addTo(map);
    syncAffectedBoundaryLabelsToggle(id);
  }
  function refreshBaseBoundaryStyle(id) {
    const base = state.baseLayers[id];
    if (!base) return;
    const boundaryOnly = state.basemaps[id]?.key !== "default";
    base.municipality?.setStyle({ ...DEFAULT_BOUNDARY_STYLES.municipality, weight: boundaryOnly ? .58 : DEFAULT_BOUNDARY_STYLES.municipality.weight, opacity: boundaryOnly ? .9 : DEFAULT_BOUNDARY_STYLES.municipality.opacity });
    base.province.setStyle({ ...DEFAULT_BOUNDARY_STYLES.province, weight: boundaryOnly ? .86 : DEFAULT_BOUNDARY_STYLES.province.weight, opacity: boundaryOnly ? .9 : DEFAULT_BOUNDARY_STYLES.province.opacity });
    base.administrative.setStyle({ ...DEFAULT_BOUNDARY_STYLES.region, weight: boundaryOnly ? 1.25 : DEFAULT_BOUNDARY_STYLES.region.weight, fillColor: "transparent", fillOpacity: 0, opacity: boundaryOnly ? .95 : DEFAULT_BOUNDARY_STYLES.region.opacity });
    base.outline.setStyle({ color: MAP_BOUNDARY_OUTLINE, weight: boundaryOnly ? 1 : .65, fillColor: "#ffffff", fillOpacity: boundaryOnly ? 0 : 1, opacity: boundaryOnly ? .9 : .72, smoothFactor: .25 });
  }
  function mapSelectionColor(id) {
    const theme = MAP_THEMES[state.mapThemes[id] || "light"] || MAP_THEMES.light;
    // Keep the selection neutral and legible against the chosen map background:
    // dark map themes use a soft light gray; all lighter themes use charcoal.
    return theme.tone === "dark" ? "#e4e4e7" : "#52525b";
  }
  function boundarySelectionStyle(id) {
    const color = mapSelectionColor(id);
    // Only the outline changes; the data-driven fill remains untouched.
    return { color, opacity: .9, weight: .85 };
  }
  function dataBoundaryStrokeStyle(id) {
    // Keep data-area edges consistent with the Dashboard in every Map Studio
    // module and theme. Base layers remain responsible for hierarchy weight.
    return { color: MAP_BOUNDARY_OUTLINE, weight: .25, opacity: .85 };
  }
  function clearBoundarySelection(id, options) {
    const settings = options || {};
    const selected = state.selectedLayers[id];
    const dataLayer = state.layers[id];
    if (selected && dataLayer?.resetStyle) dataLayer.resetStyle(selected);
    state.selectedLayers[id] = null;
    if (settings.closePopup) state.maps[id]?.closePopup();
  }
  function selectBoundary(id, layer) {
    if (!layer) return;
    const previous = state.selectedLayers[id];
    if (previous && previous !== layer) state.layers[id]?.resetStyle(previous);
    state.selectedLayers[id] = layer;
    layer.setStyle(boundarySelectionStyle(id));
    layer.bringToFront();
  }
  function setBoundaryVisibility(id, targetLevel) {
    state.boundaryLevels[id] = targetLevel || null;
    const base = state.baseLayers[id];
    const map = state.maps[id];
    if (!base || !map) return;
    const visible = {
      municipality: !targetLevel || targetLevel === "municipality_city",
      province: !targetLevel || targetLevel === "province_huc",
      administrative: !targetLevel || targetLevel === "region",
    };
    [["municipality", base.municipality], ["province", base.province], ["administrative", base.administrative]].forEach(([key, layer]) => {
      if (!layer) return;
      if (visible[key] && !map.hasLayer(layer)) map.addLayer(layer);
      if (!visible[key] && map.hasLayer(layer)) map.removeLayer(layer);
    });
  }
  function applyMapPalette(id, paletteKey, options) {
    const settings = options || {};
    state.mapPalettes[id] = normalizePaletteKey(paletteKey, id === "standing-map" ? STANDING_DEFAULT_PALETTES.corn : "blue");
    if (id === "standing-map" && settings.userInitiated) state.standingPaletteCustomized = true;
    const controls = state.mapControls[id];
    controls?.paletteOptions?.forEach((button) => button.setAttribute("aria-pressed", button.dataset.mapPaletteOption === state.mapPalettes[id] ? "true" : "false"));
    state.maps[id].getContainer().style.setProperty("--map-accent-color", MAP_PALETTES[state.mapPalettes[id]].accent);
    if (settings.persist !== false) saveMapPreferences(id);
    const kind = mapKind(id);
    if (state[kind]) renderDatasetMap(kind); else renderDefaultLegend(kind);
  }
  function clippedNationalBounds(bounds) {
    if (!bounds?.isValid?.()) return bounds;
    return L.latLngBounds(
      [bounds.getSouth(), Math.max(bounds.getWest(), PRIMARY_ARCHIPELAGO_WEST_LONGITUDE)],
      [bounds.getNorth(), bounds.getEast()]
    );
  }
  function safeInvalidateMapSize(map) {
    const container = map?.getContainer?.();
    const size = map?.getSize?.();
    const rect = container?.getBoundingClientRect?.();
    if (!map?._loaded || !container || !size || !rect || !Number.isFinite(size.x) || !Number.isFinite(size.y) || size.x <= 0 || size.y <= 0 || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return false;
    try {
      const center = map.getCenter();
      if (!Number.isFinite(center?.lat) || !Number.isFinite(center?.lng)) return false;
      map.invalidateSize({ pan: false });
      return true;
    } catch (_) {
      return false;
    }
  }
  function fitNationalExtent(id, animate) {
    const map = state.maps[id];
    const bounds = state.baseBounds[id];
    const size = map?.getSize?.();
    if (!map || !bounds?.isValid?.() || !size || !Number.isFinite(size.x) || !Number.isFinite(size.y) || size.x <= 0 || size.y <= 0 || !safeInvalidateMapSize(map)) return false;
    const nationalZoom = map.getBoundsZoom(bounds, false, L.point(16, 16));
    map.fitBounds(bounds, { padding: [8, 8], animate: animate !== false });
    if (state.overviews[id]) state.overviews[id].nationalZoom = nationalZoom;
    return true;
  }
  function scheduleMapResize(id, refitExtent) {
    const map = state.maps[id];
    if (!map) return;
    state.mapResizePendingExtent[id] = Boolean(state.mapResizePendingExtent[id] || refitExtent);
    if (state.mapResizeFrames[id] !== undefined) window.cancelAnimationFrame(state.mapResizeFrames[id]);
    state.mapResizeFrames[id] = window.requestAnimationFrame(() => {
      delete state.mapResizeFrames[id];
      syncMapControlsVisibility(id);
      if (!safeInvalidateMapSize(map)) return;
      syncMapControlsVisibility(id);
      if (state.mapResizePendingExtent[id]) fitNationalExtent(id, false);
      state.mapResizePendingExtent[id] = false;
      state.coordinateGrids[id]?.refresh();
      updateOverview(id);
    });
  }

function syncMapControlsVisibility(id) {
  const controls = state.mapControls[id];
  if (!controls) return;
  const hidden = Boolean(controls.controlsHidden);
  controls.primaryControls.hidden = hidden;
  if (controls.clearControl) controls.clearControl.hidden = hidden;
  if (controls.rightActionControls) controls.rightActionControls.hidden = hidden;

  const button = controls.rightSettingsButton;
  if (!button) return;
  const visible = !hidden;
  button.setAttribute("aria-expanded", visible ? "true" : "false");
  button.setAttribute("aria-pressed", visible ? "true" : "false");
  button.setAttribute("aria-label", visible ? "Hide map actions" : "Show map actions");
  button.title = visible ? "Hide map actions" : "Show map actions";
  button.innerHTML = visible ? MAP_ICONS.hideControls : MAP_ICONS.showControls;
}
  function observeMapCanvas(id) {
    const map = state.maps[id];
    const container = map?.getContainer?.();
    if (!container || state.mapResizeObservers[id]) return;
    const panel = container.closest(".visual-panel");
    let observedWidth = null;
    const handleResize = (currentWidth) => {
      if (observedWidth === null) {
        observedWidth = currentWidth;
        scheduleMapResize(id, false);
        return;
      }
      const widthChanged = Math.abs(currentWidth - observedWidth) >= 1;
      observedWidth = currentWidth;
      const preserveView = Boolean(state.mapResizePreserveView[id]);
      state.mapResizePreserveView[id] = false;
      scheduleMapResize(id, widthChanged && !preserveView);
    };
    if (!("ResizeObserver" in window)) {
      const listener = () => {
        if (state.mapCanvasPresets[id]) applyMapCanvasPreset(id, state.mapCanvasPresets[id]);
        handleResize(container.getBoundingClientRect().width);
      };
      window.addEventListener("resize", listener);
      state.mapResizeObservers[id] = { disconnect: () => window.removeEventListener("resize", listener) };
      return;
    }
    const observer = new ResizeObserver((entries) => {
      if (panel && entries.some((candidate) => candidate.target === panel) && state.mapCanvasPresets[id]) applyMapCanvasPreset(id, state.mapCanvasPresets[id]);
      const entry = entries.find((candidate) => candidate.target === container);
      if (entry) handleResize(Number(entry.contentRect?.width || container.getBoundingClientRect().width || 0));
    });
    observer.observe(container);
    if (panel) observer.observe(panel);
    state.mapResizeObservers[id] = observer;
  }
  function updateOverview(id) {
    const overview = state.overviews[id];
    const map = state.maps[id];
    const size = map?.getSize?.();
    if (!overview || !map || !Number.isFinite(overview.nationalZoom) || !size || size.x <= 0 || size.y <= 0) return;
    const visible = map.getZoom() >= overview.nationalZoom + (2 * map.options.zoomDelta);
    overview.viewport.setBounds(map.getBounds());
    overview.wrap.classList.toggle("is-visible", visible);
    overview.wrap.setAttribute("aria-hidden", visible ? "false" : "true");
    if (visible) safeInvalidateMapSize(overview.map);
  }
  function createOverviewMap(id, regions, outline, nationalBounds) {
    const mainSize = state.maps[id]?.getSize?.();
    if (state.overviews[id] || !nationalBounds?.isValid?.() || !mainSize || mainSize.x <= 0 || mainSize.y <= 0) return;
    const mainMap = state.maps[id];
    const wrap = L.DomUtil.create("div", "map-studio-overview-wrap", mainMap.getContainer());
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "Philippines reference map showing the current map extent");
    wrap.setAttribute("aria-hidden", "true");
    const node = L.DomUtil.create("div", "map-studio-overview-map", wrap);
    const overviewMap = L.map(node, { attributionControl: false, boxZoom: false, dragging: false, doubleClickZoom: false, keyboard: false, scrollWheelZoom: false, touchZoom: false, zoomControl: false, trackResize: false, preferCanvas: false });
    L.geoJSON(outline, { interactive: false, style: { color: MAP_BOUNDARY_OUTLINE, fill: true, fillColor: "#ffffff", fillOpacity: 1, opacity: .88, weight: .55, smoothFactor: .25 } }).addTo(overviewMap);
    L.geoJSON(regions, { interactive: false, style: { color: MAP_BOUNDARY_OUTLINE, fill: false, opacity: .62, weight: .35, smoothFactor: .25 } }).addTo(overviewMap);
    overviewMap.fitBounds(nationalBounds, { padding: [5, 5], animate: false });
    overviewMap.setZoom(overviewMap.getZoom() + .25, { animate: false });
    const viewport = L.rectangle(mainMap.getBounds(), { color: "#3f7254", fillColor: "#3f7254", fillOpacity: .12, opacity: .92, weight: 1, interactive: false }).addTo(overviewMap);
    state.overviews[id] = { wrap, node, map: overviewMap, viewport, nationalZoom: mainMap.getZoom() };
    mainMap.on("moveend zoomend", () => updateOverview(id));
    applyMapTheme(id, state.mapThemes[id]);
    updateOverview(id);
  }
  function initializeBasePresentation(id) {
    const base = state.baseLayers[id];
    if (!base) return;
    if (!state.initialExtentApplied[id] && fitNationalExtent(id, false)) state.initialExtentApplied[id] = true;
    if (!state.overviews[id]) createOverviewMap(id, base.regionsGeo, base.outlineGeo, state.baseBounds[id]);
  }

  function loadBaseGeometry() {
    if (baseGeometryPromise) return baseGeometryPromise;
    const asset = async (path, label) => {
      const response = await fetchWithTimeout(mapAsset(path), {}, 15000);
      if (!response.ok) throw new Error("Unable to load " + label + ".");
      return response.json();
    };
    baseGeometryPromise = Promise.all([
      asset("assets/geo/regions.geojson", "region boundaries"),
      asset("assets/geo/provinces.geojson", "province boundaries"),
      asset("assets/geo/philippines_outline.geojson", "the Philippine outline"),
    ]).then(([regions, provinces, outline]) => ({ regions, provinces, outline }))
      .catch((error) => {
        baseGeometryPromise = null;
        throw error;
      });
    return baseGeometryPromise;
  }

  function addBaseLayer(id) {
    const map = state.maps[id];
    const finishLoading = beginMapLoading(id, "Loading map layers…");
    loadBaseGeometry().then(({ regions, provinces, outline }) => {
      const landmassPane = "nationalLandmassPane-" + id;
      const municipalityPane = "municipalityBoundaryPane-" + id;
      const provincePane = "provinceBoundaryPane-" + id;
      const regionPane = "regionBoundaryPane-" + id;
      const dataPane = "mapDataPane-" + id;
      [
        [landmassPane, 250],
        [municipalityPane, 280],
        [provincePane, 300],
        [regionPane, 320],
        [dataPane, 420],
      ].forEach(([name, zIndex]) => {
        const pane = map.createPane(name); pane.style.zIndex = String(zIndex); pane.style.pointerEvents = name === dataPane ? "auto" : "none";
      });
      const administrativeLayer = L.geoJSON(regions, {
        pane: regionPane,
        interactive: false,
        style: { ...DEFAULT_BOUNDARY_STYLES.region, fillColor: "transparent", fillOpacity: 0 },
      });
      const provinceLayer = L.geoJSON(provinces, {
        pane: provincePane,
        interactive: false,
        filter: (feature) => feature.properties?.is_reporting_area !== false,
        style: { ...DEFAULT_BOUNDARY_STYLES.province, fillColor: "transparent", fillOpacity: 0 },
      });
      const outlineLayer = L.geoJSON(outline, { pane: landmassPane, interactive: false, style: { color: MAP_BOUNDARY_OUTLINE, weight: .65, fillColor: "#ffffff", fillOpacity: 1, opacity: .72, smoothFactor: .25 } });
      const group = L.featureGroup([outlineLayer, provinceLayer, administrativeLayer]).addTo(map);
      state.baseLayers[id] = { group, administrative: administrativeLayer, region: administrativeLayer, province: provinceLayer, municipality: null, outline: outlineLayer, regionsGeo: regions, outlineGeo: outline };
      refreshBaseBoundaryStyle(id);
      setBoundaryVisibility(id, state.boundaryLevels[id]);
      // Derive the national reset from the complete province source;
      // reporting-area filters affect interaction, not the extent.
      state.baseBounds[id] = clippedNationalBounds(L.geoJSON(provinces).getBounds());
      initializeBasePresentation(id);
      if (state.boundaryLevels[id] === "municipality_city") ensureMunicipalityBaseLayer(id).catch(() => mapStatus(id, mapKind(id), "Municipality boundaries could not be loaded.", "error"));
    }).catch(() => {
      mapStatus(id, mapKind(id), "The base map could not be loaded.", "error");
    }).finally(finishLoading);
  }
  async function ensureMunicipalityBaseLayer(id) {
    const base = state.baseLayers[id];
    const map = state.maps[id];
    if (!base || !map || base.municipality) return;
    if (base.municipalityPromise) return base.municipalityPromise;
    base.municipalityPromise = loadGeo("municipality_city").then((geo) => {
      if (base.municipality) return;
      const municipalityPane = "municipalityBoundaryPane-" + id;
      base.municipality = L.geoJSON(geo, {
        pane: municipalityPane,
        interactive: false,
        style: { ...DEFAULT_BOUNDARY_STYLES.municipality, fillColor: "transparent", fillOpacity: 0 },
      });
      base.group.addLayer(base.municipality);
      refreshBaseBoundaryStyle(id);
      setBoundaryVisibility(id, state.boundaryLevels[id]);
    }).finally(() => { base.municipalityPromise = null; });
    return base.municipalityPromise;
  }
  function coordinateGridStep(desired) {
    const steps = [.1, .25, .5, 1, 2, 2.5, 5, 10, 15, 20, 30, 45, 90];
    return steps.find((step) => step >= Math.max(desired, .000001)) || steps[steps.length - 1];
  }
  function addCoordinateGrid(map, id) {
    const paneName = "coordinateGridPane-" + id;
    const pane = map.createPane(paneName); pane.style.zIndex = "240"; pane.style.pointerEvents = "none";
    const lines = L.layerGroup().addTo(map);
    const labels = L.DomUtil.create("div", "map-studio-coordinate-labels", map.getContainer()); labels.setAttribute("aria-hidden", "true");
    let step = 1; let gridBounds = null;
    let refreshFrame = null;
    function visibleBounds() {
      const size = map.getSize();
      if (!map._loaded || !size || size.x <= 0 || size.y <= 0) return null;
      const center = map.getCenter();
      if (!Number.isFinite(center?.lat) || !Number.isFinite(center?.lng)) return null;
      try {
        const bounds = map.getBounds();
        return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()].every(Number.isFinite) ? bounds : null;
      } catch (_) { return null; }
    }
    const snap = (value, direction) => Number(((direction === "down" ? Math.floor(value / step) : Math.ceil(value / step)) * step).toFixed(6));
    const values = (start, end) => { const result = []; for (let value = snap(start, "up"); value <= end + step / 1000; value = Number((value + step).toFixed(6))) result.push(value); return result; };
    const coordinateLabel = (value, positive, negative) => { if (Math.abs(value) < .000001) return "0°"; const digits = step < 1 ? 2 : step % 1 ? 1 : 0; return Math.abs(value).toLocaleString("en-PH", { maximumFractionDigits: digits }) + "°" + (value > 0 ? positive : negative); };
    function updateLabels() {
      if (!gridBounds || !map.getSize().x || !map.getSize().y) return;
      const visible = visibleBounds(); if (!visible) return;
      labels.replaceChildren(); const size = map.getSize();
      values(gridBounds.west, gridBounds.east).forEach((longitude) => {
        if (longitude < visible.getWest() || longitude > visible.getEast()) return;
        const point = map.latLngToContainerPoint([visible.getNorth(), longitude]);
        if (point.x < 18 || point.x > size.x - 18) return;
        const label = L.DomUtil.create("span", "map-studio-coordinate-label map-studio-coordinate-label--longitude", labels); label.style.left = point.x + "px"; label.textContent = coordinateLabel(longitude, "E", "W");
      });
      values(gridBounds.south, gridBounds.north).forEach((latitude) => {
        if (latitude < visible.getSouth() || latitude > visible.getNorth()) return;
        const point = map.latLngToContainerPoint([latitude, visible.getEast()]);
        if (point.y < 18 || point.y > size.y - 18) return;
        const label = L.DomUtil.create("span", "map-studio-coordinate-label map-studio-coordinate-label--latitude", labels); label.style.top = point.y + "px"; label.textContent = coordinateLabel(latitude, "N", "S");
      });
    }
    function refresh() {
      const visible = visibleBounds(); if (!visible) return;
      const spanLongitude = Math.max(visible.getEast() - visible.getWest(), .000001); const spanLatitude = Math.max(visible.getNorth() - visible.getSouth(), .000001);
      const desiredColumns = Math.max(map.getSize().x / 90, 2); const desiredRows = Math.max(map.getSize().y / 90, 2);
      step = coordinateGridStep(Math.max(spanLongitude / desiredColumns, spanLatitude / desiredRows));
      gridBounds = { south: Math.max(-85, Math.floor(visible.getSouth() / step) * step - step), north: Math.min(85, Math.ceil(visible.getNorth() / step) * step + step), west: Math.max(-180, Math.floor(visible.getWest() / step) * step - step), east: Math.min(180, Math.ceil(visible.getEast() / step) * step + step) };
      lines.clearLayers(); const color = getComputedStyle(map.getContainer()).getPropertyValue("--map-grid-color").trim() || "#ffffff"; const style = { color, interactive: false, opacity: .22, weight: .6, pane: paneName };
      values(gridBounds.south, gridBounds.north).forEach((latitude) => L.polyline([[latitude, gridBounds.west], [latitude, gridBounds.east]], style).addTo(lines));
      values(gridBounds.west, gridBounds.east).forEach((longitude) => L.polyline([[gridBounds.south, longitude], [gridBounds.north, longitude]], style).addTo(lines));
      updateLabels();
    }
    function scheduleRefresh() {
      if (refreshFrame !== null) return;
      refreshFrame = window.requestAnimationFrame(() => { refreshFrame = null; refresh(); });
    }
    function flushRefresh() {
      if (refreshFrame !== null) { window.cancelAnimationFrame(refreshFrame); refreshFrame = null; }
      refresh();
    }
    const grid = { lines, labels, paneName, refresh, refreshStyle: () => { const color = getComputedStyle(map.getContainer()).getPropertyValue("--map-grid-color").trim() || "#ffffff"; lines.eachLayer((layer) => layer.setStyle({ color })); } };
    map.on("move zoom", scheduleRefresh); map.on("moveend zoomend resize", flushRefresh); refresh(); state.coordinateGrids[id] = grid;
  }
  function addMapCartography(map, id) {
    const cartography = L.DomUtil.create("div", "map-studio-cartography", map.getContainer()); cartography.setAttribute("data-map-cartography", ""); cartography.setAttribute("aria-label", "Map orientation and scale");
    const north = L.DomUtil.create("div", "map-studio-north-arrow", cartography); north.setAttribute("data-map-north-arrow", ""); north.setAttribute("role", "img"); north.setAttribute("aria-label", "North arrow"); north.innerHTML = '<span>N</span><svg viewBox="0 0 64 76" fill="none" aria-hidden="true"><circle cx="32" cy="43" r="23" stroke="#ffffff" stroke-width="3"></circle><path d="M32 5 53 68 32 53 11 68 32 5Z" fill="currentColor" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"></path><path d="M32 5V53L11 68 32 5Z" fill="#ffffff"></path></svg>';
    const scaleHost = L.DomUtil.create("div", "map-studio-scale-host", cartography); scaleHost.setAttribute("aria-label", "Metric map scale");
    const crs = L.DomUtil.create("span", "map-studio-crs-label", scaleHost); crs.setAttribute("aria-label", "Coordinate reference system: EPSG:3857, WGS 84"); crs.textContent = "EPSG:3857 · WGS 84";
    const scaleControl = L.control.scale({ position: "bottomright", metric: true, imperial: false, maxWidth: 72, updateWhenIdle: true }).addTo(map); const scaleContainer = scaleControl.getContainer(); scaleContainer.classList.add("map-studio-scale"); scaleHost.insertBefore(scaleContainer, scaleHost.firstChild);
    function updateScale() {
      const scaleLine = scaleContainer.querySelector(".leaflet-control-scale-line"); if (!scaleLine) return;
      const hasRenderedLabels = Boolean(scaleLine.querySelector(".map-studio-scale-label"));
      const rawLabel = hasRenderedLabels ? scaleLine.dataset.mapScaleLabel : scaleLine.textContent.trim();
      const match = rawLabel?.match(/^([\d.]+)\s*([a-z]+)$/i); if (!match) return;
      scaleLine.dataset.mapScaleLabel = rawLabel;
      const half = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 }).format(Number(match[1]) / 2); const bar = document.createElement("span"); const halfLabel = document.createElement("span"); const fullLabel = document.createElement("span");
      bar.className = "map-studio-scale-bar"; bar.setAttribute("aria-hidden", "true"); halfLabel.className = "map-studio-scale-label map-studio-scale-label--half"; fullLabel.className = "map-studio-scale-label map-studio-scale-label--full"; halfLabel.textContent = half; fullLabel.textContent = match[1] + " " + match[2].toUpperCase(); scaleLine.replaceChildren(bar, halfLabel, fullLabel);
    }
    map.on("moveend zoomend resize", updateScale); updateScale(); state.cartography[id] = { cartography, scaleControl };
  }
  function syncPagasaMinimumZoom(id) {
    const map = state.maps[id];
    if (!map) return;
    const active = state.pagasa[id]?.active;
    const wideDomainIsActive = Boolean(active?.has("tcad") || active?.has("tcid"));
    const minimumZoom = wideDomainIsActive ? 2 : 0;
    map.setMinZoom(minimumZoom);
    if (map.getZoom() < minimumZoom) map.setZoom(minimumZoom, { animate: false });
  }
  function toggleFullscreen(id) {
    const map = state.maps[id];
    const active = state.fullscreenMapId === id;
    Object.entries(state.maps).forEach(([mapId, otherMap]) => otherMap.getContainer().classList.toggle("is-browser-fullscreen", !active && mapId === id));
    state.fullscreenMapId = active ? null : id;
    document.body.classList.toggle("map-studio-map-fullscreen", !active);
    syncFullscreenButtons();
    // Fullscreen invalidates the canvas, while ResizeObserver decides whether
    // its width changed enough to reset the national extent. Pending resets
    // survive later callbacks.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (active && state.mapCanvasPresets[id]) applyMapCanvasPreset(id, state.mapCanvasPresets[id]);
      else scheduleMapResize(id, false);
    }));
  }
  function closeThemePanels(except) {
    Object.entries(state.mapControls).forEach(([id, controls]) => {
      if (id !== except) {
        controls.themePanel.hidden = true;
        controls.themeButton.setAttribute("aria-expanded", "false");
      }
    });
    syncMapControlStacks();
  }
  function closeBasemapPanels(except) {
    Object.entries(state.mapControls).forEach(([id, controls]) => {
      if (id !== except) {
        controls.basemapPanel.hidden = true;
        controls.basemapButton.setAttribute("aria-expanded", "false");
      }
    });
    syncMapControlStacks();
  }
  function closeExportPanels(except) {
    Object.entries(state.mapControls).forEach(([id, controls]) => {
      if (id !== except && controls.exportPanel) {
        controls.exportPanel.hidden = true;
        controls.resizeButton?.setAttribute("aria-expanded", "false");
      }
    });
  }
  function setMobileMapMenu(id, open) {
    const controls = state.mapControls[id];
    if (!controls?.mobileMenuButton || !controls.primaryControls) return;
    controls.primaryControls.classList.toggle("is-mobile-menu-open", open);
    controls.mobileMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
    controls.mobileMenuButton.setAttribute("aria-label", open ? "Close map controls" : "Open map controls");
    controls.mobileMenuButton.title = open ? "Close map controls" : "Open map controls";
  }
  function closeMobileMapMenus(except) {
    Object.keys(state.mapControls).forEach((id) => {
      if (id !== except) setMobileMapMenu(id, false);
    });
  }
  function syncMapControlStack(id) {
    const map = state.maps[id];
    const controls = state.mapControls[id];
    if (!map || !controls) return;
    const panelIsOpen = [controls.themePanel, controls.basemapPanel]
      .some((panel) => panel && !panel.hidden);
    map.getContainer().classList.toggle("has-map-control-panel", panelIsOpen);
  }
  function syncMapControlStacks() {
    Object.keys(state.maps).forEach((id) => syncMapControlStack(id));
  }
  function positionMobileControlPanel(id, panel) {
    if (!panel || panel.hidden || !window.matchMedia("(max-width: 620px)").matches) return;
    const controls = state.mapControls[id];
    if (!controls?.primaryControls) return;
    const anchorBounds = controls.primaryControls.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const maxLeft = Math.max(margin, window.innerWidth - panelBounds.width - margin);
    const leftOfControls = anchorBounds.left - panelBounds.width - gap;
    const rightOfControls = anchorBounds.right + gap;
    const preferredLeft = leftOfControls >= margin ? leftOfControls : rightOfControls;
    const left = Math.max(margin, Math.min(preferredLeft, maxLeft));
    const maxTop = Math.max(margin, window.innerHeight - panelBounds.height - margin);
    const top = Math.max(margin, Math.min(anchorBounds.top, maxTop));
    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
  }
  function scheduleMobileControlPanelPosition(id, panel) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => positionMobileControlPanel(id, panel)));
  }
  function positionExportPanel(id) {
    const controls = state.mapControls[id]; const map = state.maps[id];
    if (!controls?.exportPanel || controls.exportPanel.hidden || !map) return;
    const panel = controls.exportPanel; const container = map.getContainer(); const mapBounds = container.getBoundingClientRect();
    const mapStyle = getComputedStyle(container);
    MAP_PRESENTATION_PROPERTIES.forEach((property) => panel.style.setProperty(property, mapStyle.getPropertyValue(property)));
    panel.dataset.mapTheme = container.dataset.mapTheme || "light";
    const viewportMargin = 8; const canvasHeight = Math.max(0, mapBounds.height - viewportMargin * 2);
    panel.style.maxHeight = Math.max(160, Math.min(window.innerHeight - viewportMargin * 2, canvasHeight)) + "px";
    const panelBounds = panel.getBoundingClientRect(); const anchorBounds = controls.resizeButton?.getBoundingClientRect() || mapBounds;
    const canvasLeft = Math.max(viewportMargin, mapBounds.left + viewportMargin);
    const canvasRight = Math.min(window.innerWidth - viewportMargin, mapBounds.right - viewportMargin);
    const leftOfButton = anchorBounds.left - panelBounds.width - viewportMargin;
    const rightOfButton = anchorBounds.right + viewportMargin;
    const preferredLeft = rightOfButton + panelBounds.width <= canvasRight ? rightOfButton : leftOfButton;
    const maximumLeft = Math.max(canvasLeft, canvasRight - panelBounds.width);
    const canvasTop = Math.max(viewportMargin, mapBounds.top + viewportMargin);
    const canvasBottom = Math.min(window.innerHeight - viewportMargin, mapBounds.bottom - viewportMargin);
    const maximumTop = Math.max(canvasTop, canvasBottom - panelBounds.height);
    panel.style.left = Math.max(canvasLeft, Math.min(preferredLeft, maximumLeft)) + "px";
    panel.style.top = Math.max(canvasTop, Math.min(anchorBounds.top, maximumTop)) + "px";
  }
  function scheduleExportPanelPosition(id) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => positionExportPanel(id)));
  }
  function closeMapPanels() {
    closeMobileMapMenus();
    closeThemePanels();
    closeBasemapPanels();
    closeExportPanels();
    Object.values(state.pagasa).forEach((pagasa) => {
      if (!pagasa.panel || !pagasa.toggle) return;
      pagasa.panel.hidden = true;
      pagasa.toggle.setAttribute("aria-expanded", "false");
    });
  }
  function addMapControls(map, id) {
    const control = L.control({ position: "topleft" });
    control.onAdd = () => {
      const rail = L.DomUtil.create("div", "map-studio-control-rail");
      const mobileMenuButton = createMapButton(rail, "map-studio-action-button map-studio-mobile-menu-button", "", "Open map controls", (event) => {
        event.stopPropagation();
        const open = !primary.classList.contains("is-mobile-menu-open");
        closeMobileMapMenus(id);
        setMobileMapMenu(id, open);
      }, MAP_ICONS.menu);
      mobileMenuButton.setAttribute("aria-expanded", "false");
      const primary = L.DomUtil.create("div", "map-studio-primary-controls", rail);
      primary.id = id + "-mobile-map-menu";
      primary.dataset.mobileMapMenu = "true";
      primary.setAttribute("aria-label", "Map controls");
      mobileMenuButton.setAttribute("aria-controls", primary.id);
      const fullscreenButton = createMapButton(primary, "map-studio-action-button", "", "Expand map to browser window", () => toggleFullscreen(id), MAP_ICONS.expand);
      const resetButton = createMapButton(primary, "map-studio-action-button", "", "Reset map extent", () => {
        fitNationalExtent(id, true);
      }, MAP_ICONS.reset);
      const zoom = L.DomUtil.create("div", "map-studio-zoom-controls", primary);
      zoom.setAttribute("role", "group"); zoom.setAttribute("aria-label", "Map zoom controls");
      createMapButton(zoom, "map-studio-zoom-button", "", "Zoom in", () => map.zoomIn(), MAP_ICONS.plus);
      createMapButton(zoom, "map-studio-zoom-button", "", "Zoom out", () => map.zoomOut(), MAP_ICONS.minus);
      const themeControl = L.DomUtil.create("div", "map-studio-theme-control", primary);
      const themeButton = createMapButton(themeControl, "map-studio-action-button", "", "Customize map appearance", () => {
        const pagasa = state.pagasa["standing-map"]; if (pagasa) { pagasa.panel.hidden = true; pagasa.toggle.setAttribute("aria-expanded", "false"); }
        closeBasemapPanels(); closeThemePanels(id); themePanel.hidden = !themePanel.hidden;
        syncMapControlStack(id);
        if (!themePanel.hidden) scheduleMobileControlPanelPosition(id, themePanel);
      }, MAP_ICONS.appearance);
      themeButton.setAttribute("aria-controls", id + "-theme-panel"); themeButton.setAttribute("aria-expanded", "false");
      const themePanel = L.DomUtil.create("div", "map-studio-theme-panel", themeControl);
      themePanel.id = id + "-theme-panel"; themePanel.hidden = true; themePanel.setAttribute("role", "dialog"); themePanel.setAttribute("aria-label", "Map background theme");
      themePanel.dataset.mapControlPopover = "theme";
      const themeTitle = L.DomUtil.create("strong", "map-studio-theme-title", themePanel); themeTitle.textContent = "Background";
      const themeOptionGroup = L.DomUtil.create("div", "map-studio-theme-options", themePanel);
      const themeOptions = Object.entries(MAP_THEMES).map(([key, value]) => {
        const option = createMapButton(themeOptionGroup, "map-studio-theme-option", "", "Use " + value.label.toLowerCase() + " map background", () => { applyMapTheme(id, key); });
        option.dataset.mapThemeOption = key; option.style.setProperty("--theme-color", value.color); option.style.setProperty("--theme-border", value.cartographyColor); option.setAttribute("aria-pressed", "false"); return option;
      });
      const paletteTitle = L.DomUtil.create("strong", "map-studio-theme-title map-studio-theme-title--palette", themePanel); paletteTitle.textContent = "Color palette";
      const paletteOptions = Object.entries(MAP_PALETTES).map(([key, value]) => {
        const option = createMapButton(themePanel, "map-studio-palette-option", "", "Use " + value.label.toLowerCase() + " map palette", () => { applyMapPalette(id, key, { userInitiated: true }); });
        const preview = document.createElement("span"); preview.className = "map-studio-palette-preview"; preview.setAttribute("aria-hidden", "true");
        value.colors.forEach((color) => { const swatch = document.createElement("span"); swatch.style.backgroundColor = color; preview.appendChild(swatch); });
        option.replaceChildren(preview); option.dataset.mapPaletteOption = key; option.setAttribute("aria-pressed", "false"); return option;
      });
      bindMapOptionKeyboardNavigation(themeOptions);
      bindMapOptionKeyboardNavigation(paletteOptions);
      themeButton.addEventListener("click", () => themeButton.setAttribute("aria-expanded", themePanel.hidden ? "false" : "true"));
      const basemapControl = L.DomUtil.create("div", "map-studio-basemap-control", primary);
      const basemapButton = createMapButton(basemapControl, "map-studio-action-button", "", "Choose a basemap and map layers", () => {
        closeThemePanels(); closeBasemapPanels(id); basemapPanel.hidden = !basemapPanel.hidden;
        syncMapControlStack(id);
        if (!basemapPanel.hidden) scheduleMobileControlPanelPosition(id, basemapPanel);
      }, MAP_ICONS.layers);
      basemapButton.setAttribute("aria-controls", id + "-basemap-panel"); basemapButton.setAttribute("aria-expanded", "false");
      const basemapPanel = L.DomUtil.create("div", "map-studio-basemap-panel", basemapControl);
      basemapPanel.id = id + "-basemap-panel"; basemapPanel.hidden = true; basemapPanel.setAttribute("role", "dialog"); basemapPanel.setAttribute("aria-label", "Map basemaps");
      basemapPanel.dataset.mapControlPopover = "basemap";
      const basemapTitle = L.DomUtil.create("strong", "map-studio-basemap-title", basemapPanel); basemapTitle.textContent = "Basemap";
      const basemapOptions = L.DomUtil.create("div", "map-studio-basemap-options", basemapPanel);
      const basemapButtons = Object.entries(MAP_BASEMAPS).map(([key, value]) => {
        const option = createMapButton(basemapOptions, "map-studio-basemap-option", "", "Use " + value.label + " basemap", () => { addBasemap(id, key); basemapPanel.hidden = true; basemapButton.setAttribute("aria-expanded", "false"); syncMapControlStack(id); });
        option.dataset.mapBasemapOption = key;
        const label = L.DomUtil.create("span", "map-studio-basemap-option__label", option); label.textContent = value.label;
        option.setAttribute("aria-pressed", "false"); return option;
      });
      bindMapOptionKeyboardNavigation(basemapButtons);
      basemapButton.addEventListener("click", () => basemapButton.setAttribute("aria-expanded", basemapPanel.hidden ? "false" : "true"));
      if (id === "standing-map") {
        basemapButton.setAttribute("aria-label", "Choose a basemap and PAGASA layers");
      }
      const legendPositionSection = L.DomUtil.create("div", "map-studio-basemap-section", basemapPanel);
      const legendPositionTitle = L.DomUtil.create("strong", "map-studio-basemap-section__title", legendPositionSection); legendPositionTitle.textContent = "Legend position";
      const legendPositionOptions = L.DomUtil.create("div", "map-studio-basemap-position-options", legendPositionSection);
      const legendPositionButtons = [["bottomleft", "Bottom left"], ["topleft", "Upper left"]].map(([position, label]) => {
        const option = createMapButton(legendPositionOptions, "map-studio-basemap-position-option", label, "Place map legend " + label.toLowerCase(), () => applyMapLegendPosition(id, position));
        option.dataset.mapLegendPosition = position; option.setAttribute("aria-pressed", "false"); return option;
      });
      bindMapOptionKeyboardNavigation(legendPositionButtons);
      let affectedAreasToggle = null;
      let affectedBoundaryLabelsToggle = null;
      if (id === "general-map") {
        const affectedAreasSection = L.DomUtil.create("div", "map-studio-basemap-section", basemapPanel);
        affectedAreasToggle = createMapButton(affectedAreasSection, "map-studio-basemap-toggle-option", "", "Show affected areas", () => toggleAffectedAreas(id));
        affectedAreasToggle.setAttribute("aria-controls", "general-map-affected-areas");
        const affectedAreasLabel = L.DomUtil.create("span", "map-studio-basemap-toggle-option__label", affectedAreasToggle);
        affectedAreasLabel.textContent = "Affected Areas";
        const affectedAreasState = L.DomUtil.create("span", "map-studio-basemap-toggle-option__state", affectedAreasToggle);
        affectedAreasState.textContent = "No data";
        const affectedBoundaryLabelsSection = L.DomUtil.create("div", "map-studio-basemap-section", basemapPanel);
        affectedBoundaryLabelsToggle = createMapButton(affectedBoundaryLabelsSection, "map-studio-basemap-toggle-option", "", "Show boundary labels", () => toggleAffectedBoundaryLabels(id));
        const affectedBoundaryLabelsLabel = L.DomUtil.create("span", "map-studio-basemap-toggle-option__label", affectedBoundaryLabelsToggle);
        affectedBoundaryLabelsLabel.textContent = "Boundary Labels";
        const affectedBoundaryLabelsState = L.DomUtil.create("span", "map-studio-basemap-toggle-option__state", affectedBoundaryLabelsToggle);
        affectedBoundaryLabelsState.textContent = "No data";
      }
      const copyButton = createMapButton(primary, "map-studio-action-button", "", "Copy visible map as image", () => copyMapImage(id), MAP_ICONS.copy);
      const resizeControl = L.DomUtil.create("div", "map-studio-export-control", primary);
      const resizeButton = createMapButton(resizeControl, "map-studio-action-button", "", "Resize map canvas", () => {
        const pagasa = state.pagasa["standing-map"]; if (pagasa) { pagasa.panel.hidden = true; pagasa.toggle.setAttribute("aria-expanded", "false"); }
        closeThemePanels(); closeBasemapPanels(); closeExportPanels(id); exportPanel.hidden = !exportPanel.hidden;
        resizeButton.setAttribute("aria-expanded", exportPanel.hidden ? "false" : "true");
        if (!exportPanel.hidden) scheduleExportPanelPosition(id);
      }, MAP_ICONS.resize);
      resizeButton.setAttribute("aria-controls", id + "-export-panel"); resizeButton.setAttribute("aria-expanded", "false");
      const exportPanel = L.DomUtil.create("div", "map-studio-export-panel", resizeControl);
      exportPanel.id = id + "-export-panel"; exportPanel.hidden = true; exportPanel.setAttribute("role", "dialog"); exportPanel.setAttribute("aria-label", "Resize map canvas");
      exportPanel.dataset.mapControlPopover = "export";
      const exportTitle = L.DomUtil.create("strong", "map-studio-export-title", exportPanel); exportTitle.textContent = "Resize canvas";
      const exportActions = L.DomUtil.create("div", "map-studio-export-actions map-studio-export-actions--top", exportPanel);
      const fitWorkspaceButton = createMapButton(exportActions, "map-studio-export-action", "Reset canvas", "Return the map canvas to the available workspace size", () => clearMapCanvasPreset(id));
      const exportOptions = L.DomUtil.create("div", "map-studio-export-options", exportPanel);
      const exportOptionButtons = MAP_EXPORT_OPTIONS.map((key) => {
        const preset = MAP_EXPORT_PRESETS[key];
        const option = createMapButton(exportOptions, "map-studio-export-option", "", "Resize canvas to " + preset.label, () => selectExportPreset(id, key));
        const label = L.DomUtil.create("span", "map-studio-export-option__label", option); label.textContent = preset.label;
        const detail = L.DomUtil.create("small", "map-studio-export-option__detail", option); detail.textContent = preset.detail;
        option.dataset.exportPreset = key; option.setAttribute("aria-pressed", "false");
        return option;
      });
      bindMapOptionKeyboardNavigation(exportOptionButtons);
      const exportButton = createMapButton(primary, "map-studio-action-button", "", "Export map as PNG", async () => {
        closeMapPanels();
        await downloadMapImage(id, state.mapControls[id].exportPreset);
      }, MAP_ICONS.download);
      const mobileClearButton = createMapButton(primary, "map-studio-action-button map-studio-mobile-only map-studio-mobile-clear", "", "Clear uploaded data", () => clearMode(mapKind(id)), MAP_ICONS.clear);
      const mobileCopyButton = createMapButton(primary, "map-studio-action-button map-studio-mobile-only map-studio-mobile-copy", "", "Copy visible map as image", () => copyMapImage(id), MAP_ICONS.copy);
      const mobileExportButton = createMapButton(primary, "map-studio-action-button map-studio-mobile-only map-studio-mobile-export", "", "Export map as PNG", () => exportButton.click(), MAP_ICONS.download);
      primary.addEventListener("click", (event) => {
        const clicked = event.target.closest("button");
        if (!clicked || clicked === mobileMenuButton || clicked.hasAttribute("aria-controls")) return;
        window.setTimeout(() => setMobileMapMenu(id, false), 0);
      });
      state.mapControls[id] = { control, primaryControls: primary, controlsHidden: false, mobileMenuButton, mobileClearButton, mobileCopyButton, mobileExportButton, fullscreenButton, resetButton, themeButton, themePanel, themeOptions, paletteOptions, basemapButton, basemapPanel, basemapOptions: basemapButtons, legendPositionOptions: legendPositionButtons, affectedAreasToggle, affectedBoundaryLabelsToggle, copyButton, resizeButton, resizeControl, exportButton, exportPanel, exportOptions: exportOptionButtons, exportPreset: MAP_EXPORT_OPTIONS[0], fitWorkspaceButton };
      applyMapLegendPosition(id, state.mapLegendPositions[id], { persist: false });
      syncAffectedAreasToggle(id);
      syncAffectedBoundaryLabelsToggle(id);
      document.body.appendChild(exportPanel);
      L.DomEvent.disableClickPropagation(exportPanel); L.DomEvent.on(exportPanel, "dblclick", L.DomEvent.stopPropagation);
      L.DomEvent.disableClickPropagation(rail); L.DomEvent.on(rail, "dblclick", L.DomEvent.stopPropagation);
      return rail;
    };
    control.addTo(map);
    const clearControl = L.control({ position: "topright" });
    clearControl.onAdd = () => {
      const rightRail = L.DomUtil.create("div", "map-studio-right-control-rail");
      const controls = state.mapControls[id];
      const primary = controls.primaryControls;
      const settingsHost = L.DomUtil.create("div", "map-studio-settings-control", rightRail);
      const clearHost = L.DomUtil.create("div", "map-studio-clear-control", rightRail);
      createMapButton(clearHost, "map-studio-action-button", "", "Clear uploaded data", () => clearMode(mapKind(id)), MAP_ICONS.clear);
      const rightActions = L.DomUtil.create("div", "map-studio-right-map-actions", rightRail);
      rightActions.id = id + "-right-map-actions";
      rightActions.append(controls.copyButton, controls.resizeControl, controls.exportButton);
      controls.rightActionControls = rightActions;
    const settingsButton = createMapButton(settingsHost, "map-studio-action-button", "", "Hide map actions", () => {
      controls.controlsHidden = !controls.controlsHidden;
      if (controls.controlsHidden) closeMapPanels();
      syncMapControlsVisibility(id);
    }, MAP_ICONS.hideControls);
      settingsButton.setAttribute("aria-controls", primary.id + " " + rightActions.id);
    settingsButton.setAttribute("aria-expanded", "true");
    settingsButton.setAttribute("aria-pressed", "true");
    controls.rightSettingsButton = settingsButton;
    controls.clearControl = clearHost;
    syncMapControlsVisibility(id);

      // Keep map navigation and layer controls on the left. Settings, Clear,
      // and the image actions share the right-side rail without obscuring the map.
      L.DomEvent.disableClickPropagation(rightRail);
      L.DomEvent.on(rightRail, "dblclick", L.DomEvent.stopPropagation);
      return rightRail;
    };
    clearControl.addTo(map);
    return control;
  }
  const MAP_EXPORT_PRESETS = {
    clipboard: { targetLongEdge: 3072, maximumScale: 8 },
    provincePortrait: { label: "Canva Size", detail: "1,150 × 1,600 px · 23:32", width: 1150, height: 1600, fileName: "canva-size" },
    provinceLandscape: { label: "Landscape", detail: "2,400 × 1,800 px · 4:3", width: 2400, height: 1800, fileName: "landscape" },
    provinceWide: { label: "Wide", detail: "2,560 × 1,440 px · 16:9", width: 2560, height: 1440, fileName: "wide" },
    square: { label: "Square", detail: "1,800 × 1,800 px · 1:1", width: 1800, height: 1800, fileName: "square" },
  };
  const MAP_EXPORT_OPTIONS = ["provincePortrait", "provinceLandscape", "provinceWide", "square"];
  function exportImageSize(bounds, presetName) {
    const preset = MAP_EXPORT_PRESETS[presetName] || MAP_EXPORT_PRESETS.provincePortrait;
    if (preset.width && preset.height) {
      const scale = Math.min(preset.width / bounds.width, preset.height / bounds.height);
      return { width: preset.width, height: preset.height, scale, offsetX: (preset.width - bounds.width * scale) / 2, offsetY: (preset.height - bounds.height * scale) / 2 };
    }
    const longEdge = Math.max(bounds.width, bounds.height);
    const scale = Math.min(Math.max(preset.targetLongEdge / longEdge, 1), preset.maximumScale, 8192 / longEdge, Math.sqrt(40000000 / (bounds.width * bounds.height)));
    return { width: Math.max(1, Math.floor(bounds.width * scale)), height: Math.max(1, Math.floor(bounds.height * scale)), scale, offsetX: 0, offsetY: 0 };
  }
  function waitForMapPaint() {
    return new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.setTimeout(resolve, 80))));
  }
  function mapCanvasPresetSize(id, presetName) {
    const preset = MAP_EXPORT_PRESETS[presetName]; const container = state.maps[id]?.getContainer?.(); const panel = container?.closest(".visual-panel");
    if (!preset?.width || !preset?.height || !panel) return null;
    const panelStyle = getComputedStyle(panel);
    const availableWidth = Math.max(1, panel.clientWidth - (parseFloat(panelStyle.paddingLeft) || 0) - (parseFloat(panelStyle.paddingRight) || 0));
    const availableHeight = Math.max(1, panel.clientHeight - (parseFloat(panelStyle.paddingTop) || 0) - (parseFloat(panelStyle.paddingBottom) || 0));
    const ratio = preset.width / preset.height;
    const width = Math.min(availableWidth, availableHeight * ratio);
    return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(width / ratio)) };
  }
  function applyMapCanvasPreset(id, presetName) {
    const size = mapCanvasPresetSize(id, presetName); const map = state.maps[id]; const container = map?.getContainer?.();
    if (!size || !container) return;
    state.mapCanvasPresets[id] = presetName;
    if (container.classList.contains("is-browser-fullscreen")) return;
    const sizeChanged = container.style.getPropertyValue("--map-preview-width") !== size.width + "px" || container.style.getPropertyValue("--map-preview-height") !== size.height + "px";
    if (sizeChanged) state.mapResizePreserveView[id] = false;
    container.style.setProperty("--map-preview-width", size.width + "px");
    container.style.setProperty("--map-preview-height", size.height + "px");
    container.classList.add("is-size-preview");
    container.dataset.mapSizePreset = presetName;
    scheduleMapResize(id, sizeChanged);
    if (!state.mapControls[id]?.exportPanel.hidden) scheduleExportPanelPosition(id);
  }
  function clearMapCanvasPreset(id) {
    const map = state.maps[id]; const container = map?.getContainer?.();
    if (!container) return;
    delete state.mapCanvasPresets[id];
    state.mapResizePreserveView[id] = false;
    container.classList.remove("is-size-preview");
    container.removeAttribute("data-map-size-preset");
    container.style.removeProperty("--map-preview-width"); container.style.removeProperty("--map-preview-height");
    state.mapControls[id]?.exportOptions?.forEach((option) => option.setAttribute("aria-pressed", "false"));
    scheduleMapResize(id, true);
    if (!state.mapControls[id]?.exportPanel.hidden) scheduleExportPanelPosition(id);
  }
  function selectExportPreset(id, presetName) {
    const controls = state.mapControls[id]; if (!controls || !MAP_EXPORT_PRESETS[presetName]) return;
    controls.exportPreset = presetName;
    controls.exportOptions.forEach((option) => option.setAttribute("aria-pressed", option.dataset.exportPreset === presetName ? "true" : "false"));
    applyMapCanvasPreset(id, presetName);
    if (window.matchMedia("(max-width: 620px)").matches) {
      controls.exportPanel.hidden = true;
      controls.resizeButton?.setAttribute("aria-expanded", "false");
      setMobileMapMenu(id, false);
    }
  }
  const MAP_PRESENTATION_PROPERTIES = ["--map-accent-color", "--map-control-color", "--map-ui-surface", "--map-glass-hover", "--map-ui-surface-hover", "--map-popup-surface", "--map-popup-surface-opaque", "--map-ui-text", "--map-ui-muted", "--map-ui-border", "--map-ui-focus", "--map-ui-control-bg", "--map-ui-control-bg-hover", "--map-ui-control-border", "--map-ui-control-icon", "--map-ui-control-focus", "--map-ui-control-active-bg", "--map-ui-control-active-text", "--map-ui-shadow", "--map-grid-color", "--map-cartography-color", "--map-cartography-secondary-color", "--map-boundary-label-buffer-width", "--map-boundary-label-buffer", "--map-boundary-label-font-size"];
  function copyMapPresentation(source, target) {
    const style = getComputedStyle(source);
    target.dataset.mapTheme = source.dataset.mapTheme || "light";
    target.style.backgroundColor = style.backgroundColor;
    MAP_PRESENTATION_PROPERTIES.forEach((property) => target.style.setProperty(property, style.getPropertyValue(property)));
  }
  function ensureExportPane(sourceMap, targetMap, paneName) {
    if (!paneName || targetMap.getPane(paneName)) return;
    const pane = targetMap.createPane(paneName); const sourcePane = sourceMap.getPane(paneName);
    if (!sourcePane) return;
    const sourceStyle = getComputedStyle(sourcePane);
    pane.style.zIndex = sourceStyle.zIndex; pane.style.pointerEvents = "none"; pane.style.mixBlendMode = sourceStyle.mixBlendMode;
  }
  function exportLayerOptions(sourceMap, targetMap, sourceLayer) {
    const options = { ...(sourceLayer.options || {}), interactive: false };
    delete options.renderer;
    ensureExportPane(sourceMap, targetMap, options.pane);
    return options;
  }
  function cloneLayerForExport(sourceMap, targetMap, sourceLayer) {
    const options = exportLayerOptions(sourceMap, targetMap, sourceLayer);
    if (sourceLayer instanceof L.TileLayer) return L.tileLayer(sourceLayer._url, { ...options, crossOrigin: true });
    if (sourceLayer instanceof L.Circle) return L.circle(sourceLayer.getLatLng(), { ...options, radius: sourceLayer.getRadius() });
    if (sourceLayer instanceof L.CircleMarker) return L.circleMarker(sourceLayer.getLatLng(), options);
    if (sourceLayer instanceof L.Marker) return L.marker(sourceLayer.getLatLng(), options);
    // GeoJSON layers already contain their complete feature collection. Rebuild
    // them once for the export map instead of recursively cloning every
    // polygon as a separate Leaflet layer; large municipal uploads otherwise
    // make the offscreen export appear to hang before the PNG is encoded.
    if (sourceLayer instanceof L.GeoJSON) {
      const geoJsonOptions = { ...options };
      delete geoJsonOptions.filter;
      delete geoJsonOptions.onEachFeature;
      delete geoJsonOptions.pointToLayer;
      return L.geoJSON(sourceLayer.toGeoJSON(), geoJsonOptions);
    }
    if (sourceLayer instanceof L.Polyline) return L.geoJSON(sourceLayer.toGeoJSON(), { pane: options.pane, interactive: false, style: () => options });
    if (sourceLayer instanceof L.LayerGroup) {
      const group = L.layerGroup();
      sourceLayer.eachLayer((child) => { const clone = cloneLayerForExport(sourceMap, targetMap, child); if (clone) group.addLayer(clone); });
      return group;
    }
    if (sourceLayer instanceof L.ImageOverlay) return L.imageOverlay(sourceLayer.getElement()?.currentSrc || sourceLayer.getElement()?.src || "", sourceLayer.getBounds(), options);
    return null;
  }
  function sourceMapRootLayers(id) {
    const sourceMap = state.maps[id]; const allLayers = []; const nestedLayers = new Set();
    sourceMap.eachLayer((layer) => allLayers.push(layer));
    const collectNested = (layer) => {
      if (!(layer instanceof L.LayerGroup)) return;
      layer.eachLayer((child) => { nestedLayers.add(child); collectNested(child); });
    };
    allLayers.forEach(collectNested);
    const coordinateLines = state.coordinateGrids[id]?.lines;
    return allLayers.filter((layer) => !nestedLayers.has(layer) && layer !== coordinateLines);
  }
  function cloneVisibleMapLayers(id, targetMap) {
    const sourceMap = state.maps[id];
    sourceMapRootLayers(id).forEach((sourceLayer) => { const clone = cloneLayerForExport(sourceMap, targetMap, sourceLayer); if (clone) clone.addTo(targetMap); });
  }
  function cloneVisibleLegend(id, targetMap) {
    const sourceLegend = state.maps[id].getContainer().querySelector(".map-studio-legend");
    if (!sourceLegend || !visibleElement(sourceLegend)) return;
    const clone = sourceLegend.cloneNode(true); clone.removeAttribute("id"); clone.classList.add("map-studio-legend--export-expanded");
    const position = normalizeLegendPosition(state.mapLegendPositions[id]);
    const host = document.createElement("div");
    host.className = "map-studio-legend-host";
    host.dataset.mapLegendPosition = position;
    host.appendChild(clone);
    targetMap.getContainer().appendChild(host);
  }
  function cloneVisibleAffectedAreas(id, targetMap) {
    const sourceList = state.maps[id].getContainer().querySelector(".map-studio-affected-areas-host");
    if (!sourceList || !visibleElement(sourceList)) return;
    const clone = sourceList.cloneNode(true);
    clone.removeAttribute("id");
    targetMap.getContainer().appendChild(clone);
  }
  function waitForExportTiles(container) {
    const pending = [...container.querySelectorAll("img.leaflet-tile")].filter((tile) => !tile.complete);
    if (!pending.length) return Promise.resolve();
    const settled = Promise.all(pending.map((tile) => new Promise((resolve) => {
      tile.addEventListener("load", resolve, { once: true }); tile.addEventListener("error", resolve, { once: true });
    })));
    return Promise.race([settled, new Promise((resolve) => window.setTimeout(resolve, 3000))]);
  }
  function disposeExportMap(exportId, map, host) {
    state.overviews[exportId]?.map?.remove();
    map.remove(); host.remove();
    ["maps", "mapThemes", "mapPalettes", "mapLegendPositions", "coordinateGrids", "cartography", "overviews", "baseBounds"].forEach((key) => { delete state[key][exportId]; });
  }
  async function createOffscreenExportMap(id, presetName) {
    const preset = MAP_EXPORT_PRESETS[presetName] || MAP_EXPORT_PRESETS.provincePortrait;
    if (!preset.width || !preset.height) throw new Error("The selected export size is unavailable.");
    const sourceMap = state.maps[id]; const sourceContainer = sourceMap.getContainer();
    const host = document.createElement("div"); host.className = "map-export-render-host"; host.setAttribute("aria-hidden", "true");
    const container = document.createElement("div"); container.className = "map-canvas is-export-render"; container.style.width = preset.width + "px"; container.style.height = preset.height + "px"; container.style.minHeight = "0";
    const sourceBounds = sourceContainer.getBoundingClientRect();
    const exportScale = sourceBounds.width > 0 && sourceBounds.height > 0 ? Math.min(preset.width / sourceBounds.width, preset.height / sourceBounds.height) : 1;
    container.style.setProperty("--map-export-ui-scale", String(exportScale));
    host.appendChild(container); document.body.appendChild(host);
    copyMapPresentation(sourceContainer, container);
    const exportId = id + "-export-" + Date.now();
    let map = null;
    try {
      map = L.map(container, { attributionControl: false, preferCanvas: true, scrollWheelZoom: false, touchZoom: false, zoomControl: false, trackResize: false, zoomDelta: 1, zoomSnap: 0 }).setView(sourceMap.getCenter(), sourceMap.getZoom(), { animate: false });
      state.maps[exportId] = map; state.mapThemes[exportId] = state.mapThemes[id]; state.mapPalettes[exportId] = state.mapPalettes[id]; state.mapLegendPositions[exportId] = state.mapLegendPositions[id];
      if (id === "hazards-map") renderHazardsMapTitle(exportId);
      addCoordinateGrid(map, exportId); addMapCartography(map, exportId); cloneVisibleMapLayers(id, map);
      map.fitBounds(sourceMap.getBounds(), { animate: false, padding: [0, 0] }); safeInvalidateMapSize(map);
      state.coordinateGrids[exportId]?.refresh(); cloneVisibleLegend(id, map); cloneVisibleAffectedAreas(id, map);
      const sourceOverview = state.overviews[id];
      if (sourceOverview?.wrap.classList.contains("is-visible") && state.baseLayers[id]) {
        state.baseBounds[exportId] = state.baseBounds[id];
        createOverviewMap(exportId, state.baseLayers[id].regionsGeo, state.baseLayers[id].outlineGeo, state.baseBounds[id]);
        if (state.overviews[exportId]) { state.overviews[exportId].nationalZoom = map.getZoom() - 1; updateOverview(exportId); }
      }
      await waitForExportTiles(container); await waitForMapPaint();
      return { container, exportId, host, map };
    } catch (error) {
      if (map) disposeExportMap(exportId, map, host); else host.remove();
      throw error;
    }
  }
  async function renderExportMapImage(id, presetName) {
    const exportMap = await createOffscreenExportMap(id, presetName);
    try { return await renderMapImage(exportMap.exportId, presetName); }
    finally { disposeExportMap(exportMap.exportId, exportMap.map, exportMap.host); }
  }
  function relativeBounds(element, mapBounds) {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left - mapBounds.left, y: bounds.top - mapBounds.top, width: bounds.width, height: bounds.height };
  }
  function visibleElement(element) {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && !element.hidden && bounds.width > 0 && bounds.height > 0;
  }
  function renderedElementScale(element, mapBounds, bounds) {
    const box = bounds || relativeBounds(element, mapBounds); const scales = [];
    if (element.offsetWidth > 0) scales.push(box.width / element.offsetWidth);
    if (element.offsetHeight > 0) scales.push(box.height / element.offsetHeight);
    return scales.find((value) => Number.isFinite(value) && value > 0) || mapBounds.layoutScale || 1;
  }
  function drawElementText(context, element, mapBounds, options) {
    if (!visibleElement(element)) return;
    const text = String(element.textContent || "").trim();
    if (!text) return;
    const bounds = relativeBounds(element, mapBounds); const style = getComputedStyle(element);
    context.save();
    context.globalAlpha *= (Number.parseFloat(style.opacity) || 1) * (options?.opacity ?? 1);
    context.fillStyle = style.color || "#27272a";
    const layoutScale = renderedElementScale(element, mapBounds, bounds); const fontSize = Number.parseFloat(style.fontSize) || 10; const renderedFontSize = fontSize * layoutScale;
    context.font = (style.fontWeight || "400") + " " + renderedFontSize + "px " + (style.fontFamily || "sans-serif");
    const textStrokeWidth = (Number.parseFloat(style.webkitTextStrokeWidth) || 0) * layoutScale;
    const textStrokeColor = style.webkitTextStrokeColor || "transparent";
    const paintText = (value, xPosition, yPosition) => {
      if (textStrokeWidth > 0 && textStrokeColor !== "transparent") { context.save(); context.lineJoin = "round"; context.lineWidth = textStrokeWidth * 2; context.strokeStyle = textStrokeColor; context.strokeText(value, xPosition, yPosition); context.restore(); }
      context.fillText(value, xPosition, yPosition);
    };
    const textAlign = options?.align || (style.textAlign === "right" || style.textAlign === "end" ? "right" : style.textAlign === "left" || style.textAlign === "start" ? "left" : "center");
    context.textAlign = textAlign;
    const x = (textAlign === "left" ? bounds.x : textAlign === "right" ? bounds.x + bounds.width : bounds.x + bounds.width / 2) + (options?.xOffset || 0);
    if (style.writingMode?.startsWith("vertical")) { const y = bounds.y + bounds.height / 2; context.textBaseline = "middle"; context.translate(x, y); context.rotate(Math.PI / 2); paintText(text, 0, 0); }
    else if (options?.centerBaseline) { context.textBaseline = "middle"; paintText(text, x, bounds.y + bounds.height / 2 + renderedFontSize * (options?.baselineOffset || 0)); }
    else { context.textBaseline = "top"; paintText(text, x, bounds.y + Math.max((bounds.height - renderedFontSize) / 2, 0)); }
    context.restore();
  }
  function drawCanvasElement(context, element, mapBounds) {
    if (!visibleElement(element)) return false;
    const bounds = relativeBounds(element, mapBounds); const style = getComputedStyle(element);
    context.save(); context.globalAlpha *= Number.parseFloat(style.opacity) || 1;
    context.drawImage(element, 0, 0, element.width, element.height, bounds.x, bounds.y, bounds.width, bounds.height);
    context.restore(); return true;
  }
  function drawTileImages(context, container, mapBounds) {
    container.querySelectorAll(".leaflet-tile-pane img.leaflet-tile").forEach((image) => {
      if (!visibleElement(image) || !image.complete || !image.naturalWidth) return;
      const bounds = relativeBounds(image, mapBounds); const style = getComputedStyle(image);
      context.save(); context.globalAlpha *= Number.parseFloat(style.opacity) || 1;
      try { context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height); } catch (_) { /* A failed tile does not block vector export. */ }
      context.restore();
    });
  }
  function paneZIndex(element) {
    const pane = element.closest(".leaflet-pane");
    return Number.parseInt(getComputedStyle(pane || element).zIndex, 10) || 0;
  }
  async function drawSvgElement(context, svg, mapBounds, opacity) {
    if (!visibleElement(svg)) return false;
    const clone = svg.cloneNode(true); clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bounds = relativeBounds(svg, mapBounds); const layoutScale = renderedElementScale(svg, mapBounds, bounds); clone.setAttribute("width", bounds.width / layoutScale); clone.setAttribute("height", bounds.height / layoutScale);
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = reject; value.src = url; });
      context.save(); context.globalAlpha *= opacity ?? 1; context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height); context.restore(); return true;
    } finally { URL.revokeObjectURL(url); }
  }
  function drawLegendSnapshot(context, container, mapBounds) {
    const legend = container.querySelector(".map-studio-legend");
    if (!legend || !visibleElement(legend)) return;
    const bounds = relativeBounds(legend, mapBounds); const style = getComputedStyle(legend);
    context.save(); context.fillStyle = style.backgroundColor || "rgba(255,255,255,.84)";
    const radius = (Number.parseFloat(style.borderRadius) || 0) * renderedElementScale(legend, mapBounds, bounds);
    if (typeof context.roundRect === "function") { context.beginPath(); context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius); context.fill(); }
    else context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.restore();
    legend.querySelectorAll(".map-studio-legend__title,.map-studio-legend__unit,.map-studio-legend__reference-label,.map-studio-legend__bound:not([hidden]),.map-studio-legend__separator").forEach((element) => drawElementText(context, element, mapBounds, { align: element.classList.contains("map-studio-legend__title") || element.classList.contains("map-studio-legend__unit") || element.classList.contains("map-studio-legend__reference-label") ? "left" : undefined }));
    legend.querySelectorAll(".map-studio-legend__swatch").forEach((swatch) => {
      if (!visibleElement(swatch)) return;
      const box = relativeBounds(swatch, mapBounds); const style = getComputedStyle(swatch); const centerX = box.x + box.width / 2; const centerY = box.y + box.height / 2;
      context.save(); context.fillStyle = swatch.dataset.hazardColor || style.backgroundColor;
      if (swatch.classList.contains("hazards-legend__swatch--volcano")) {
        context.beginPath(); context.moveTo(centerX, box.y); context.lineTo(box.x + box.width, box.y + box.height); context.lineTo(box.x, box.y + box.height); context.closePath(); context.fill();
      } else if (swatch.classList.contains("hazards-legend__swatch--earthquake")) {
        const radius = Math.min(box.width, box.height) / 2; context.beginPath(); context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.fill(); context.fillStyle = "#27272a"; context.beginPath(); context.arc(centerX, centerY, Math.max(1.5, radius * .25), 0, Math.PI * 2); context.fill();
      } else context.fillRect(box.x, box.y, box.width, box.height);
      context.restore();
    });
    legend.querySelectorAll(".pagasa-overlay-legend__title,.pagasa-overlay-legend__label").forEach((element) => drawElementText(context, element, mapBounds, { align: "left" }));
    legend.querySelectorAll(".pagasa-overlay-legend__swatch").forEach((swatch) => {
      if (!visibleElement(swatch)) return;
      const box = relativeBounds(swatch, mapBounds); const kind = swatch.dataset.mapOverlayKind || "line"; const color = swatch.dataset.mapOverlayColor || "#52525b";
      context.save();
      if (kind === "category") {
        const radius = Math.min(box.width, box.height) / 2; const centerX = box.x + box.width / 2; const centerY = box.y + box.height / 2;
        context.fillStyle = color; context.strokeStyle = "rgba(255,255,255,.92)"; context.lineWidth = renderedElementScale(swatch, mapBounds, box); context.beginPath(); context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.fill(); context.stroke();
        context.fillStyle = "#ffffff"; context.font = swatch.dataset.mapOverlayIcon === "hurricane" ? '900 8px "Font Awesome 6 Free"' : "700 12px Inter, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(swatch.dataset.mapOverlayIcon === "hurricane" ? "\uf751" : (swatch.dataset.mapOverlayCode || ""), centerX, centerY);
      } else if (kind === "area") {
        context.globalAlpha = .72; context.fillStyle = color; context.fillRect(box.x, box.y, box.width, box.height);
      } else {
        const layoutScale = renderedElementScale(swatch, mapBounds, box); context.strokeStyle = color; context.lineWidth = 2 * layoutScale; if (kind === "dashed") context.setLineDash([4 * layoutScale, 3 * layoutScale]); context.beginPath(); context.moveTo(box.x, box.y + box.height / 2); context.lineTo(box.x + box.width, box.y + box.height / 2); context.stroke();
      }
      context.restore();
    });
  }
  function drawAffectedAreasSnapshot(context, container, mapBounds) {
    const panel = container.querySelector(".map-studio-affected-areas");
    if (!panel || !visibleElement(panel)) return;
    const bounds = relativeBounds(panel, mapBounds); const style = getComputedStyle(panel);
    context.save(); context.fillStyle = style.backgroundColor || "rgba(255,255,255,.84)";
    const radius = (Number.parseFloat(style.borderRadius) || 0) * renderedElementScale(panel, mapBounds, bounds);
    if (typeof context.roundRect === "function") { context.beginPath(); context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius); context.fill(); }
    else context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.restore();
    drawElementText(context, panel.querySelector(".map-studio-affected-areas__title"), mapBounds, { align: "left" });
    panel.querySelectorAll(".map-studio-affected-areas__list li").forEach((item) => {
      if (!visibleElement(item)) return;
      const itemBounds = relativeBounds(item, mapBounds); const itemStyle = getComputedStyle(item);
      const layoutScale = renderedElementScale(item, mapBounds, itemBounds);
      const fontSize = Number.parseFloat(itemStyle.fontSize) || 10; const renderedFontSize = fontSize * layoutScale;
      const bulletX = itemBounds.x + Math.max(renderedFontSize * .28, 2); const bulletY = itemBounds.y + itemBounds.height / 2;
      context.save(); context.fillStyle = itemStyle.color || style.color || "#27272a"; context.beginPath(); context.arc(bulletX, bulletY, Math.max(1, renderedFontSize * .16), 0, Math.PI * 2); context.fill(); context.restore();
      drawElementText(context, item, mapBounds, { align: "left", xOffset: renderedFontSize * .82 });
    });
  }
  async function drawCartographySnapshot(context, container, mapBounds) {
    container.querySelectorAll(".map-studio-coordinate-label").forEach((label) => drawElementText(context, label, mapBounds));
    const cartography = container.querySelector(".map-studio-cartography");
    const opacity = Number.parseFloat(getComputedStyle(cartography || container).opacity) || 1;
    const northArrow = container.querySelector(".map-studio-north-arrow");
    if (northArrow) { const label = northArrow.querySelector("span"); if (label) drawElementText(context, label, mapBounds, { opacity }); const svg = northArrow.querySelector("svg"); if (svg) await drawSvgElement(context, svg, mapBounds, opacity); }
    const scaleLine = container.querySelector(".map-studio-scale .leaflet-control-scale-line");
    if (scaleLine && visibleElement(scaleLine)) {
      const bounds = relativeBounds(scaleLine, mapBounds); const layoutScale = renderedElementScale(scaleLine, mapBounds, bounds); const scaleStyle = getComputedStyle(scaleLine); const color = scaleStyle.color; const secondaryColor = scaleStyle.getPropertyValue("--map-cartography-secondary-color").trim() || "#ffffff";
      context.save(); context.globalAlpha *= opacity * .72; context.fillStyle = color; context.fillRect(bounds.x, bounds.y, bounds.width / 2, 4 * layoutScale); context.fillStyle = secondaryColor; context.fillRect(bounds.x + bounds.width / 2, bounds.y, bounds.width / 2, 4 * layoutScale); context.strokeStyle = color; context.lineWidth = layoutScale; context.strokeRect(bounds.x + .5 * layoutScale, bounds.y + .5 * layoutScale, bounds.width - layoutScale, 3 * layoutScale); context.restore();
      scaleLine.querySelectorAll(".map-studio-scale-label").forEach((label) => drawElementText(context, label, mapBounds, { opacity }));
    }
    const crs = container.querySelector(".map-studio-crs-label"); if (crs) drawElementText(context, crs, mapBounds, { opacity, centerBaseline: true, baselineOffset: .05 });
  }
  function drawHazardsMarkers(context, container, mapBounds) {
    container.querySelectorAll(".hazards-volcano-marker").forEach((marker) => {
      if (!visibleElement(marker)) return;
      const bounds = relativeBounds(marker, mapBounds); const style = getComputedStyle(marker);
      const centerX = bounds.x + bounds.width / 2; const bottomY = bounds.y + bounds.height;
      context.save(); context.fillStyle = style.backgroundColor || "#72d84c"; context.beginPath(); context.moveTo(centerX, bounds.y); context.lineTo(bounds.x + bounds.width, bottomY); context.lineTo(bounds.x, bottomY); context.closePath(); context.fill(); context.restore();
    });
  }
  function drawAffectedBoundaryLabels(context, container, mapBounds) {
    container.querySelectorAll(".map-studio-boundary-label__text").forEach((label) => {
      if (!visibleElement(label)) return;
      const bounds = relativeBounds(label, mapBounds); const style = getComputedStyle(label); const scale = renderedElementScale(label, mapBounds, bounds);
      const borderWidth = Math.max(Number.parseFloat(style.borderTopWidth) || 0, Number.parseFloat(style.borderRightWidth) || 0, Number.parseFloat(style.borderBottomWidth) || 0, Number.parseFloat(style.borderLeftWidth) || 0) * scale;
      const background = style.backgroundColor || "transparent";
      const hasBackground = background !== "transparent" && !/rgba\([^)]*,\s*0\s*\)$/.test(background);
      if (hasBackground || borderWidth > 0) {
        context.save(); context.fillStyle = background; context.strokeStyle = style.borderColor || "transparent"; context.lineWidth = borderWidth;
        const radius = (Number.parseFloat(style.borderRadius) || 0) * scale;
        if (typeof context.roundRect === "function") { context.beginPath(); context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius); if (hasBackground) context.fill(); if (borderWidth > 0) context.stroke(); }
        else { if (hasBackground) context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height); if (borderWidth > 0) context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height); }
        context.restore();
      }
      drawElementText(context, label, mapBounds, { align: "center" });
    });
  }
  function drawHazardsTitleSnapshot(context, container, mapBounds) {
    const title = container.querySelector(".hazards-map-title");
    if (!title || !visibleElement(title)) return;
    const bounds = relativeBounds(title, mapBounds); const style = getComputedStyle(title); const scale = renderedElementScale(title, mapBounds, bounds);
    const borderWidth = Math.max(Number.parseFloat(style.borderTopWidth) || 0, Number.parseFloat(style.borderRightWidth) || 0, Number.parseFloat(style.borderBottomWidth) || 0, Number.parseFloat(style.borderLeftWidth) || 0) * scale;
    const background = style.backgroundColor || "transparent";
    const hasBackground = background !== "transparent" && !/rgba\([^)]*,\s*0\s*\)$/.test(background);
    if (hasBackground || borderWidth > 0) {
      context.save(); context.fillStyle = background; context.strokeStyle = style.borderColor; context.lineWidth = borderWidth;
      const radius = (Number.parseFloat(style.borderRadius) || 0) * scale;
      if (typeof context.roundRect === "function") { context.beginPath(); context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius); if (hasBackground) context.fill(); if (borderWidth > 0) context.stroke(); }
      else { if (hasBackground) context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height); if (borderWidth > 0) context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height); }
      context.restore();
    }
    title.querySelectorAll(".hazards-map-title__item,.hazards-map-title__subtitle").forEach((item) => drawElementText(context, item, mapBounds));
  }
  async function drawOverviewSnapshot(context, id, mapBounds) {
    const overview = state.overviews[id];
    if (!overview || !overview.wrap.classList.contains("is-visible")) return;
    const bounds = relativeBounds(overview.wrap, mapBounds);
    context.save(); context.fillStyle = getComputedStyle(overview.node).backgroundColor; context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height); context.restore();
    const svgs = [...overview.node.querySelectorAll(".leaflet-pane svg")].sort((left, right) => paneZIndex(left) - paneZIndex(right));
    for (const svg of svgs) await drawSvgElement(context, svg, mapBounds);
  }
  async function renderMapImage(id, presetName) {
    const map = state.maps[id]; const container = map.getContainer(); const browserBounds = container.getBoundingClientRect();
    if (!browserBounds.width || !browserBounds.height) throw new Error("The map is not currently visible.");
    if (document.fonts?.ready) await document.fonts.ready;
    const captureSize = exportImageSize(browserBounds, presetName); const visibleBounds = container.getBoundingClientRect(); const mapBounds = { left: visibleBounds.left, top: visibleBounds.top, width: visibleBounds.width, height: visibleBounds.height, layoutScale: visibleBounds.width / (container.offsetWidth || visibleBounds.width) };
    const canvas = document.createElement("canvas"); canvas.width = captureSize.width; canvas.height = captureSize.height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("The browser could not create the map image.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    context.fillStyle = getComputedStyle(container).backgroundColor || "#f7f7f7"; context.fillRect(0, 0, captureSize.width, captureSize.height);
    context.setTransform(captureSize.scale, 0, 0, captureSize.scale, captureSize.offsetX, captureSize.offsetY);
    context.fillRect(0, 0, mapBounds.width, mapBounds.height);
    const legend = container.querySelector(".map-studio-legend");
    const wasExportExpanded = legend?.classList.contains("map-studio-legend--export-expanded");
    legend?.classList.add("map-studio-legend--export-expanded");
    try {
      drawTileImages(context, container, mapBounds);
      [...container.querySelectorAll(".leaflet-pane canvas")].filter((element) => !element.closest(".map-studio-overview-wrap")).sort((left, right) => paneZIndex(left) - paneZIndex(right)).forEach((element) => drawCanvasElement(context, element, mapBounds));
      const svgs = [...container.querySelectorAll(".leaflet-pane svg")].filter((element) => !element.closest(".map-studio-overview-wrap")).sort((left, right) => paneZIndex(left) - paneZIndex(right));
      for (const svg of svgs) await drawSvgElement(context, svg, mapBounds);
      drawHazardsMarkers(context, container, mapBounds); drawAffectedBoundaryLabels(context, container, mapBounds); drawHazardsTitleSnapshot(context, container, mapBounds); drawLegendSnapshot(context, container, mapBounds); drawAffectedAreasSnapshot(context, container, mapBounds); await drawOverviewSnapshot(context, id, mapBounds); await drawCartographySnapshot(context, container, mapBounds);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The browser could not encode the map PNG. If an online basemap is selected, switch to Default and try again.")), "image/png"));
      return { blob, width: captureSize.width, height: captureSize.height };
    } finally {
      if (legend && !wasExportExpanded) legend.classList.remove("map-studio-legend--export-expanded");
    }
  }
  async function copyMapImage(id) {
    const controls = state.mapControls[id]; const kind = mapKind(id); controls.copyButton.disabled = true;
    try { const image = await renderMapImage(id, "clipboard"); if (!navigator.clipboard || !window.ClipboardItem) throw new Error("Clipboard image access is unavailable."); await navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]); mapStatus(id, kind, "High-quality map copied (" + image.width + " × " + image.height + " px)."); }
    catch (error) { mapStatus(id, kind, error.message || "Map image could not be copied.", "error"); }
    finally { controls.copyButton.disabled = false; }
  }
  async function downloadMapImage(id, presetName) {
    const controls = state.mapControls[id]; const kind = mapKind(id); const preset = MAP_EXPORT_PRESETS[presetName] || MAP_EXPORT_PRESETS.provincePortrait; controls.exportButton.disabled = true; controls.resizeButton.disabled = true; controls.exportOptions.forEach((option) => { option.disabled = true; });
    try { const image = await renderExportMapImage(id, presetName); const link = document.createElement("a"); link.href = URL.createObjectURL(image.blob); link.download = kind + "-" + (preset.fileName || "map") + ".png"; link.style.display = "none"; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000); mapStatus(id, kind, "Map exported as " + preset.label + " (" + image.width + " × " + image.height + " px)."); }
    catch (error) { mapStatus(id, kind, error.message || "Map image could not be downloaded.", "error"); }
    finally { controls.exportButton.disabled = false; controls.resizeButton.disabled = false; controls.exportOptions.forEach((option) => { option.disabled = false; }); }
  }
  function buildMap(id) {
    const container = document.getElementById(id);
    const initialInlineSize = container ? { width: container.style.width, height: container.style.height } : null;
    if (container) {
      const rect = container.getBoundingClientRect();
      // Preserve the computed flex size while Leaflet initializes. This is
      // especially important when a workspace has just been revealed and
      // the browser has not committed the flex/grid measurement yet.
      if (rect.width > 0 && rect.height > 0) {
        container.style.width = rect.width + "px";
        container.style.height = rect.height + "px";
      }
    }
    const map = L.map(id, { attributionControl: false, preferCanvas: true, scrollWheelZoom: true, touchZoom: true, zoomControl: false, trackResize: false, zoomDelta: 1, zoomSnap: .25, wheelPxPerZoomLevel: 100 }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    map.on("zoom", () => syncAffectedBoundaryLabelsZoom(id));
    map.on("zoomend", () => { syncAffectedBoundaryLabelsZoom(id); refreshAffectedBoundaryLabels(id); });
    map.on("popupclose", (event) => {
      const source = event.popup?._source;
      const selected = state.selectedLayers[id];
      if (!source || source === selected) clearBoundarySelection(id);
    });
    map.on("click", (event) => {
      const target = event.originalEvent?.target;
      if (target?.closest?.(".leaflet-interactive")) return;
      clearBoundarySelection(id);
      map.closePopup();
    });
    if (container && initialInlineSize) {
      container.style.width = initialInlineSize.width;
      container.style.height = initialInlineSize.height;
    }
    const preferences = loadMapPreferences(id);
    const initialPalette = id === "standing-map" && !preferences.paletteCustomized ? STANDING_DEFAULT_PALETTES.corn : preferences.palette;
    state.maps[id] = map; state.mapThemes[id] = preferences.theme; state.mapPalettes[id] = initialPalette; state.mapLegendPositions[id] = preferences.legendPosition; syncAffectedBoundaryLabelsZoom(id);
    if (id === "standing-map") state.standingPaletteCustomized = preferences.paletteCustomized;
    addCoordinateGrid(map, id); addMapCartography(map, id); addMapControls(map, id); addBasemap(id, preferences.basemap); applyMapTheme(id, preferences.theme); applyMapPalette(id, initialPalette); addBaseLayer(id); setMapEmptyState(id, true);
    if (id === "standing-map") addPagasaControl(map, id);
    observeMapCanvas(id);
  }
  function parsePagasaTrack(rawText) {
    const lines = String(rawText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    // PAGASA uses LOCAL{INTERNATIONAL} for systems with both names,
    // LOCAL{} for local-only names, and {INTERNATIONAL} for international-only
    // names. The feed may also publish {} while the active system is unnamed.
    // Keep the braces flexible enough for names containing spaces, then
    // classify the result so callers can distinguish both names from one.
    const header = lines[0]?.match(/^([^{}]*)\{([^{}]*)\}$/) || lines[0]?.match(/^([^{}]+)$/);
    if (!header) throw new Error("PAGASA cyclone data has no valid storm header.");
    const normalizeName = (value) => String(value || "").trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
    const localName = normalizeName(header[1]);
    const internationalName = normalizeName(header[2]);
    const namePresence = localName && internationalName ? "both" : localName ? "local-only" : internationalName ? "international-only" : "unnamed";
    const nameLabel = namePresence === "both" ? "Local and international names" : namePresence === "local-only" ? "Local name only" : namePresence === "international-only" ? "International name only" : "Name not supplied";
    const points = lines.slice(1).map((line, index) => {
      const parts = line.split(",").map((part) => part.trim());
      if (parts.length < 6) return null;
      const validAt = new Date(parts[1] + "T" + parts[2] + ":00+08:00");
      const latitude = Number(parts[3]); const longitude = Number(parts[4]); const radiusKm = Math.max(0, Number(parts[5]) || 0);
      if (!Number.isFinite(validAt.getTime()) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("Invalid PAGASA cyclone row " + (index + 2) + ".");
      return { intensityCode: String(parts[0] || "").toUpperCase(), validAt, latitude, longitude, radiusKm };
    }).filter(Boolean).sort((left, right) => left.validAt - right.validAt);
    const currentIndex = points.reduce((latest, point, index) => point.radiusKm === 0 ? index : latest, -1);
    if (!points.length || currentIndex < 0) throw new Error("PAGASA supplied no analyzed cyclone position.");
    points.forEach((point, index) => { point.isPast = index < currentIndex; point.isCurrent = index === currentIndex; point.isForecast = index > currentIndex; point.timeLabel = point.validAt.toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + " PHT"; });
    const stormName = (namePresence === "both" ? localName + " (" + internationalName + ")" : localName || internationalName || "Active PAGASA system");
    return { stormName, localName, internationalName, namePresence, nameLabel, sourceLabel: "DOST-PAGASA operational tropical-cyclone track", currentPoint: points[currentIndex], points };
  }
  function pagasaCategory(point) {
    const intensityCode = String(point?.intensityCode || "LPA").toUpperCase();
    return PAGASA_CATEGORY_LEGEND.find((category) => category.colorKey === intensityCode) || PAGASA_CATEGORY_LEGEND.find((category) => category.colorKey === "LPA");
  }
  function pagasaDomainTheme(id) {
    const key = state.mapThemes[id] || "light";
    if (MAP_THEMES[key].tone === "dark") return { par: "#f87171", tcad: "#fb923c", tcid: "#fde047" };
    if (key === "medium") return { par: "#dc2626", tcad: "#ea580c", tcid: "#facc15" };
    return { par: "#b91c1c", tcad: "#c2410c", tcid: "#a16207" };
  }
  function pagasaTrackTheme(id) {
    const key = state.mapThemes[id] || "light";
    const background = MAP_THEMES[key];
    if (key === "medium") return { actual: "#27272a", forecast: "#27272a", cone: "#52525b", coneOpacity: .24 };
    const useBlue = key === "sky";
    const isDark = background.tone === "dark";
    return { actual: background.cartographyColor, forecast: background.cartographyColor, cone: useBlue || isDark ? "#ffffff" : "#71717a", coneOpacity: useBlue ? .24 : isDark ? .22 : .14 };
  }
  function refreshPagasaThemeStyles(id) {
    const pagasa = state.pagasa[id];
    if (!pagasa) return;
    const domains = pagasaDomainTheme(id);
    pagasa.staticLayers.par.setStyle({ color: domains.par, weight: .85, dashArray: "5, 4", opacity: .94 });
    pagasa.staticLayers.tcad.setStyle({ color: domains.tcad, weight: .7, opacity: .94 });
    pagasa.staticLayers.tcid.setStyle({ color: domains.tcid, weight: .65, opacity: .94 });
    const trackTheme = pagasaTrackTheme(id);
    pagasa.trackLayer?.eachLayer?.((layer) => {
      const role = layer.options?.mapStudioPagasaRole;
      if (role === "actual") layer.setStyle({ color: trackTheme.actual, opacity: .95 });
      if (role === "forecast") layer.setStyle({ color: trackTheme.forecast, opacity: .9 });
      if (role === "cone") layer.setStyle({ fillColor: trackTheme.cone, fillOpacity: pagasa.active.has("buffer") ? 0 : trackTheme.coneOpacity });
    });
    updatePagasaLegend(id);
  }
  function buildPagasaTrackLayer(track) {
    const group = L.layerGroup(); const currentIndex = track.points.findIndex((point) => point.isCurrent);
    const observed = track.points.slice(0, currentIndex + 1); const forecast = track.points.slice(currentIndex);
    const trackTheme = pagasaTrackTheme("standing-map");
    if (observed.length >= 2) group.addLayer(L.polyline(observed.map((point) => [point.latitude, point.longitude]), { color: trackTheme.actual, weight: 1.25, opacity: .95, pane: "tcTrackPane", mapStudioPagasaRole: "actual" }));
    if (forecast.length >= 2) group.addLayer(L.polyline(forecast.map((point) => [point.latitude, point.longitude]), { color: trackTheme.forecast, weight: 1.25, dashArray: "4, 3", opacity: .9, pane: "tcTrackPane", mapStudioPagasaRole: "forecast" }));
    const cone = forecastConeCoordinates(track.points);
    if (cone.length >= 3) group.addLayer(L.polygon(cone, { stroke: false, fill: true, fillColor: trackTheme.cone, fillOpacity: trackTheme.coneOpacity, fillRule: "evenodd", interactive: false, pane: "tcForecastConePane", mapStudioPagasaRole: "cone" }));
    track.points.forEach((point) => {
      const status = point.isPast ? "Past Position" : point.isCurrent ? "Active Position (T=0)" : "Forecast Position";
      const category = pagasaCategory(point);
      const marker = L.circleMarker([point.latitude, point.longitude], { radius: 2.25, color: "#ffffff", weight: 1, opacity: 1, fillColor: PAGASA_CATEGORY_COLORS[category.colorKey], fillOpacity: 1, pane: "tcTrackPane" });
      const names = track.namePresence === "both" ? track.localName + " / " + track.internationalName : track.localName || track.internationalName || "Not supplied";
      marker.bindPopup('<div class="pagasa-popup"><div class="pagasa-popup__heading"><strong>TC ' + esc(track.stormName) + ' · ' + esc(category.label) + '</strong><span>' + esc(status) + '</span></div><p>' + esc(point.timeLabel) + '</p><dl><dt>Names</dt><dd>' + esc(names) + '</dd><dt>Detected as</dt><dd>' + esc(track.nameLabel || "Name not supplied") + '</dd><dt>Position</dt><dd>' + point.latitude.toFixed(2) + '°N, ' + point.longitude.toFixed(2) + '°E</dd><dt>Error radius</dt><dd>' + (point.radiusKm ? fmt(point.radiusKm) + ' km' : '—') + '</dd><dt>Source</dt><dd>' + esc(track.sourceLabel) + '</dd></dl></div>');
      group.addLayer(marker);
    });
    group.stormName = track.stormName; return group;
  }
  function offsetPoint(point, angle, radiusKm) {
    const latitudeRadians = point.latitude * Math.PI / 180;
    const latitude = point.latitude + (radiusKm / 111.32) * Math.cos(angle);
    const longitude = point.longitude + (radiusKm / (111.32 * Math.max(Math.cos(latitudeRadians), .1))) * Math.sin(angle);
    return [latitude, longitude];
  }
  function trackHeading(points, index) {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const latitudeScale = Math.cos(((before.latitude + after.latitude) / 2) * Math.PI / 180);
    return Math.atan2((after.longitude - before.longitude) * latitudeScale, after.latitude - before.latitude);
  }
  function segmentHeading(start, end) {
    const latitudeScale = Math.cos(start.latitude * Math.PI / 180);
    return Math.atan2((end.longitude - start.longitude) * latitudeScale, end.latitude - start.latitude);
  }
  function convexHull(points) {
    const sorted = [...points].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
    if (sorted.length < 3) return sorted;
    const cross = (origin, first, second) => (first[1] - origin[1]) * (second[0] - origin[0]) - (first[0] - origin[0]) * (second[1] - origin[1]);
    const build = (items) => {
      const hull = [];
      items.forEach((point) => { while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop(); hull.push(point); });
      return hull;
    };
    return build(sorted).slice(0, -1).concat(build([...sorted].reverse()).slice(0, -1));
  }
  function smoothPagasaHull(points) {
    if (points.length < 3) return points;
    const smoothed = [];
    const curvature = .08;
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      const deltaLatitude = next[0] - point[0];
      const deltaLongitude = next[1] - point[1];
      const edgeLength = Math.hypot(deltaLatitude, deltaLongitude);
      if (!edgeLength) return;
      const control = [
        (point[0] + next[0]) / 2 + (deltaLongitude / edgeLength) * edgeLength * curvature,
        (point[1] + next[1]) / 2 - (deltaLatitude / edgeLength) * edgeLength * curvature,
      ];
      const steps = Math.max(4, Math.min(16, Math.ceil(edgeLength * 8)));
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        const inverseT = 1 - t;
        smoothed.push([
          inverseT * inverseT * point[0] + 2 * inverseT * t * control[0] + t * t * next[0],
          inverseT * inverseT * point[1] + 2 * inverseT * t * control[1] + t * t * next[1],
        ]);
      }
    });
    return smoothed;
  }
  function forecastConeCoordinates(points) {
    const currentIndex = points.findIndex((point) => point.isCurrent);
    const forecast = currentIndex >= 0 ? points.slice(currentIndex) : [];
    if (forecast.length < 2) return [];
    const samples = [[forecast[0].latitude, forecast[0].longitude]];
    const conePoints = forecast.filter((point, index) => index === 0 || point.radiusKm > 0);
    conePoints.forEach((point, index) => {
      if (!point.radiusKm) return;
      const heading = trackHeading(conePoints, index);
      samples.push(offsetPoint(point, heading - Math.PI / 2, point.radiusKm), offsetPoint(point, heading + Math.PI / 2, point.radiusKm));
    });
    const last = conePoints[conePoints.length - 1];
    if (last.radiusKm) {
      const heading = trackHeading(conePoints, conePoints.length - 1);
      for (let step = 0; step <= 48; step += 1) samples.push(offsetPoint(last, heading - Math.PI / 2 + Math.PI * step / 48, last.radiusKm));
    }
    return smoothPagasaHull(convexHull(samples));
  }
  function pagasaBufferPathOptions(color, radiusKm) {
    return { stroke: false, color: "transparent", weight: 0, opacity: 0, fill: true, fillColor: color, fillOpacity: 1, fillRule: "evenodd", interactive: false, pane: "tcDistanceBufferPane", mapStudioPagasaRole: "buffer", mapStudioPagasaBufferRadiusKm: radiusKm };
  }
  function buildPagasaBufferLayers(points, radiusKm, color) {
    if (points.length < 2) return [];
    const layers = [];
    const pathOptions = pagasaBufferPathOptions(color, radiusKm);
    points.forEach((point) => layers.push(L.circle([point.latitude, point.longitude], { ...pathOptions, radius: radiusKm * 1000 })));
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const heading = segmentHeading(start, end);
      const startRight = offsetPoint(start, heading - Math.PI / 2, radiusKm);
      const endRight = offsetPoint(end, heading - Math.PI / 2, radiusKm);
      const endLeft = offsetPoint(end, heading + Math.PI / 2, radiusKm);
      const startLeft = offsetPoint(start, heading + Math.PI / 2, radiusKm);
      layers.push(L.polygon([startRight, endRight, endLeft, startLeft], { ...pathOptions, smoothFactor: .25 }));
    }
    return layers;
  }
  function buildPagasaBufferLayer(track) {
    const group = L.layerGroup();
    const bands = [[150, "#FFF3A3"], [100, "#FFCF96"], [50, "#FF8080"]];
    const currentIndex = track.points.findIndex((point) => point.isCurrent);
    const forecast = currentIndex >= 0 ? track.points.slice(currentIndex) : [];
    bands.forEach(([radiusKm, color]) => buildPagasaBufferLayers(forecast, radiusKm, color).forEach((layer) => group.addLayer(layer)));
    return group;
  }
  function setPagasaStatus(id, label, status, detail) {
    const pagasa = state.pagasa[id]; const map = state.maps[id]; if (!pagasa) return;
    pagasa.status.textContent = label; pagasa.status.dataset.status = status; pagasa.status.title = detail || "";
    if (map) {
      let mapStatus = map.getContainer().querySelector(".pagasa-data-status");
      if (!mapStatus) {
        mapStatus = document.createElement("div");
        mapStatus.className = "pagasa-data-status";
        mapStatus.setAttribute("role", "status");
        mapStatus.setAttribute("aria-live", "polite");
        map.getContainer().appendChild(mapStatus);
      }
      mapStatus.textContent = status === "error" ? label + " · Track hidden" : label;
      mapStatus.dataset.status = status;
      mapStatus.hidden = !label || status === "idle" || status === "fallback" || status === "live";
    }
  }
  function mountPagasaLegend(id) {
    const pagasa = state.pagasa[id];
    const map = state.maps[id];
    if (!pagasa || !map) return;
    const host = map.getContainer().querySelector(".map-studio-legend");
    if (!host) return;
    let legend = host.querySelector(".pagasa-overlay-legend");
    if (!legend) {
      const content = host.querySelector(".map-studio-legend__content") || host;
      legend = L.DomUtil.create("div", "pagasa-overlay-legend", content);
      content.prepend(legend);
      legend.dataset.mapOverlayLegend = "";
      const title = L.DomUtil.create("strong", "pagasa-overlay-legend__title", legend); title.textContent = "Legend";
      L.DomUtil.create("div", "pagasa-overlay-legend__list", legend);
    }
    pagasa.legend = legend;
    pagasa.legendList = legend.querySelector(".pagasa-overlay-legend__list");
  }
  function updatePagasaLegend(id) {
    const pagasa = state.pagasa[id]; if (!pagasa) return;
    mountPagasaLegend(id);
    if (!pagasa.legend || !pagasa.legendList) return;
    const map = state.maps[id];
    const domains = pagasaDomainTheme(id);
    const trackTheme = pagasaTrackTheme(id);
    const layerIsVisible = (layer) => Boolean(layer && map.hasLayer(layer));
    const items = [];
    if (layerIsVisible(pagasa.staticLayers.par)) items.push({ kind: "dashed", label: "PAR", color: domains.par });
    if (layerIsVisible(pagasa.staticLayers.tcad)) items.push({ kind: "line", label: "TCAD", color: domains.tcad });
    if (layerIsVisible(pagasa.staticLayers.tcid)) items.push({ kind: "line", label: "TCID", color: domains.tcid });
    if (pagasa.active.has("track") && pagasa.track && layerIsVisible(pagasa.trackLayer)) {
      PAGASA_CATEGORY_LEGEND.forEach((category) => items.push({ kind: "category", label: category.label, color: PAGASA_CATEGORY_COLORS[category.colorKey], code: category.code || "", icon: category.icon || "" }));
      const observedPointCount = pagasa.track.points.filter((point) => point.isPast || point.isCurrent).length;
      if (observedPointCount >= 2) items.push({ kind: "line", label: "Observed TC track", color: trackTheme.actual });
      items.push({ kind: "dashed", label: "Forecast TC track", color: trackTheme.actual });
      if (!pagasa.active.has("buffer")) items.push({ kind: "area", label: "Forecast cone", color: trackTheme.cone });
    }
    if (pagasa.active.has("buffer") && pagasa.track && layerIsVisible(pagasa.bufferLayer)) {
      items.push({ kind: "area", label: "50 km TC buffer", color: "#FF8080" }, { kind: "area", label: "100 km TC buffer", color: "#FFCF96" }, { kind: "area", label: "150 km TC buffer", color: "#FFF3A3" });
    }
    pagasa.legendList.replaceChildren();
    items.forEach((item) => {
      const row = L.DomUtil.create("div", "pagasa-overlay-legend__row", pagasa.legendList);
      const swatch = L.DomUtil.create("span", "pagasa-overlay-legend__swatch pagasa-overlay-legend__swatch--" + item.kind, row);
      swatch.dataset.mapOverlayKind = item.kind; swatch.dataset.mapOverlayColor = item.color; swatch.style.setProperty("--map-overlay-color", item.color); swatch.setAttribute("aria-hidden", "true");
      if (item.kind === "category") {
        swatch.dataset.mapOverlayCode = item.code; swatch.dataset.mapOverlayIcon = item.icon;
        const code = L.DomUtil.create("span", "pagasa-overlay-legend__category-code", swatch);
        if (item.icon === "hurricane") L.DomUtil.create("i", "fa-solid fa-hurricane", code);
        else code.textContent = item.code;
      }
      const label = L.DomUtil.create("span", "pagasa-overlay-legend__label", row); label.textContent = item.label;
    });
    pagasa.legend.hidden = !items.length;
    const mapLegend = pagasa.legend.closest(".map-studio-legend");
    const baseLegendHasData = Boolean(mapLegend?.querySelector(".map-studio-legend__list")?.children.length);
    if (mapLegend) mapLegend.dataset.mapLegendState = baseLegendHasData || items.length ? "populated" : "empty";
    const baseLabel = mapLegend?.querySelector(".map-studio-legend__title")?.textContent || "Map";
    mapLegend?.setAttribute("aria-label", items.length ? baseLabel + " legend. Map layers: " + items.map((item) => item.label).join(", ") : baseLabel + " legend");
  }
  function renderPagasaTrack(id, track, shouldFit) {
    const pagasa = state.pagasa[id]; const map = state.maps[id];
    [pagasa.trackLayer, pagasa.bufferLayer].forEach((layer) => { if (layer && map.hasLayer(layer)) map.removeLayer(layer); });
    pagasa.track = track; pagasa.trackLayer = buildPagasaTrackLayer(track); pagasa.bufferLayer = buildPagasaBufferLayer(track);
    if (pagasa.active.has("track")) pagasa.trackLayer.addTo(map);
    if (pagasa.active.has("buffer")) pagasa.bufferLayer.addTo(map);
    setPagasaStatus(id, "Live PAGASA", "live", "Analysis: " + track.currentPoint.timeLabel);
    refreshPagasaThemeStyles(id);
    if (shouldFit && pagasa.trackLayer.getLayers().length) { const bounds = L.featureGroup(pagasa.trackLayer.getLayers()).getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 7 }); }
    updatePagasaLegend(id);
  }
  async function refreshPagasaTrack(id, shouldFit) {
    const pagasa = state.pagasa[id]; if (!pagasa || pagasa.fetching || (!pagasa.active.has("track") && !pagasa.active.has("buffer"))) return;
    const finishLoading = beginMapLoading(id, "Loading PAGASA layers…");
    pagasa.fetching = true; setPagasaStatus(id, "Loading…", "loading");
    try {
      const sources = [...new Set([PAGASA_TRACK_URL, PAGASA_DIRECT_TRACK_URL].filter(Boolean))];
      let lastError = null;
      let rawTrack = null;
      for (const source of sources) {
        try {
          const response = await fetchWithTimeout(source + "?_=" + Date.now(), { cache: "no-store", headers: { Accept: "text/plain,*/*;q=0.8" } }, PAGASA_REQUEST_TIMEOUT_MS);
          if (!response.ok) throw new Error("PAGASA track request failed.");
          rawTrack = await response.text();
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (rawTrack === null) throw lastError || new Error("PAGASA track source is unavailable.");
      const track = parsePagasaTrack(rawTrack);
      renderPagasaTrack(id, track, shouldFit);
    } catch (error) {
      setPagasaStatus(id, "Live PAGASA unavailable", "error", error?.message || "PAGASA track source is unavailable.");
      if (!pagasa.track) {
        pagasa.trackLayer = null;
        updatePagasaLegend(id);
      }
    } finally { pagasa.fetching = false; finishLoading(); }
  }
  function togglePagasaLayer(id, layerId, button) {
    const pagasa = state.pagasa[id]; const map = state.maps[id]; const isActive = !pagasa.active.has(layerId);
    if (isActive) pagasa.active.add(layerId); else pagasa.active.delete(layerId);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    if (["par", "tcad", "tcid"].includes(layerId)) { const layer = pagasa.staticLayers[layerId]; if (isActive) layer.addTo(map); else if (map.hasLayer(layer)) map.removeLayer(layer); }
    syncPagasaMinimumZoom(id);
    if (layerId === "track" && !isActive && pagasa.trackLayer && map.hasLayer(pagasa.trackLayer)) map.removeLayer(pagasa.trackLayer);
    if (layerId === "buffer" && !isActive && pagasa.bufferLayer && map.hasLayer(pagasa.bufferLayer)) map.removeLayer(pagasa.bufferLayer);
    if (isActive && (layerId === "track" || layerId === "buffer")) { if (pagasa.track) renderPagasaTrack(id, pagasa.track, true); else refreshPagasaTrack(id, true); }
    if (!pagasa.active.has("track") && !pagasa.active.has("buffer")) setPagasaStatus(id, "Track off", "idle");
    pagasa.toggle.setAttribute("aria-pressed", pagasa.active.size ? "true" : "false"); updatePagasaLegend(id);
    refreshPagasaThemeStyles(id);
    try { localStorage.setItem("mapStudio.pagasaLayers.v4", JSON.stringify([...pagasa.active])); } catch (_) { /* Optional preference. */ }
  }
  function addPagasaControl(map, id) {
    // Keep distance buffers above the basemap tiles but below the white
    // Philippine landmass/boundary panes, matching the Standing Crops map.
    [["tcDistanceBufferPane",220],["tcidPane",600],["tcadPane",605],["parPane",610],["tcForecastConePane",615],["tcTrackPane",620]].forEach(([paneName,zIndex]) => { if (!map.getPane(paneName)) { const pane = map.createPane(paneName); pane.style.zIndex = String(zIndex); if (["tcDistanceBufferPane","tcForecastConePane"].includes(paneName)) pane.style.pointerEvents = "none"; } });
    const staticLayers = {
      par: L.polygon([[5,115],[15,115],[21,120],[25,120],[25,135],[5,135]], { color: "#b91c1c", weight: .85, dashArray: "5, 4", opacity: .94, fill: false, pane: "parPane" }),
      tcad: L.polygon([[4,114],[27,114],[27,145],[4,145]], { color: "#c2410c", weight: .7, opacity: .94, fill: false, pane: "tcadPane" }),
      tcid: L.rectangle(PAGASA_TCID_BOUNDS, { color: "#a16207", weight: .65, opacity: .94, fill: false, pane: "tcidPane" }),
    };
    const mapControls = state.mapControls[id];
    const panel = mapControls.basemapPanel;
    const toggle = mapControls.basemapButton;
    const pagasaSection = L.DomUtil.create("section", "pagasa-basemap-section", panel);
    pagasaSection.setAttribute("aria-label", "PAGASA layers");
    const heading = L.DomUtil.create("div", "pagasa-layer-panel__heading", pagasaSection); const title = L.DomUtil.create("strong", "", heading); title.textContent = "PAGASA Layers"; const status = L.DomUtil.create("span", "pagasa-layer-status", heading); status.textContent = "Track off"; status.dataset.status = "idle"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const options = L.DomUtil.create("div", "pagasa-layer-options", pagasaSection);
      const labels = [["par","PAR"],["tcad","TCAD"],["tcid","TCID"],["track","TC track"],["buffer","TC buffer"]];
      labels.forEach(([key, label]) => { const button = createMapButton(options, "pagasa-layer-option", label, "Toggle " + label, () => togglePagasaLayer(id, key, button)); button.dataset.pagasaLayer = key; button.setAttribute("aria-pressed", "false"); });
    bindMapOptionKeyboardNavigation(options.querySelectorAll(".pagasa-layer-option"));
    state.pagasa[id] = { active: new Set(), staticLayers, control: null, toggle, panel, status, fetching: false, track: null, trackLayer: null, bufferLayer: null, timer: null, legend: null, legendList: null };
    refreshPagasaThemeStyles(id);
    L.DomEvent.disableClickPropagation(pagasaSection);
    mountPagasaLegend(id);
    try {
      const savedValue = localStorage.getItem("mapStudio.pagasaLayers.v4");
      const savedLayers = savedValue === null ? ["track", "buffer"] : JSON.parse(savedValue);
      savedLayers.filter((key) => ["par", "tcad", "tcid", "track", "buffer"].includes(key)).forEach((key) => { const button = state.pagasa[id].panel.querySelector('[data-pagasa-layer="' + key + '"]'); if (button) togglePagasaLayer(id, key, button); });
    } catch (_) {
      ["track", "buffer"].forEach((key) => {
        const button = state.pagasa[id].panel.querySelector('[data-pagasa-layer="' + key + '"]');
        if (button) togglePagasaLayer(id, key, button);
      });
    }
    state.pagasa[id].timer = window.setInterval(() => { if (!document.hidden) refreshPagasaTrack(id, false); }, PAGASA_REFRESH_MS);
  }
  const LEGEND_CLASS_COUNT = 5;
  function normalizeLegendClassCount(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : LEGEND_CLASS_COUNT;
  }
  function positiveSortedValues(values) {
    return Array.from(values || []).map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  }
  function legendQuantile(sortedValues, percentile) {
    if (!sortedValues.length) return 0;
    const position = (sortedValues.length - 1) * percentile;
    const lowerIndex = Math.floor(position); const upperIndex = Math.ceil(position); const weight = position - lowerIndex;
    return sortedValues[lowerIndex] + ((sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight);
  }
  function nearestPrettyStep(rawStep) {
    if (!Number.isFinite(rawStep) || rawStep <= 0) return 0;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep)); const normalized = rawStep / magnitude;
    return [1, 2, 5, 10].reduce((best, candidate) => Math.abs(candidate - normalized) < Math.abs(best - normalized) ? candidate : best, 1) * magnitude;
  }
  function roundUpToStep(value, step) { return Math.ceil((value / step) - 1e-9) * step; }
  function roundDownToStep(value, step) { return Math.floor((value / step) + 1e-9) * step; }
  function createPrettySegmentBreaks(start, end, classCount, preserveEnd) {
    const normalizedClassCount = normalizeLegendClassCount(classCount); const span = end - start; const step = nearestPrettyStep(span / normalizedClassCount);
    if (step <= 0) return [];
    const breaks = [start];
    for (let index = 1; index < normalizedClassCount; index += 1) {
      const target = start + (span * index / normalizedClassCount);
      let candidate = Math.round((target / step) + 1e-9) * step;
      if (candidate <= breaks[breaks.length - 1]) candidate = breaks[breaks.length - 1] + step;
      if (candidate >= end) return [];
      breaks.push(candidate);
    }
    const upperBreak = preserveEnd ? end : roundUpToStep(end, step);
    if (upperBreak <= breaks[breaks.length - 1]) return [];
    breaks.push(upperBreak);
    return breaks;
  }
  function createMedianAnchoredPrettyBreaks(median, maximum, lowerClassCount, classCount) {
    const normalizedClassCount = normalizeLegendClassCount(classCount);
    if (lowerClassCount === 2) {
      const upperClassCount = normalizedClassCount - lowerClassCount; const upperStep = nearestPrettyStep((maximum - median) / upperClassCount); const splitBreak = roundDownToStep(median, upperStep);
      if (splitBreak <= 0 || splitBreak >= maximum) return [];
      const lowerBreaks = createPrettySegmentBreaks(0, splitBreak, lowerClassCount, true); const upperBreaks = createPrettySegmentBreaks(splitBreak, maximum, upperClassCount);
      return lowerBreaks.length && upperBreaks.length ? lowerBreaks.concat(upperBreaks.slice(1)) : [];
    }
    const lowerBreaks = createPrettySegmentBreaks(0, median, lowerClassCount);
    if (!lowerBreaks.length) return [];
    const splitBreak = lowerBreaks[lowerBreaks.length - 1]; const upperClassCount = normalizedClassCount - lowerClassCount;
    if (splitBreak >= maximum) return [];
    const upperBreaks = createPrettySegmentBreaks(splitBreak, maximum, upperClassCount);
    return upperBreaks.length ? lowerBreaks.concat(upperBreaks.slice(1)) : [];
  }
  function createLegendBreaks(values, classCount) {
    const normalizedClassCount = normalizeLegendClassCount(classCount); const positiveValues = positiveSortedValues(values); const maximum = positiveValues.length ? positiveValues[positiveValues.length - 1] : 0;
    if (maximum <= 0) return { breaks: [], classificationMode: "empty", maximum: 0 };
    const standardBreaks = createPrettySegmentBreaks(0, maximum, normalizedClassCount); let breaks = standardBreaks; let classificationMode = "pretty";
    if (new Set(positiveValues).size >= normalizedClassCount) {
      const firstQuartile = legendQuantile(positiveValues, .25); const median = legendQuantile(positiveValues, .5); const thirdQuartile = legendQuantile(positiveValues, .75);
      const lowerSpread = median - firstQuartile; const upperSpread = thirdQuartile - median; const lowerTailSpread = median - positiveValues[0]; const upperTailSpread = maximum - median;
      const rightSkewed = (upperSpread > 0 && (lowerSpread === 0 || upperSpread / lowerSpread >= 2)) || (upperTailSpread > 0 && (lowerTailSpread === 0 || upperTailSpread / lowerTailSpread >= 4));
      const leftSkewed = !rightSkewed && ((lowerSpread > 0 && (upperSpread === 0 || lowerSpread / upperSpread >= 2)) || (lowerTailSpread > 0 && (upperTailSpread === 0 || lowerTailSpread / upperTailSpread >= 4)));
      const lowerClassCount = rightSkewed ? 3 : leftSkewed ? 2 : 0;
      if (lowerClassCount) {
        const skewedBreaks = createMedianAnchoredPrettyBreaks(median, maximum, lowerClassCount, normalizedClassCount);
        if (skewedBreaks.length === normalizedClassCount + 1) { breaks = skewedBreaks; classificationMode = rightSkewed ? "pretty-right-skew" : "pretty-left-skew"; }
      }
    }
    return { breaks, classificationMode, maximum };
  }
  function resolveLegendUnit(maximum, breaks, baseUnit) {
    const magnitudeUnits = [{ minimum: 1000000000, divisor: 1000000000, prefix: "Billion" }, { minimum: 1000000, divisor: 1000000, prefix: "Million" }, { minimum: 1000, divisor: 1000, prefix: "Thousand" }, { minimum: 0, divisor: 1, prefix: "" }];
    const smallestPositiveBreak = (breaks || []).find((value) => value > 0) || maximum;
    const magnitude = magnitudeUnits.find((candidate) => maximum >= candidate.minimum && maximum / candidate.divisor < 10000 && smallestPositiveBreak / candidate.divisor >= .01) || magnitudeUnits[magnitudeUnits.length - 1];
    const normalizedBaseUnit = String(baseUnit || "").trim().replace(/^\((.*?)\)$/, "$1").trim();
    return { divisor: magnitude.divisor, label: magnitude.prefix ? [magnitude.prefix, normalizedBaseUnit].filter(Boolean).join(" ") : normalizedBaseUnit };
  }
  function legendDecimalPlaces(breaks, divisor) {
    for (let decimalPlaces = 0; decimalPlaces <= 3; decimalPlaces += 1) {
      const factor = 10 ** decimalPlaces;
      if (breaks.every((value) => Math.abs((value / divisor) * factor - Math.round((value / divisor) * factor)) < 1e-7)) return decimalPlaces;
    }
    return 3;
  }
  function createLegendScale(values, baseUnit) {
    const result = createLegendBreaks(values, LEGEND_CLASS_COUNT); const unit = resolveLegendUnit(result.maximum, result.breaks, baseUnit);
    return { ...result, decimalPlaces: result.maximum > 0 ? legendDecimalPlaces(result.breaks, unit.divisor) : 0, unit };
  }
  function classIndex(value, breaks, classCount) {
    const normalizedClassCount = normalizeLegendClassCount(classCount); const numericValue = Number(value || 0);
    if (!Array.isArray(breaks) || breaks.length <= 1 || numericValue <= 0) return 0;
    const upperBreakIndex = breaks.findIndex((upperBreak, index) => index > 0 && numericValue <= upperBreak); const index = upperBreakIndex === -1 ? normalizedClassCount - 1 : upperBreakIndex - 1;
    return Math.min(Math.max(index, 0), normalizedClassCount - 1);
  }
  function colorFor(value, breaks, colors) {
    if (!Number.isFinite(value) || value <= 0 || !breaks.length) return "transparent";
    return colors[classIndex(value, breaks, colors.length)];
  }
  function renderLegend(id, legendScale, titleText, referenceLabels) {
    const map = state.maps[id + "-map"];
    const colors = MAP_PALETTES[state.mapPalettes[id + "-map"]].colors;
    state.legends[id]?.remove?.();
    // Keep the legend out of Leaflet's corner-control flow so its position is
    // measured from the actual map canvas, independently of navigation controls.
    const host = L.DomUtil.create("div", "map-studio-legend-host", map.getContainer());
    const container = L.DomUtil.create("div", "map-studio-legend", host);
    container.setAttribute("data-map-legend", "");
    container.dataset.mapLegendState = referenceLabels?.length || legendScale?.breaks?.length ? "populated" : "empty";
    container.setAttribute("role", "group");
    const content = L.DomUtil.create("div", "map-studio-legend__content", container);
    const title = L.DomUtil.create("div", "map-studio-legend__title", content);
    const unitLabel = L.DomUtil.create("div", "map-studio-legend__unit", content);
    const list = L.DomUtil.create("div", "map-studio-legend__list", content);
    content.id = id + "-map-legend-content";
    title.textContent = titleText || "Value";
    container.setAttribute("aria-label", (titleText || "Value") + " legend");
    if (referenceLabels) {
      unitLabel.textContent = "Units";
      for (let index = colors.length - 1; index >= 0; index -= 1) {
        const label = referenceLabels[index];
        const row = L.DomUtil.create("div", "map-studio-legend__row", list);
        const swatch = L.DomUtil.create("span", "map-studio-legend__swatch", row);
        const referenceLabel = L.DomUtil.create("span", "map-studio-legend__reference-label", row);
        swatch.style.backgroundColor = colors[index];
        referenceLabel.textContent = label;
      }
    } else if (!legendScale || !legendScale.breaks.length) {
      unitLabel.textContent = "";
    } else {
      const scale = legendScale;
      const thresholds = scale.breaks;
      const decimals = scale.decimalPlaces;
      const formatLegendValue = (value) => Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      const displayUnit = String(scale.unit.label || "").trim().replace(/^\((.*?)\)$/, "$1").trim();
      container.setAttribute("aria-label", (titleText || "Value") + (displayUnit ? " legend in " + displayUnit : " legend"));
      unitLabel.textContent = displayUnit ? "(" + displayUnit + ")" : "";
      for (let index = colors.length - 1; index >= 0; index -= 1) {
        const row = L.DomUtil.create("div", "map-studio-legend__row" + (index === 0 ? " map-studio-legend__row--lowest-bound" : ""), list);
        const swatch = L.DomUtil.create("span", "map-studio-legend__swatch", row);
        const lower = L.DomUtil.create("span", "map-studio-legend__bound map-studio-legend__bound--lower", row);
        const separator = L.DomUtil.create("span", "map-studio-legend__separator", row);
        const upper = L.DomUtil.create("span", "map-studio-legend__bound map-studio-legend__bound--upper", row);
        const upperLabel = formatLegendValue(thresholds[index + 1] / scale.unit.divisor);
        const lowerLabel = index > 0 ? formatLegendValue(thresholds[index] / scale.unit.divisor) : "";
        swatch.style.backgroundColor = colors[index];
        lower.textContent = index === 0 ? "<" + upperLabel : lowerLabel;
        separator.textContent = index === 0 ? "" : "–";
        upper.textContent = upperLabel;
        upper.hidden = index === 0;
        row.setAttribute("aria-label", index === 0 ? "Less than " + upperLabel : lowerLabel + " to " + upperLabel);
      }
    }
    const control = {
      getContainer: () => host,
      setPosition: (position) => { host.dataset.mapLegendPosition = normalizeLegendPosition(position); },
      remove: () => host.remove(),
    };
    state.legends[id] = control;
    applyMapLegendPosition(id + "-map", state.mapLegendPositions[id + "-map"], { persist: false });
    if (id === "standing") updatePagasaLegend("standing-map");
  }
  function renderDefaultLegend(kind) {
    renderLegend(kind, null, "No data loaded", null);
    if (kind === "general") renderAffectedAreas([], null);
  }

  function aggregateGeneralRows(rows, targetLevel, metricKeys, valueReader) {
    const targetIndex = LEVEL_ORDER.indexOf(targetLevel); const grouped = new Map();
    rows.forEach((row) => {
      const sourceLevel = hierarchyLevelForAggregation(row.location);
      const sourceIndex = LEVEL_ORDER.indexOf(sourceLevel); if (sourceIndex > targetIndex) return;
      const target = resolveParent(row.location, targetLevel); if (!target) return;
      const targetKey = locationKey(target);
      // A province row should replace municipality rows only within that
      // province. HUCs are independent reporting areas, so their rows stay
      // as separate siblings and are added to the regional total.
      const scopeLocation = targetLevel === "region" && sourceLevel === "municipality_city"
        ? resolveParent(row.location, "province_huc") || row.location
        : targetLevel === "province_huc" && sourceLevel === "municipality_city"
          ? resolveParent(row.location, "province_huc") || row.location
          : row.location;
      const scopeKey = locationKey(scopeLocation);
      const scopeLevel = hierarchyLevelForAggregation(scopeLocation);
      const hasMetricValue = metricKeys.some((key) => Number.isFinite(valueReader(row, key)));
      const direct = sourceLevel === scopeLevel && (hasMetricValue || isHucFeature(row.location.properties || {}));
      const values = Object.fromEntries(metricKeys.map((key) => {
        const value = valueReader(row, key); return [key, Number.isFinite(value) ? value : 0];
      }));
      const targetGroup = grouped.get(targetKey) || { location: target, scopes: new Map() };
      const existing = targetGroup.scopes.get(scopeKey);
      if (!existing || (direct && !existing.direct)) {
        targetGroup.scopes.set(scopeKey, { direct, rowCount: 1, values });
      } else if (direct === existing.direct) {
        existing.rowCount += 1;
        metricKeys.forEach((key) => { existing.values[key] += values[key]; });
      }
      grouped.set(targetKey, targetGroup);
    });
    return [...grouped.values()].map((group) => {
      const targetKey = locationKey(group.location);
      const directTarget = group.scopes.get(targetKey);
      const scopes = directTarget?.direct ? [directTarget] : [...group.scopes.values()];
      const values = Object.fromEntries(metricKeys.map((key) => [key, 0]));
      const rowCount = scopes.reduce((count, scope) => {
        metricKeys.forEach((key) => { values[key] += scope.values[key]; });
        return count + scope.rowCount;
      }, 0);
      return { location: group.location, rowCount, values };
    });
  }

  function aggregateValuesByCode(rows, targetLevel, valueGetter) {
    const targetIndex = LEVEL_ORDER.indexOf(targetLevel); const grouped = new Map();
    rows.forEach((row) => {
      const sourceIndex = LEVEL_ORDER.indexOf(hierarchyLevelForAggregation(row.location)); if (sourceIndex > targetIndex) return;
      const target = resolveParent(row.location, targetLevel); if (!target) return;
      const key = locationKey(target); const value = valueGetter(row); if (!Number.isFinite(value)) return;
      const existing = grouped.get(key);
      if (!existing || sourceIndex > existing.sourceIndex) grouped.set(key, { sourceIndex, value });
      else if (sourceIndex === existing.sourceIndex) existing.value += value;
    });
    return new Map([...grouped.entries()].map(([key, item]) => [key, item.value]));
  }

  async function renderDatasetMap(kind) {
    const dataset = kind === "general" ? state.general : activeStandingDataset();
    if (!dataset) return;
    const mapId = kind + "-map"; const targetLevel = kind === "general" ? $("#general-level").value : $("#standing-level").value; const map = state.maps[mapId];
    const finishLoading = beginMapLoading(mapId, "Rendering data layer…");
    try {
      if (kind === "general") removeAffectedBoundaryLabels(mapId);
      if (targetLevel === "municipality_city") await ensureMunicipalityBaseLayer(mapId);
      setBoundaryVisibility(mapId, targetLevel);
      const geo = await loadGeo(targetLevel);
      clearBoundarySelection(mapId, { closePopup: true });
      if (state.layers[mapId]) map.removeLayer(state.layers[mapId]);
      const sourceRows = dataset.rows;
      const aggregatedGeneralRows = kind === "general"
        ? aggregateGeneralRows(sourceRows, targetLevel, ["value"], (row) => row.values[$("#general-metric").value])
        : null;
      const valuesByCode = kind === "general"
        ? new Map(aggregatedGeneralRows.map((item) => [locationKey(item.location), item.values.value]))
        : aggregateValuesByCode(sourceRows, targetLevel, (row) => standingMetric(row, $("#standing-classification").value, $("#standing-stage").value));
      const colors = MAP_PALETTES[state.mapPalettes[mapId]].colors;
      const selectedMetricTitle = kind === "standing" ? "Area of Standing Crops" : ($("#general-metric option:checked").textContent || "Value");
      const selectedClass = kind === "standing" ? ($("#standing-classification option:checked").textContent || "All classifications") : "";
      const selectedStage = kind === "standing" ? ($("#standing-stage option:checked").textContent || "Total area") : "";
      const metricPresentation = kind === "standing" ? { label: selectedMetricTitle, unit: "Hectares" } : generalMetricPresentation(selectedMetricTitle);
      const metricUnit = kind === "standing" ? metricPresentation.unit : ($("#general-unit")?.value.trim() || metricPresentation.unit);
      const legendScale = createLegendScale([...valuesByCode.values()], metricUnit);
      const thresholds = legendScale.breaks;
      state.layers[mapId] = L.geoJSON(geo, {
      pane: "mapDataPane-" + mapId,
      filter: (feature) => targetLevel !== "province_huc" || feature.properties?.is_reporting_area !== false,
      style: (feature) => {
        const props = feature.properties || {}; const location = resolveLocation(props.psgc_code, props.psgc_name, targetLevel); const key = location ? locationKey(location) : ""; const value = valuesByCode.get(key);
        const hasValue = Number.isFinite(value) && value > 0;
        return { ...dataBoundaryStrokeStyle(mapId), fillColor: hasValue ? colorFor(value, thresholds, colors) : "transparent", fillOpacity: hasValue ? 1 : 0, smoothFactor: .25 };
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {}; const location = resolveLocation(props.psgc_code, props.psgc_name, targetLevel); const key = location ? locationKey(location) : ""; const value = valuesByCode.get(key);
        const name = props.psgc_name || location?.name || "Unknown";
        const hasValue = Number.isFinite(value) && value > 0;
        const displayValue = hasValue ? fmt(value, 2) + (kind === "standing" ? " ha" : "") : "—";
        const hierarchy = [location?.region, location?.province].filter((item, index, values) => item && values.indexOf(item) === index && item !== name).join(" · ");
        const popupDetails = kind === "standing"
          ? '<dt>Classification</dt><dd>' + esc(selectedClass) + '</dd><dt>Growth stage</dt><dd>' + esc(selectedStage) + '</dd><dt>Area</dt><dd>' + esc(displayValue) + '</dd>'
          : '<dt>Metric</dt><dd>' + esc(selectedMetricTitle) + '</dd><dt>Value</dt><dd>' + esc(displayValue) + '</dd>';
        const popup = '<div class="map-feature-popup"><div class="map-feature-popup__heading"><strong>' + esc(name) + '</strong><span class="map-feature-popup__badge">' + esc(levelLabel(targetLevel)) + '</span></div>' + (hierarchy ? '<p>' + esc(hierarchy) + '</p>' : '') + '<dl><dt>PSGC code</dt><dd>' + esc(location?.code || props.psgc_code || "—") + '</dd>' + popupDetails + '</dl></div>';
        layer.bindPopup(popup);
        layer.on("click", (event) => {
          // Keep the map-level outside-click handler from immediately clearing
          // the new selection while Leaflet opens this feature's popup.
          if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
          selectBoundary(mapId, layer);
        });
      },
      }).addTo(map);
      setMapEmptyState(mapId, false);
      const legendTitle = kind === "standing" ? metricPresentation.label : ($("#general-legend-label")?.value.trim() || metricPresentation.label);
      renderLegend(kind, legendScale, legendTitle);
      if (kind === "general") {
        renderAffectedAreas(affectedAreaLocations(aggregatedGeneralRows, targetLevel), targetLevel);
        renderAffectedBoundaryLabels(mapId, targetLevel, valuesByCode);
      }
    } finally { finishLoading(); }
  }

  function hazardNumericValue(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return NaN;
    const parsed = Number(raw.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  function hazardDateValue(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return NaN;
    const parsed = Date.parse(raw.replace(/\s+-\s+/, " "));
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  function hazardHeaderKey(value) {
    return String(value == null ? "" : value).replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function parseHazardsEarthquakes(text, fileName) {
    const csv = parseCSV(String(text || "").replace(/^\uFEFF/, ""));
    if (csv.length < 2) throw new Error("The earthquake CSV needs a header row and at least one event row.");
    const headers = csv[0].map(hazardHeaderKey);
    const findHeader = (keys) => headers.findIndex((header) => keys.some((key) => header === key || header.includes(key)));
    const columns = {
      dateTime: findHeader(["datetime", "date"]),
      latitude: findHeader(["latitude", "lat"]),
      longitude: findHeader(["longitude", "lon", "lng"]),
      depth: findHeader(["depth"]),
      magnitude: findHeader(["magnitude", "mag"]),
      location: findHeader(["location", "epicenter"]),
    };
    const missing = Object.entries(columns).filter(([, index]) => index < 0).map(([key]) => key);
    if (missing.length) throw new Error("Earthquake CSV is missing required column(s): " + missing.join(", ") + ".");
    if (headers.length > 12) throw new Error("The earthquake CSV cannot contain more than 12 columns.");
    const unitsCandidate = csv[1] || [];
    const unitsMarkers = unitsCandidate.filter((value) => /º|°|\bkm\b|philippine time/i.test(String(value || "")) || /^\([^)]*\)$/.test(String(value || "").trim())).length;
    const numericUnitCells = [columns.latitude, columns.longitude, columns.depth, columns.magnitude].filter((index) => index >= 0).map((index) => unitsCandidate[index]);
    const unitsRow = unitsMarkers >= 2 && numericUnitCells.length > 0 && numericUnitCells.every((value) => !Number.isFinite(hazardNumericValue(value))) && !String(unitsCandidate[columns.location] || "").trim();
    const firstDataIndex = unitsRow ? 2 : 1;
    const rows = [];
    const issues = [];
    csv.slice(firstDataIndex).forEach((raw, offset) => {
      const rowNumber = firstDataIndex + offset + 1;
      if (raw.length !== headers.length) { issues.push("Row " + rowNumber + " has " + raw.length + " columns; expected " + headers.length + "."); return; }
      const dateTime = String(raw[columns.dateTime] || "").trim();
      const latitude = hazardNumericValue(raw[columns.latitude]);
      const longitude = hazardNumericValue(raw[columns.longitude]);
      const depthKm = hazardNumericValue(raw[columns.depth]);
      const magnitude = hazardNumericValue(raw[columns.magnitude]);
      const location = String(raw[columns.location] || "").trim();
      const invalid = [];
      if (!dateTime) invalid.push("date/time");
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) invalid.push("latitude");
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) invalid.push("longitude");
      if (!Number.isFinite(depthKm) || depthKm < 0) invalid.push("depth");
      if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 10) invalid.push("magnitude");
      if (!location) invalid.push("location");
      if (invalid.length) { issues.push("Row " + rowNumber + " has an invalid " + invalid.join(", ") + "."); return; }
      rows.push({ dateTime, latitude, longitude, depthKm, magnitude, location });
    });
    if (!rows.length) throw new Error("No valid earthquake events were found in the CSV.");
    const dateRange = hazardEarthquakeDateRange(rows);
    return { fileName: fileName || "Earthquake events", rows, sourceRowCount: csv.length - firstDataIndex, invalidRows: issues.length, issues, dateRange };
  }
  function readHazardVolcanoes() {
    const errors = [];
    const volcanoes = HAZARD_VOLCANOES.map((volcano) => {
      const input = $("#hazards-volcano-" + volcano.key);
      const raw = String(input?.value || "").trim();
      if (!raw) return { ...volcano, alert: 0 };
      const alert = Number(raw);
      if (!Number.isInteger(alert) || alert < 0 || alert > 5) errors.push(volcano.name + " must use an integer alert level from 0 to 5.");
      return { ...volcano, alert };
    });
    if (errors.length) throw new Error(errors.join(" "));
    return volcanoes;
  }
  function hazardAlertLabel(alert) { return Number.isInteger(alert) && alert >= 0 && alert <= 5 ? HAZARD_ALERT_LABELS[alert] : "Not supplied"; }
  function hazardVolcanoStatus(volcano, alert) {
    if (!Number.isInteger(alert) || alert < 0 || alert > 5) return "Not supplied";
    return HAZARD_VOLCANO_STATUS_LABELS[volcano?.key]?.[alert] || hazardAlertLabel(alert);
  }
  function hazardVolcanoCriteria(volcano, alert) {
    if (!volcano || !Number.isInteger(alert) || alert < 0 || alert > 5) return null;
    return HAZARD_VOLCANO_CRITERIA[volcano.key]?.[alert] || null;
  }
  function ensureHazardCriteriaDialog() {
    let dialog = $("#hazard-criteria-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "hazard-criteria-dialog";
    dialog.className = "hazard-criteria-dialog";
    dialog.setAttribute("aria-labelledby", "hazard-criteria-dialog-title");
    enableDialogBackdropClose(dialog);
    document.body.appendChild(dialog);
    return dialog;
  }
  function openHazardCriteriaDialog() {
    const dialog = ensureHazardCriteriaDialog();
    const currentVolcanoes = state.hazards?.volcanoes || HAZARD_VOLCANOES.map((volcano) => ({ ...volcano, alert: 0 }));
    const rows = HAZARD_VOLCANOES.map((reference) => {
      const volcano = currentVolcanoes.find((item) => item.key === reference.key) || { ...reference, alert: 0 };
      const alert = Number.isInteger(volcano.alert) && volcano.alert >= 0 && volcano.alert <= 5 ? volcano.alert : 0;
      const criteria = hazardVolcanoCriteria(reference, alert);
      if (!criteria) return "";
      const interpretationRecommendation = '<p class="hazard-criteria-table__combined">' + esc([criteria.interpretation, criteria.recommendation].filter(Boolean).join(" ")) + '</p>';
      return '<tr><th scope="row" style="--hazard-alert-color:' + hazardAlertColor(alert) + '"><span class="hazard-criteria-table__volcano">' + esc(reference.name) + '</span><span class="hazard-criteria-table__level">Level ' + alert + ' · ' + esc(hazardVolcanoStatus(reference, alert)) + '</span></th><td>' + esc(criteria.monitoring) + '</td><td>' + interpretationRecommendation + '</td></tr>';
    }).join("");
    dialog.innerHTML = '<div class="hazard-criteria-dialog__header"><div><h2 id="hazard-criteria-dialog-title">Volcano monitoring criteria</h2><p>Current PHIVOLCS alert level reference for each monitored volcano.</p></div><button type="button" class="hazard-criteria-dialog__close" data-hazard-criteria-close aria-label="Close monitoring criteria">×</button></div><div class="hazard-criteria-dialog__body"><table class="hazard-criteria-table"><caption class="sr-only">Volcano monitoring criteria, interpretation and recommendation by current alert level</caption><thead><tr><th scope="col">Volcano / alert level</th><th scope="col">Monitoring criteria</th><th scope="col">Interpretation / Recommendation</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    dialog.querySelector("[data-hazard-criteria-close]")?.addEventListener("click", () => dialog.close());
    if (!dialog.open) dialog.showModal();
    syncDialogTriggerState(dialog.id, true);
  }
  function hazardAlertColor(alert) { return Number.isInteger(alert) && alert >= 0 && alert <= 5 ? HAZARD_ALERT_COLORS[alert] : "#a1a1aa"; }
  function hazardRenderableEarthquakes(events) {
    return (events || []).filter((event) => Number.isFinite(event?.magnitude) && event.magnitude > HAZARD_MIN_EARTHQUAKE_MAGNITUDE);
  }
  function hazardEarthquakeDateRange(events) {
    const rows = hazardRenderableEarthquakes(events);
    if (!rows.length) return [];
    const datedRows = rows.map((row, index) => ({ row, index, value: hazardDateValue(row.dateTime) })).filter((item) => Number.isFinite(item.value)).sort((a, b) => a.value - b.value || a.index - b.index);
    return datedRows.length ? [datedRows[0].row.dateTime, datedRows[datedRows.length - 1].row.dateTime] : [rows[0].dateTime, rows[rows.length - 1].dateTime];
  }
  function hazardEarthquakeMagnitudeCounts(events) {
    const rows = hazardRenderableEarthquakes(events);
    return {
      total: rows.length,
      bands: HAZARD_MAGNITUDE_BANDS.map((band) => ({ ...band, count: rows.filter((event) => hazardMagnitudeBand(event.magnitude) === band).length })),
    };
  }
  function hazardMagnitudeBand(magnitude) {
    return [...HAZARD_MAGNITUDE_BANDS].reverse().find((band) => magnitude >= band.min) || HAZARD_MAGNITUDE_BANDS[0];
  }
  function hazardMagnitudeRadius(magnitude) { return HAZARD_EARTHQUAKE_MARKER_RADIUS; }
  function hazardMagnitudeInnerRadius(magnitude) { return HAZARD_EARTHQUAKE_INNER_RADIUS; }
  function hazardVolcanoIcon(volcano) {
    const color = hazardAlertColor(volcano.alert);
    const { width, height } = HAZARD_VOLCANO_MARKER_SIZE;
    return L.divIcon({ className: "hazards-volcano-marker-shell", iconSize: [width, height], iconAnchor: [width / 2, height / 2], html: '<span class="hazards-volcano-marker" style="--hazard-alert-color:' + color + '" title="' + esc(volcano.name) + '"></span>' });
  }
  function renderHazardsSummary(data) {
    const container = $("#hazards-summary");
    if (!container) return;
    const hasHazardData = Boolean(state.hazards);
    const volcanoRows = HAZARD_VOLCANOES.map((reference) => {
      const volcano = (data?.volcanoes || []).find((item) => item.key === reference.key);
      const status = hasHazardData ? hazardVolcanoStatus(reference, volcano?.alert) : "—";
      return '<li><span class="hazards-summary__dot" style="--hazard-alert-color:' + (hasHazardData ? hazardAlertColor(volcano?.alert) : "#a1a1aa") + '"></span><span>' + esc(reference.name) + '</span><strong class="hazards-summary__status">' + esc(status) + '</strong></li>';
    }).join("");
    const earthquakeCounts = hasHazardData ? hazardEarthquakeMagnitudeCounts(data?.earthquakes) : { total: null, bands: HAZARD_MAGNITUDE_BANDS.map((band) => ({ ...band, count: null })) };
    const formatCount = (value) => Number.isFinite(value) ? fmt(value) : "—";
    const earthquakeRows = earthquakeCounts.bands.map((band) => '<div class="hazards-summary__count"><dt><span class="hazards-summary__magnitude-dot" style="--hazard-magnitude-color:' + band.color + '"></span>' + esc(band.label) + '</dt><dd>' + formatCount(band.count) + '</dd></div>').join("");
    const earthquakeWarning = data?.invalidRows ? '<p class="hazards-summary__warning">' + fmt(data.invalidRows) + ' invalid row(s) skipped.</p>' : '';
    container.innerHTML = '<section class="hazards-summary__section hazards-summary__section--volcano"><div class="hazards-summary__section-heading"><h4>Volcano status</h4></div><ul class="hazards-summary__list">' + volcanoRows + '</ul><button type="button" class="hazards-summary__criteria-button" data-hazard-criteria aria-haspopup="dialog" aria-controls="hazard-criteria-dialog" aria-expanded="false">View criteria</button></section><section class="hazards-summary__section hazards-summary__section--earthquake"><div class="hazards-summary__section-heading hazards-summary__section-heading--stacked"><h4>Earthquake summary</h4><span class="hazards-summary__section-subtitle">Total events &gt; 4.0 magnitude</span></div><dl class="hazards-summary__counts"><div class="hazards-summary__count hazards-summary__count--total"><dt>Total events</dt><dd>' + formatCount(earthquakeCounts.total) + '</dd></div>' + earthquakeRows + '</dl>' + earthquakeWarning + '</section>';
    container.querySelector("[data-hazard-criteria]")?.addEventListener("click", openHazardCriteriaDialog);
  }
  function hazardDateParts(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return null;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    const named = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (named) {
      const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(named[2].toLowerCase()) + 1;
      if (month > 0) return { year: Number(named[3]), month, day: Number(named[1]) };
    }
    const time = hazardDateValue(raw);
    if (!Number.isFinite(time)) return null;
    const date = new Date(time);
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }
  function hazardDateLabel(parts) {
    if (!parts) return "";
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  function hazardDateReference(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    return hazardDateLabel(hazardDateParts(raw)) || raw;
  }
  function hazardDateShortReference(value) {
    const raw = String(value == null ? "" : value).trim();
    const parts = hazardDateParts(raw);
    if (!parts) return raw;
    const month = new Date(Date.UTC(parts.year, parts.month - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    return month + " " + String(parts.day).padStart(2, "0") + ", " + parts.year;
  }
  function hazardDateRangeReference(range) {
    const dates = (range || []).map(hazardDateParts);
    if (!dates[0]) return "";
    const first = dates[0];
    const last = dates[1] || first;
    const month = (parts) => new Date(Date.UTC(parts.year, parts.month - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    const day = (parts) => String(parts.day).padStart(2, "0");
    if (first.year === last.year && first.month === last.month) return month(first) + " " + day(first) + (first.day === last.day ? "" : " - " + day(last)) + ", " + last.year;
    if (first.year === last.year) return month(first) + " " + day(first) + " - " + month(last) + " " + day(last) + ", " + last.year;
    return month(first) + " " + day(first) + ", " + first.year + " - " + month(last) + " " + day(last) + ", " + last.year;
  }
  function hazardsMapDateReference(data) {
    const parts = [];
    if (data?.asOf) parts.push("Volcano alert status as of " + hazardDateShortReference(data.asOf));
    const range = hazardEarthquakeDateRange(data?.earthquakes);
    const rangeLabel = hazardDateRangeReference(range);
    if (rangeLabel) parts.push("Earthquake events of magnitude 4.0 or greater, " + rangeLabel);
    return parts.join(" · ") || "Reference Date";
  }
  function renderHazardsMapTitle(mapId) {
    const map = state.maps[mapId];
    if (!map) return;
    map.getContainer().querySelector(".hazards-map-title")?.remove();
    const title = L.DomUtil.create("div", "hazards-map-title", map.getContainer());
    title.setAttribute("role", "group");
    title.setAttribute("aria-label", "Hazards map layers");
    const titleText = L.DomUtil.create("span", "hazards-map-title__item", title);
    titleText.textContent = "Volcano Alert Levels and Earthquake Events";
    const dateText = L.DomUtil.create("span", "hazards-map-title__subtitle", title);
    dateText.textContent = hazardsMapDateReference(state.hazards);
  }
  function renderHazardsLegend() {
    const map = state.maps["hazards-map"];
    if (!map) return;
    if (!state.hazards) {
      renderLegend("hazards", null, "No data loaded", null);
      return;
    }
    state.legends.hazards?.remove?.();
    const host = L.DomUtil.create("div", "map-studio-legend-host", map.getContainer());
    const container = L.DomUtil.create("div", "map-studio-legend hazards-map-legend", host);
    container.setAttribute("data-map-legend", "");
    container.dataset.mapLegendState = "populated";
    container.setAttribute("role", "group"); container.setAttribute("aria-label", "Volcano alert and earthquake magnitude legend");
    const content = L.DomUtil.create("div", "map-studio-legend__content", container);
    const volcanoUnit = L.DomUtil.create("div", "map-studio-legend__title hazards-legend__section-title", content); volcanoUnit.textContent = "Volcano Alert Level";
    const volcanoList = L.DomUtil.create("div", "map-studio-legend__list", content);
    HAZARD_ALERT_LABELS.forEach((label, index) => {
      const row = L.DomUtil.create("div", "map-studio-legend__row", volcanoList);
      const swatch = L.DomUtil.create("span", "map-studio-legend__swatch hazards-legend__swatch--volcano", row); swatch.style.backgroundColor = HAZARD_ALERT_COLORS[index];
      const text = L.DomUtil.create("span", "map-studio-legend__reference-label", row); text.textContent = "L" + index + " · " + label.replace("Alert level ", "");
    });
    const earthquakeUnit = L.DomUtil.create("div", "map-studio-legend__title hazards-legend__section-title hazards-legend__subheading", content); earthquakeUnit.textContent = "Earthquake Magnitude";
    const earthquakeList = L.DomUtil.create("div", "map-studio-legend__list", content);
    HAZARD_MAGNITUDE_BANDS.forEach((band) => {
      const row = L.DomUtil.create("div", "map-studio-legend__row", earthquakeList);
      const swatch = L.DomUtil.create("span", "map-studio-legend__swatch hazards-legend__swatch--earthquake", row); swatch.style.backgroundColor = "transparent";
      swatch.dataset.hazardColor = band.color;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 " + HAZARD_EARTHQUAKE_LEGEND_VIEWBOX + " " + HAZARD_EARTHQUAKE_LEGEND_VIEWBOX); svg.setAttribute("aria-hidden", "true");
      const center = String(HAZARD_EARTHQUAKE_LEGEND_VIEWBOX / 2);
      const outer = document.createElementNS("http://www.w3.org/2000/svg", "circle"); outer.setAttribute("cx", center); outer.setAttribute("cy", center); outer.setAttribute("r", String(HAZARD_EARTHQUAKE_LEGEND_RADIUS)); outer.setAttribute("fill", band.color); outer.setAttribute("stroke", "none");
      const inner = document.createElementNS("http://www.w3.org/2000/svg", "circle"); inner.setAttribute("cx", center); inner.setAttribute("cy", center); inner.setAttribute("r", String(HAZARD_EARTHQUAKE_LEGEND_INNER_RADIUS)); inner.setAttribute("fill", "#27272a");
      svg.append(outer, inner); swatch.replaceChildren(svg);
      const text = L.DomUtil.create("span", "map-studio-legend__reference-label", row); text.textContent = band.label;
    });
    state.legends.hazards = { getContainer: () => host, setPosition: (position) => { host.dataset.mapLegendPosition = normalizeLegendPosition(position); }, remove: () => host.remove() };
    applyMapLegendPosition("hazards-map", state.mapLegendPositions["hazards-map"], { persist: false });
  }
  function renderHazardsMap() {
    const mapId = "hazards-map";
    const map = state.maps[mapId];
    if (!map) return;
    map.closePopup();
    if (state.layers[mapId]) map.removeLayer(state.layers[mapId]);
    const data = state.hazards || { volcanoes: HAZARD_VOLCANOES.map((volcano) => ({ ...volcano, alert: 0 })), earthquakes: [] };
    const layers = [];
    (data.volcanoes || []).filter((volcano) => Number.isInteger(volcano.alert)).forEach((volcano) => {
      const marker = L.marker([volcano.latitude, volcano.longitude], { icon: hazardVolcanoIcon(volcano), title: volcano.name, alt: volcano.name });
      marker.bindPopup('<div class="hazards-popup"><div class="hazards-popup__heading"><strong>' + esc(volcano.name) + '</strong><span style="--hazard-alert-color:' + hazardAlertColor(volcano.alert) + '">' + esc(hazardAlertLabel(volcano.alert)) + '</span></div><p>DOST-PHIVOLCS volcano monitoring point</p><dl><dt>Alert level</dt><dd>' + esc(String(volcano.alert)) + '</dd>' + (data.asOf ? '<dt>As of</dt><dd>' + esc(hazardDateShortReference(data.asOf)) + '</dd>' : '') + '</dl></div>');
      layers.push(marker);
    });
    hazardRenderableEarthquakes(data.earthquakes).forEach((event) => {
      const band = hazardMagnitudeBand(event.magnitude);
      const radius = hazardMagnitudeRadius(event.magnitude);
      const marker = L.circleMarker([event.latitude, event.longitude], { radius, stroke: false, color: "transparent", weight: 0, opacity: 0, fillColor: band.color, fillOpacity: 1 });
      const dot = L.circleMarker([event.latitude, event.longitude], { radius: hazardMagnitudeInnerRadius(event.magnitude), stroke: false, color: "transparent", weight: 0, opacity: 0, fillColor: "#27272a", fillOpacity: 1, interactive: false });
      marker.bindPopup('<div class="hazards-popup"><div class="hazards-popup__heading"><strong>Earthquake M' + event.magnitude.toFixed(1) + '</strong><span>' + esc(band.label) + '</span></div><p>' + esc(event.location) + '</p><dl><dt>Date / time</dt><dd>' + esc(event.dateTime) + '</dd><dt>Depth</dt><dd>' + fmt(event.depthKm, 1) + ' km</dd><dt>Coordinates</dt><dd>' + event.latitude.toFixed(2) + '°N, ' + event.longitude.toFixed(2) + '°E</dd></dl></div>');
      layers.push(L.layerGroup([marker, dot]));
    });
    state.layers[mapId] = L.layerGroup(layers).addTo(map);
    // Keep the shared empty-state card visible until the user submits hazard
    // inputs, while still showing the reference volcano points at level 0.
    setMapEmptyState(mapId, !state.hazards);
    renderHazardsMapTitle(mapId);
    renderHazardsLegend();
    renderHazardsSummary(data);
  }
  function localDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }
  function setHazardsDateConstraint() {
    const input = $("#hazards-as-of");
    if (!input) return;
    const today = localDateInputValue();
    input.max = today;
    if (input.value && input.value > today) input.value = "";
  }
  function updateHazardsDateDisplay() {
    const input = $("#hazards-as-of");
    const display = $("#hazards-as-of-display");
    if (!input || !display) return;
    display.textContent = input.value ? hazardDateShortReference(input.value) : "MMM DD, YYYY";
    display.classList.toggle("is-empty", !input.value);
  }
  async function handleHazards(event) {
    event.preventDefault();
    try {
      showStatus("info", "Reading hazard inputs locally…", "hazards", { persistent: true });
      const volcanoes = readHazardVolcanoes();
      const input = $("#hazards-earthquake-file");
      const previous = state.hazards || {};
      const asOf = $("#hazards-as-of")?.value || "";
      const today = localDateInputValue();
      if (asOf && asOf > today) {
        showStatus("error", "Alert levels date cannot be later than today.", "hazards");
        return;
      }
      if (!input?.files?.[0] && !previous.fileName) {
        showStatus("error", "Choose an earthquake CSV before updating the map.", "hazards");
        return;
      }
      let earthquakeData = { rows: previous.earthquakes || [], fileName: previous.fileName || "", invalidRows: previous.invalidRows || 0, dateRange: previous.dateRange || [] };
      if (input?.files?.[0]) {
        const result = await readFile(input);
        const parsed = parseHazardsEarthquakes(result.text, result.file.name);
        earthquakeData = { rows: parsed.rows, fileName: parsed.fileName, invalidRows: parsed.invalidRows, dateRange: parsed.dateRange };
      }
      state.hazards = { volcanoes, earthquakes: earthquakeData.rows, fileName: earthquakeData.fileName, invalidRows: earthquakeData.invalidRows, dateRange: earthquakeData.dateRange, asOf };
      renderHazardsMap();
      const renderedEarthquakeCount = hazardRenderableEarthquakes(earthquakeData.rows).length;
      const message = "Map updated · " + volcanoes.filter((volcano) => Number.isInteger(volcano.alert)).length + " volcano alert(s) · " + renderedEarthquakeCount + " earthquake event(s) above M4.0.";
      showStatus(earthquakeData.invalidRows ? "warning" : "success", earthquakeData.invalidRows ? message + " " + earthquakeData.invalidRows + " invalid row(s) skipped." : message, "hazards");
    } catch (error) {
      showStatus("error", error.message || "Hazard data could not be rendered.", "hazards");
    }
  }
  async function handleHazardsEarthquakeFileSelection(input) {
    updateFileDrop(input);
    if (!input.files?.[0]) return;
    try {
      const result = await readFile(input);
      const parsed = parseHazardsEarthquakes(result.text, result.file.name);
      const renderedEarthquakeCount = hazardRenderableEarthquakes(parsed.rows).length;
      setFileDropStatus(input, fileSizeLabel(result.file.size) + " · " + fmt(renderedEarthquakeCount) + " events above M4.0 ready", false);
      showStatus(parsed.invalidRows ? "warning" : "success", "Earthquake CSV format passed · " + fmt(renderedEarthquakeCount) + " events above M4.0 ready for the map.", "hazards");
    } catch (error) {
      setFileDropStatus(input, "Pre-validation failed · Choose a DOST-PHIVOLCS CSV", true);
      showStatus("error", "Earthquake CSV pre-validation failed · " + error.message, "hazards");
    }
  }
  function clearHazardsData() {
    const form = $("#hazards-form");
    form?.reset();
    const input = $("#hazards-earthquake-file");
    if (input) updateFileDrop(input);
    state.hazards = null;
    renderHazardsMap();
    showStatus("", "", "hazards");
  }

  function generalMetricPresentation(title) {
    const metricTitle = String(title || "Value").trim() || "Value";
    const unitMatch = metricTitle.match(/\(([^()]*)\)\s*$/);
    return {
      label: (unitMatch ? metricTitle.replace(unitMatch[0], "").trim() : metricTitle) || "Value",
      unit: unitMatch ? unitMatch[1].trim() : "",
    };
  }

  function renderGeneralSummary(dataset) {
    $("#general-summary").innerHTML = "";
    $("#general-summary").classList.add("is-hidden"); $("#general-controls").classList.remove("is-hidden");
    const breakdownButton = $("#general-summary-breakdown");
    if (breakdownButton) { breakdownButton.disabled = false; breakdownButton.hidden = false; }
    $("#general-level").innerHTML = dataset.availableLevels.map((level) => '<option value="' + level + '">' + levelLabel(level) + "</option>").join("");
    $("#general-level").value = dataset.deepest;
    $("#general-metric").innerHTML = dataset.metrics.map((metric) => '<option value="' + metric.key + '">' + esc(metric.title) + "</option>").join("");
    $("#general-legend-label").value = DEFAULT_GENERAL_LEGEND_LABEL;
    $("#general-unit").value = DEFAULT_GENERAL_UNIT;
  }
  function generalColumnSummary(text) {
    const csv = parseCSV(text);
    if (!csv.length) return [];
    const headers = csv[0].map((value) => String(value).trim());
    const rows = csv.slice(1);
    return headers.map((header, columnIndex) => {
      const values = rows.map((row) => String(row[columnIndex] == null ? "" : row[columnIndex]).trim());
      const populatedCount = values.filter(Boolean).length;
      const numericValues = columnIndex >= 2 ? values.map(numberValue).filter(Number.isFinite) : [];
      const isNumeric = columnIndex >= 2;
      return {
        header,
        value: isNumeric ? numericValues.reduce((total, value) => total + value, 0) : populatedCount,
        populatedCount,
        numericCount: numericValues.length,
        kind: isNumeric ? "numeric" : "text",
      };
    });
  }
  function clearGeneralDataSummary() {
    const panel = $("#general-data-summary-panel");
    const workspace = $("[data-panel=general]");
    const textColumns = $("#general-data-summary-text-columns");
    const chartLabel = $("#general-data-summary-chart-label");
    const chartWrap = $("#general-data-summary-chart-wrap");
    const breakdownButton = $("#general-summary-breakdown");
    const breakdownMetrics = $("#general-breakdown-metrics");
    const breakdownMetricsLabel = $("#general-breakdown-metrics-label");
    panel?.classList.remove("is-hidden");
    workspace?.classList.add("has-data-summary");
    textColumns?.replaceChildren();
    breakdownMetrics?.replaceChildren();
    if (breakdownMetricsLabel) breakdownMetricsLabel.textContent = "All metric columns";
    textColumns?.classList.add("is-hidden");
    chartLabel?.classList.add("is-hidden");
    chartWrap?.classList.add("is-hidden");
    if (breakdownButton) { breakdownButton.disabled = true; breakdownButton.hidden = true; }
    if (state.charts.generalData) { state.charts.generalData.destroy(); delete state.charts.generalData; }
    const dialog = $("#general-breakdown-dialog");
    if (dialog?.open) dialog.close();
    window.setTimeout(() => safeInvalidateMapSize(state.maps["general-map"]), 0);
  }
  function chartAxisScale(summaries) {
    const maximum = Math.max(0, ...summaries.map((item) => Math.abs(item.value)).filter(Number.isFinite));
    if (maximum >= 1000000000) return { divisor: 1000000000, suffix: "B" };
    if (maximum >= 1000000) return { divisor: 1000000, suffix: "M" };
    if (maximum >= 1000) return { divisor: 1000, suffix: "K" };
    return { divisor: 1, suffix: "" };
  }
  function formatChartAxisValue(value, scale) {
    if (!Number(value)) return "0";
    const scaled = Number(value || 0) / scale.divisor;
    const digits = scale.divisor === 1 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return scaled.toLocaleString("en-PH", { maximumFractionDigits: digits }) + scale.suffix;
  }
  function generalBreakdownRows(dataset, targetLevel) {
    return aggregateGeneralRows(dataset.rows, targetLevel, dataset.metrics.map((metric) => metric.key), (row, key) => row.values[key])
      .sort((a, b) => String(a.location.code || a.location.name).localeCompare(String(b.location.code || b.location.name), undefined, { numeric: true }));
  }
  function renderGeneralBreakdownMetricOptions(dataset) {
    const container = $("#general-breakdown-metrics");
    const label = $("#general-breakdown-metrics-label");
    if (!container) return;
    const metricKeys = dataset.metrics.map((metric) => metric.key);
    const currentInputs = [...container.querySelectorAll("input[data-breakdown-metric]")];
    const currentKeys = currentInputs.map((input) => input.value);
    if (!(currentKeys.length === metricKeys.length && currentKeys.every((key, index) => key === metricKeys[index]))) {
      const selectedKeys = new Set(currentInputs.filter((input) => input.checked).map((input) => input.value));
      container.replaceChildren();
      dataset.metrics.forEach((metric, index) => {
        const option = document.createElement("label");
        option.className = "data-breakdown-multi-select__option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = metric.key;
        input.checked = currentInputs.length ? selectedKeys.has(metric.key) : true;
        input.dataset.breakdownMetric = "true";
        input.id = "general-breakdown-metric-" + index;
        input.addEventListener("change", renderGeneralBreakdown);
        const text = document.createElement("span");
        text.textContent = metric.title;
        option.append(input, text);
        container.append(option);
      });
    }
    if (label) {
      const selected = [...container.querySelectorAll("input[data-breakdown-metric]:checked")];
      if (!selected.length) label.textContent = "No metric columns";
      else if (selected.length === dataset.metrics.length) label.textContent = "All metric columns";
      else if (selected.length <= 2) label.textContent = selected.map((input) => input.closest("label")?.querySelector("span")?.textContent || input.value).join(", ");
      else label.textContent = selected.length + " columns selected";
    }
  }
  function selectedGeneralBreakdownMetrics(dataset) {
    const selectedKeys = new Set([...document.querySelectorAll("#general-breakdown-metrics input[data-breakdown-metric]:checked")].map((input) => input.value));
    return dataset.metrics.filter((metric) => selectedKeys.has(metric.key));
  }
  function renderGeneralBreakdown() {
    const dataset = state.general;
    const level = $("#general-breakdown-level")?.value || "region";
    const head = $("#general-breakdown-head");
    const body = $("#general-breakdown-body");
    const foot = $("#general-breakdown-foot");
    if (!dataset || !head || !body || !foot) return;
    renderGeneralBreakdownMetricOptions(dataset);
    const rows = generalBreakdownRows(dataset, level);
    const metrics = selectedGeneralBreakdownMetrics(dataset);
    const breakdownValue = (value) => Number(value || 0) === 0 ? "-" : fmt(value, 2);
    head.innerHTML = "<tr><th scope=\"col\">" + esc(levelLabel(level)) + "</th><th scope=\"col\">PSGC code</th>" + metrics.map((metric) => "<th scope=\"col\" title=\"" + esc(metric.title) + "\">" + esc(metric.title) + "</th>").join("") + "</tr>";
    body.innerHTML = rows.length
      ? rows.map((row) => "<tr><th scope=\"row\">" + esc(row.location.name) + "</th><td class=\"data-breakdown-table__code\">" + esc(row.location.code || "—") + "</td>" + metrics.map((metric) => "<td class=\"data-breakdown-table__number\">" + breakdownValue(row.values[metric.key]) + "</td>").join("") + "</tr>").join("")
      : "<tr><td class=\"data-breakdown-table__empty\" colspan=\"" + (metrics.length + 2) + "\">No validated rows are available at this level.</td></tr>";
    foot.innerHTML = rows.length
      ? "<tr><th scope=\"row\">Total</th><td class=\"data-breakdown-table__code\">—</td>" + metrics.map((metric) => "<td class=\"data-breakdown-table__number\">" + breakdownValue(rows.reduce((total, row) => total + (Number.isFinite(row.values[metric.key]) ? row.values[metric.key] : 0), 0)) + "</td>").join("") + "</tr>"
      : "";
  }
  function openGeneralBreakdown() {
    if (!state.general) return;
    renderGeneralBreakdown();
    const dialog = $("#general-breakdown-dialog");
    if (dialog && !dialog.open) dialog.showModal();
    if (dialog) syncDialogTriggerState(dialog.id, true);
  }
  function standingBreakdownGroups(dataset) {
    return (dataset.classes || []).concat([["grand_total", "Grand Total"]]);
  }
  function standingBreakdownMetrics(dataset) {
    const groups = standingBreakdownGroups(dataset);
    return groups.flatMap(([classKey, classLabel]) => [
      ...STAGES.map(([stageKey, stageLabel]) => ({ key: classKey + "." + stageKey, title: classLabel + " · " + stageLabel })),
      { key: classKey + ".total", title: classLabel + " · Total" },
    ]);
  }
  function standingBreakdownRows(dataset, targetLevel) {
    const metrics = standingBreakdownMetrics(dataset);
    return aggregateGeneralRows(dataset.rows, targetLevel, metrics.map((metric) => metric.key), (row, key) => {
      const [classKey, stageKey] = key.split(".");
      return row.values[classKey]?.[stageKey];
    }).sort((a, b) => String(a.location.code || a.location.name).localeCompare(String(b.location.code || b.location.name), undefined, { numeric: true }));
  }
  function renderStandingBreakdownMetricOptions(dataset) {
    const container = $("#standing-breakdown-metrics");
    const label = $("#standing-breakdown-metrics-label");
    if (!container) return;
    const metricDefinitions = standingBreakdownMetrics(dataset);
    const metricKeys = metricDefinitions.map((metric) => metric.key);
    const currentInputs = [...container.querySelectorAll("input[data-standing-breakdown-metric]")];
    const currentKeys = currentInputs.map((input) => input.value);
    const preservesSelection = currentKeys.length === metricKeys.length && currentKeys.every((key, index) => key === metricKeys[index]);
    if (!preservesSelection) {
      const selectedKeys = new Set(currentInputs.filter((input) => input.checked).map((input) => input.value));
      container.replaceChildren();
      metricDefinitions.forEach((metric, index) => {
        const option = document.createElement("label");
        option.className = "data-breakdown-multi-select__option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = metric.key;
        input.checked = preservesSelection ? selectedKeys.has(metric.key) : true;
        input.dataset.standingBreakdownMetric = "true";
        input.id = "standing-breakdown-metric-" + index;
        input.addEventListener("change", renderStandingBreakdown);
        const text = document.createElement("span");
        text.textContent = metric.title;
        option.append(input, text);
        container.append(option);
      });
    }
    if (label) {
      const selected = [...container.querySelectorAll("input[data-standing-breakdown-metric]:checked")];
      if (!selected.length) label.textContent = "No metric columns";
      else if (selected.length === metricDefinitions.length) label.textContent = "All metric columns";
      else if (selected.length <= 2) label.textContent = selected.map((input) => input.closest("label")?.querySelector("span")?.textContent || input.value).join(", ");
      else label.textContent = selected.length + " columns selected";
    }
  }
  function selectedStandingBreakdownMetrics(dataset) {
    const selectedKeys = new Set([...document.querySelectorAll("#standing-breakdown-metrics input[data-standing-breakdown-metric]:checked")].map((input) => input.value));
    return standingBreakdownMetrics(dataset).filter((metric) => selectedKeys.has(metric.key));
  }
  function renderStandingBreakdown() {
    const dataset = activeStandingDataset();
    const levelSelect = $("#standing-breakdown-level");
    const head = $("#standing-breakdown-head");
    const body = $("#standing-breakdown-body");
    const foot = $("#standing-breakdown-foot");
    const title = $("#standing-breakdown-dialog-title");
    if (!dataset || !levelSelect || !head || !body || !foot) return;
    const levels = dataset.availableLevels || [];
    const currentLevel = levelSelect.value;
    levelSelect.innerHTML = levels.map((level) => '<option value="' + level + '">' + levelLabel(level) + "</option>").join("");
    levelSelect.value = levels.includes(currentLevel) ? currentLevel : (levels.includes("region") ? "region" : dataset.deepest);
    renderStandingBreakdownMetricOptions(dataset);
    const rows = standingBreakdownRows(dataset, levelSelect.value);
    const metrics = selectedStandingBreakdownMetrics(dataset);
    const groupedMetrics = standingBreakdownGroups(dataset).map(([classKey, classLabel]) => ({ classKey, classLabel, metrics: metrics.filter((metric) => metric.key.startsWith(classKey + ".")) })).filter((group) => group.metrics.length);
    const breakdownValue = (value) => Number(value || 0) === 0 ? "-" : fmt(value, 2);
    const cropLabel = dataset.crop[0].toUpperCase() + dataset.crop.slice(1);
    if (title) title.textContent = cropLabel + " Standing Crops Breakdown";
    const locationHeader = "<th scope=\"col\" rowspan=\"2\">" + esc(levelLabel(levelSelect.value)) + "</th><th scope=\"col\" rowspan=\"2\">PSGC code</th>";
    const groupedHeader = groupedMetrics.map((group) => "<th scope=\"colgroup\" colspan=\"" + group.metrics.length + "\">" + esc(group.classLabel) + "</th>").join("");
    const metricHeader = metrics.map((metric) => "<th scope=\"col\" title=\"" + esc(metric.title) + "\">" + esc(metric.title.substring(metric.title.indexOf(" · ") + 3)) + "</th>").join("");
    head.innerHTML = "<tr>" + locationHeader + groupedHeader + "</tr><tr>" + metricHeader + "</tr>";
    body.innerHTML = rows.length
      ? rows.map((row) => "<tr><th scope=\"row\">" + esc(row.location.name) + "</th><td class=\"data-breakdown-table__code\">" + esc(row.location.code || "—") + "</td>" + metrics.map((metric) => "<td class=\"data-breakdown-table__number\">" + breakdownValue(row.values[metric.key]) + "</td>").join("") + "</tr>").join("")
      : "<tr><td class=\"data-breakdown-table__empty\" colspan=\"" + (metrics.length + 2) + "\">No validated rows are available at this level.</td></tr>";
    foot.innerHTML = rows.length
      ? "<tr><th scope=\"row\">Total</th><td class=\"data-breakdown-table__code\">—</td>" + metrics.map((metric) => "<td class=\"data-breakdown-table__number\">" + breakdownValue(rows.reduce((total, row) => total + (Number.isFinite(row.values[metric.key]) ? row.values[metric.key] : 0), 0)) + "</td>").join("") + "</tr>"
      : "";
  }
  function openStandingBreakdown() {
    if (!activeStandingDataset()) return;
    renderStandingBreakdown();
    const dialog = $("#standing-breakdown-dialog");
    if (dialog && !dialog.open) dialog.showModal();
    if (dialog) syncDialogTriggerState(dialog.id, true);
  }
  function renderGeneralDataSummary(text) {
    const summaries = generalColumnSummary(text);
    const panel = $("#general-data-summary-panel");
    const workspace = $("[data-panel=general]");
    const textColumns = $("#general-data-summary-text-columns");
    const chartLabel = $("#general-data-summary-chart-label");
    const chartWrap = $("#general-data-summary-chart-wrap");
    const breakdownButton = $("#general-summary-breakdown");
    if (!panel || !workspace || !textColumns || !chartWrap || !summaries.length) return;
    const textSummaries = summaries.filter((item) => item.kind === "text");
    const numericSummaries = summaries.filter((item) => item.kind === "numeric");
    const axisScale = chartAxisScale(numericSummaries);
    workspace.classList.add("has-data-summary");
    panel.classList.remove("is-hidden");
    if (breakdownButton) { breakdownButton.disabled = !state.general; breakdownButton.hidden = !state.general; }
    textColumns.replaceChildren();
    textSummaries.forEach((item) => {
      const row = document.createElement("li"); const label = document.createElement("strong");
      label.textContent = item.header + ": "; row.append(label, document.createTextNode(fmt(item.populatedCount) + " populated rows")); textColumns.appendChild(row);
    });
    textColumns.classList.toggle("is-hidden", !textSummaries.length);
    chartLabel?.classList.toggle("is-hidden", !numericSummaries.length);
    chartWrap.classList.toggle("is-hidden", !numericSummaries.length);
    chartWrap.style.height = Math.max(280, Math.min(760, numericSummaries.length * 30 + 80)) + "px";
    if (!numericSummaries.length) {
      if (state.charts.generalData) { state.charts.generalData.destroy(); delete state.charts.generalData; }
      window.setTimeout(() => safeInvalidateMapSize(state.maps["general-map"]), 0);
      return;
    }
    replaceChart("generalData", $("#general-data-summary-chart"), {
      type: "bar",
      data: {
        labels: numericSummaries.map((item) => item.header),
        datasets: [{
          data: numericSummaries.map((item) => item.value),
          backgroundColor: PRIMARY_GREEN,
          borderRadius: 0,
          barPercentage: .72,
          categoryPercentage: .82,
        }],
      },
      plugins: [GENERAL_BAR_VALUE_LABELS_PLUGIN],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: chartTooltip({
            title: (items) => chartTooltipTitle(items[0]?.label),
            label: (context) => "Total: " + fmt(context.raw, 2),
          }),
        },
        scales: {
          x: { beginAtZero: true, grid: { color: "#e5ebe5" }, ticks: { color: "#7c8a82", font: { family: CHART_DATA_FONT_FAMILY, size: 9 }, callback: (value) => formatChartAxisValue(value, axisScale) } },
          y: { grid: { display: false }, ticks: { color: "#53655a", font: { family: CHART_UI_FONT_FAMILY, size: 9 }, callback: (value) => { const label = numericSummaries[Number(value)]?.header || ""; return label.length > 22 ? label.slice(0, 21) + "…" : label; } } },
        },
      },
    });
    window.setTimeout(() => safeInvalidateMapSize(state.maps["general-map"]), 0);
  }
  function renderStandingSummary(dataset) {
    const cropLabel = dataset.crop[0].toUpperCase() + dataset.crop.slice(1);
    const summary = $("#standing-summary");
    const breakdownButton = $("#standing-summary-breakdown");
    const breakdownDialog = $("#standing-breakdown-dialog");
    if (breakdownDialog?.open) breakdownDialog.close();
    summary.innerHTML = '<p class="summary-file standing-upload-summary" title="' + esc(dataset.fileName) + '">' + esc(dataset.fileName + " · " + fmt(dataset.analysisRows.length) + " " + levelLabel(dataset.deepest).toLowerCase() + " rows.") + "</p>";
    summary.classList.remove("is-hidden"); $("#standing-controls").classList.remove("is-hidden");
    if (breakdownButton) { breakdownButton.disabled = false; breakdownButton.hidden = false; }
    syncStandingDatasetSelector();
    $("#standing-classification").innerHTML = '<option value="all">All classifications</option>' + dataset.classes.map((item) => '<option value="' + item[0] + '">' + item[1] + "</option>").join("");
    $("#standing-stage").innerHTML = '<option value="total">Total area</option>' + STAGES.map((item) => '<option value="' + item[0] + '">' + item[1] + "</option>").join("");
    $("#standing-level").innerHTML = dataset.availableLevels.map((level) => '<option value="' + level + '">' + levelLabel(level) + "</option>").join("");
    $("#standing-level").value = dataset.deepest;
    $("#analytics-subtitle").textContent = cropLabel + " · " + fmt(dataset.analysisRows.length) + " " + levelLabel(dataset.deepest).toLowerCase() + " rows";
  }

  function chartTooltipTitle(value) {
    const text = String(value || "").trim();
    if (text.length <= 38) return text;
    const lines = []; let line = "";
    text.split(/\s+/).forEach((word) => {
      if (line && line.length + word.length + 1 > 38) { lines.push(line); line = word; }
      else line = line ? line + " " + word : word;
    });
    if (line) lines.push(line);
    return lines;
  }
  function chartTooltip(callbacks) {
    return {
      backgroundColor: "#142b26",
      borderColor: "#6f9d82",
      borderWidth: 1,
      bodyColor: "#f4faf5",
      bodyFont: { family: CHART_DATA_FONT_FAMILY, size: 10, weight: "600" },
      boxPadding: 4,
      displayColors: true,
      padding: { top: 8, right: 10, bottom: 8, left: 10 },
      titleColor: "#ffffff",
      titleFont: { family: CHART_UI_FONT_FAMILY, size: 11, weight: "700" },
      titleMarginBottom: 5,
      callbacks,
    };
  }
  function chartOptions(indexAxis, showLegend) {
    const axis = indexAxis || "x";
    const numericAxis = axis === "y" ? "x" : "y";
    const tickFont = (name) => ({ family: name === numericAxis ? CHART_DATA_FONT_FAMILY : CHART_UI_FONT_FAMILY, size: 10 });
    return { responsive: true, maintainAspectRatio: false, indexAxis: axis, plugins: { legend: { display: Boolean(showLegend), position: "top", labels: { color: "#7c8a82", usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 10, font: { family: CHART_UI_FONT_FAMILY, size: 10 } } }, tooltip: chartTooltip({ title: (items) => chartTooltipTitle(items[0]?.label), label: (context) => fmt(context.raw, 2) + " ha" }) }, scales: { x: { grid: { color: "#edf1ed" }, ticks: { color: "#7c8a82", font: tickFont("x") } }, y: { grid: { display: false }, ticks: { color: "#7c8a82", font: tickFont("y") } } } };
  }
  function shortStandingRegionLabel(value) {
    const label = String(value || "").trim();
    const acronym = label.match(/\(([^)]+)\)\s*$/);
    if (acronym && acronym[1].trim().length <= 6) return acronym[1].trim();
    const numberedRegion = label.match(/^Region\s+([IVX]+(?:-[A-Z])?)/i);
    if (numberedRegion) return "Region " + numberedRegion[1].toUpperCase();
    return label.replace(/\s+Region$/i, "").trim() || label;
  }
  function standingDonutOptions(title) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: { display: true, position: "bottom", labels: { color: "#7c8a82", usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8, padding: 8, font: { family: CHART_UI_FONT_FAMILY, size: 9 } } },
        tooltip: chartTooltip({
          title: () => chartTooltipTitle(title),
          label: (context) => context.label + ": " + fmt(context.raw, 2) + " ha",
          afterLabel: (context) => {
            const total = (context.dataset.data || []).reduce((sum, value) => sum + (Number(value) || 0), 0);
            return "Share: " + (total ? ((Number(context.raw) || 0) / total * 100).toFixed(1) : "0.0") + "%";
          },
        }),
      },
    };
  }
  function replaceChart(key, canvas, config) { if (state.charts[key]) state.charts[key].destroy(); state.charts[key] = new Chart(canvas, config); }
  function renderStandingCharts() {
    const dataset = activeStandingDataset(); if (!dataset) return;
    const cropLabel = dataset.crop[0].toUpperCase() + dataset.crop.slice(1);
    const classKey = $("#standing-classification").value; const stageKey = $("#standing-stage").value; const rows = dataset.analysisRows; const chartStages = stageKey === "total" ? STAGES : STAGES.filter((item) => item[0] === stageKey); const byRegion = new Map();
    rows.forEach((row) => {
      const region = row.location.region || row.location.name;
      const values = byRegion.get(region) || chartStages.map(() => 0);
      chartStages.forEach(([stage], index) => { values[index] += standingMetric(row, classKey, stage); });
      byRegion.set(region, values);
    });
    const regions = [...byRegion.entries()].sort((a, b) => b[1].reduce((sum, value) => sum + value, 0) - a[1].reduce((sum, value) => sum + value, 0));
    const regionTotals = regions.map((item) => item[1].reduce((sum, value) => sum + value, 0));
    const regionChartInner = $(".standing-region-chart-inner");
    if (regionChartInner) regionChartInner.style.height = Math.max(300, regions.length * 24 + 72) + "px";
    const regionOptions = chartOptions("y", true); regionOptions.plugins.legend.labels.padding = 6; regionOptions.plugins.legend.labels.font = { family: CHART_UI_FONT_FAMILY, size: 8 }; regionOptions.scales.x.beginAtZero = true; regionOptions.scales.x.stacked = true; regionOptions.scales.y.stacked = true; regionOptions.scales.y.ticks.font = { family: CHART_UI_FONT_FAMILY, size: 9 }; regionOptions.scales.x.ticks.callback = (value) => formatChartAxisValue(value, chartAxisScale(regionTotals)); regionOptions.plugins.tooltip.mode = "index"; regionOptions.plugins.tooltip.intersect = false; regionOptions.plugins.tooltip.callbacks.label = (context) => context.dataset.label + ": " + fmt(context.raw, 2) + " ha"; regionOptions.plugins.tooltip.callbacks.footer = (items) => "Total: " + fmt(items.reduce((sum, item) => sum + (Number(item.raw) || 0), 0), 2) + " ha"; regionOptions.plugins.tooltip.footerColor = PRIMARY_GREEN_LIGHT; regionOptions.plugins.tooltip.footerFont = { family: CHART_DATA_FONT_FAMILY, size: 10, weight: "700" };
    replaceChart("region", $("#region-chart"), { type: "bar", data: { labels: regions.map((item) => shortStandingRegionLabel(item[0])), datasets: chartStages.map(([stage, label], index) => ({ label: label.replace(" / Seedling", "").replace("Maturity", "Maturing"), data: regions.map((item) => item[1][index]), backgroundColor: STANDING_STAGE_COLORS[STAGES.findIndex((entry) => entry[0] === stage)] || STANDING_STAGE_COLORS[index], borderRadius: 0, borderSkipped: false, barPercentage: .78, categoryPercentage: .82 })) }, options: regionOptions });
    const stages = STAGES.map((item) => [item[1], sumMetric(rows, (row) => standingMetric(row, classKey, item[0]))]);
    const classColors = dataset.crop === "corn" ? ["#f4b942", "#d7dee5"] : ["#2f8f70", "#6baed6", "#a7cf68"];
    $("#region-chart-title").textContent = cropLabel + " · Area by region";
    $("#stage-chart-title").textContent = cropLabel + " · Area by growth stage";
    $("#classification-chart-title").textContent = cropLabel + " · Area by classification";
    replaceChart("stage", $("#stage-chart"), { type: "doughnut", data: { labels: stages.map((item) => item[0].replace(" / Seedling", "").replace("Maturity", "Maturing")), datasets: [{ data: stages.map((item) => item[1]), backgroundColor: STANDING_STAGE_COLORS, borderColor: "#ffffff", borderWidth: 2 }] }, options: standingDonutOptions(cropLabel + " · Area by growth stage") });
    const classes = dataset.classes.map((item) => [item[1], sumMetric(rows, (row) => standingMetric(row, item[0], stageKey))]);
    replaceChart("classification", $("#classification-chart"), { type: "doughnut", data: { labels: classes.map((item) => item[0]), datasets: [{ data: classes.map((item) => item[1]), backgroundColor: classColors, borderColor: "#ffffff", borderWidth: 2 }] }, options: standingDonutOptions(cropLabel + " · Area by classification") });
  }

  async function handleGeneral(event) {
    event.preventDefault();
    try { showStatus("info", "Reading, matching locations, and checking totals locally…", "general", { persistent: true }); const result = await readFile($("#general-file")); await loadAllLookups(); state.general = parseGeneral(result.text.replace(/^\uFEFF/, ""), result.file.name); renderGeneralSummary(state.general); showValidation(state.general.validation, "general", state.general); const statusType = state.general.validation.state === "error" ? "error" : state.general.validation.state === "warning" ? "warning" : "success"; showStatus(statusType, validationStatusText(state.general.validation), "general"); if (state.general.validation.state !== "error") await renderDatasetMap("general"); }
    catch (error) { state.general = null; showStatus("error", error.message, "general"); showValidation(null, "general"); }
  }
  async function handleStanding(crop) {
    try {
      showStatus("info", "Reading, matching locations, and checking totals locally…", "standing", { persistent: true });
      const input = standingFileInput(crop); const result = await readFile(input); await loadAllLookups();
      const parsed = parseStanding(result.text.replace(/^\uFEFF/, ""), result.file.name, crop); parsed.file = result.file; const current = standingState();
      current[crop] = parsed; current.activeCrop = crop; applyStandingDefaultPalette(crop); syncStandingDatasetSelector(); renderStandingSummary(parsed);
      showValidation(parsed.validation, "standing", parsed);
      const statusType = parsed.validation.state === "error" ? "error" : parsed.validation.state === "warning" ? "warning" : "success";
      showStatus(statusType, (crop[0].toUpperCase() + crop.slice(1) + " · ") + validationStatusText(parsed.validation), "standing");
      if (parsed.validation.state !== "error") { $("#standing-analytics-content").classList.remove("is-hidden"); await renderDatasetMap("standing"); renderStandingCharts(); }
    } catch (error) {
      showStatus("error", error.message, "standing"); showValidation(null, "standing", { crop });
    }
  }
  async function switchStandingDataset(crop) {
    const dataset = standingDataset(crop); if (!dataset) return;
    const current = standingState(); current.activeCrop = crop; applyStandingDefaultPalette(crop); syncStandingDatasetSelector(); renderStandingSummary(dataset);
    showValidation(dataset.validation, "standing", dataset);
    if (dataset.validation.state === "error") { $("#standing-analytics-content").classList.add("is-hidden"); return; }
    showStatus("success", (crop[0].toUpperCase() + crop.slice(1) + " · ") + validationStatusText(dataset.validation), "standing"); $("#standing-analytics-content").classList.remove("is-hidden");
    await renderDatasetMap("standing"); renderStandingCharts();
  }
  function hasLoadedDataset(kind) {
    if (kind === "standing") return Boolean(state.standing?.corn || state.standing?.rice);
    if (kind === "hazards") return Boolean(state.hazards?.volcanoes?.some((volcano) => Number.isInteger(volcano.alert)) || state.hazards?.earthquakes?.length);
    return Boolean(state[kind]);
  }
  function clearMode(kind) {
    if (hasLoadedDataset(kind) && !window.confirm("Clear the uploaded " + (kind === "standing" ? "Standing Crops datasets" : "dataset") + "? This cannot be undone.")) return;
    if (kind === "hazards") { clearHazardsData(); return; }
    state[kind] = null; if (kind === "general") { $("#" + kind + "-form").reset(); updateFileDrop($("#" + kind + "-file")); } else { ["corn", "rice"].forEach(resetStandingCard); $("#standing-active-crop").value = "corn"; }
    setValidationButtonState(kind, false); $("#" + kind + "-summary").classList.add("is-hidden"); $("#" + kind + "-controls").classList.add("is-hidden"); showValidation(null, kind); showStatus("", "", kind);
    if (kind === "standing") syncStandingDatasetSelector();
    renderDefaultLegend(kind);
    if (kind === "general") {
      $("#general-legend-label").value = DEFAULT_GENERAL_LEGEND_LABEL;
      $("#general-unit").value = DEFAULT_GENERAL_UNIT;
      clearGeneralDataSummary();
    }
    clearBoundarySelection(kind + "-map", { closePopup: true });
    if (state.layers[kind + "-map"]) { state.maps[kind + "-map"].removeLayer(state.layers[kind + "-map"]); state.layers[kind + "-map"] = null; }
    setBoundaryVisibility(kind + "-map", null);
    if (kind === "standing") clearStandingDisplayedState();
    setMapEmptyState(kind + "-map", true);
  }
  function ensureMapBuilt(id) {
    if (!state.maps[id] && document.getElementById(id)) buildMap(id);
    return state.maps[id];
  }
  function syncHowToUseTrigger(isOpen) {
    const trigger = $("#how-to-use-trigger");
    if (!trigger) return;
    trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    trigger.classList.toggle("is-active", isOpen);
  }
  function showHowToUseOverview() {
    const overview = $("#how-to-use-overview");
    const detail = $("#how-to-use-detail");
    const back = $("#how-to-use-page-back");
    const openModule = $("#how-to-use-open-module");
    if (overview) overview.classList.remove("is-hidden");
    if (detail) detail.hidden = true;
    if (back) {
      back.setAttribute("aria-label", "Back to workspace");
      const backLabel = back.querySelector("[data-how-to-use-back-label]");
      if (backLabel) backLabel.textContent = "Back to workspace";
    }
    if (openModule) {
      openModule.hidden = true;
      openModule.removeAttribute("aria-label");
      delete openModule.dataset.module;
    }
    state.helpModule = "";
  }
  function focusHowToUseHeading() {
    const title = $("#how-to-use-title");
    if (!title) return;
    title.setAttribute("tabindex", "-1");
    title.focus({ preventScroll: true });
  }
  function howToUseVisualMarkup(item) {
    const visual = item.visual;
    if (visual === "csv-upload") return '<span class="how-to-use-guide-section__upload-preview" role="img" aria-label="Choose a CSV file upload area"><span class="how-to-use-guide-section__upload-preview-icon" aria-hidden="true">↑</span><span class="how-to-use-guide-section__upload-preview-copy"><strong>Choose a CSV file</strong><small>UTF-8 · maximum 5,000 rows and 5 MB</small></span></span>';
    if (visual === "validate-button") return '<span class="how-to-use-guide-section__validate-preview" role="img" aria-label="Validate button"><span class="how-to-use-guide-section__validate-preview-button">Validate</span></span>';
    if (visual === "update-map-button") return '<span class="how-to-use-guide-section__validate-preview" role="img" aria-label="Update map button"><span class="how-to-use-guide-section__validate-preview-button">Update map</span></span>';
    if (visual === "clear-button") return '<span class="how-to-use-guide-section__clear-preview" role="img" aria-label="Clear inputs button"><span class="how-to-use-guide-section__clear-preview-button">Clear inputs</span></span>';
    if (visual === "legend") return '<span class="how-to-use-guide-section__legend-preview" role="img" aria-label="Rendered map legend"><strong>Population</strong><small>Million</small><span class="how-to-use-guide-section__legend-preview-row"><i style="--legend-color:#b2182b"></i><span>400–1,000</span></span><span class="how-to-use-guide-section__legend-preview-row"><i style="--legend-color:#ef8a62"></i><span>100–400</span></span><span class="how-to-use-guide-section__legend-preview-row"><i style="--legend-color:#fddbc7"></i><span>&lt;100</span></span></span>';
    if (visual === "sample-map") return '<span class="how-to-use-guide-section__map-preview how-to-use-preview how-to-use-preview--general" role="img" aria-label="Sample rendered map with dummy data"><span class="how-to-use-preview__grid"></span><span class="how-to-use-preview__land how-to-use-preview__land--one"></span><span class="how-to-use-preview__land how-to-use-preview__land--two"></span><span class="how-to-use-guide-section__map-preview-land--three"></span><span class="how-to-use-guide-section__map-preview-value how-to-use-guide-section__map-preview-value--one">620</span><span class="how-to-use-guide-section__map-preview-value how-to-use-guide-section__map-preview-value--two">240</span><span class="how-to-use-guide-section__map-preview-value how-to-use-guide-section__map-preview-value--three">42</span><span class="how-to-use-guide-section__map-preview-legend"><span class="how-to-use-guide-section__map-preview-legend-title">Population · Million</span><span class="how-to-use-guide-section__map-preview-legend-row"><i style="--legend-color:#b2182b"></i><span>400–1,000</span></span><span class="how-to-use-guide-section__map-preview-legend-row"><i style="--legend-color:#ef8a62"></i><span>100–400</span></span><span class="how-to-use-guide-section__map-preview-legend-row"><i style="--legend-color:#fddbc7"></i><span>&lt;100</span></span></span></span>';
    if (visual === "reference-map") return '<figure class="how-to-use-guide-section__reference-image"><img src="' + mapAsset("assets/guide/boundary-map-reference.png") + '" alt="Reference example of a rendered boundary map with a legend"><figcaption>Reference: rendered boundary map with the selected metric and legend.</figcaption></figure>';
    if (visual === "reference-tooltip") return '<figure class="how-to-use-guide-section__reference-image how-to-use-guide-section__reference-image--tooltip"><img src="' + mapAsset("assets/guide/boundary-tooltip-reference.png") + '" alt="Reference example of a boundary tooltip for Nueva Ecija"><figcaption>Reference: click a boundary to view its location, level, PSGC code, metric, and value.</figcaption></figure>';
    if (visual === "column-summary-reference") return '<figure class="how-to-use-guide-section__reference-image how-to-use-guide-section__reference-image--actual how-to-use-guide-section__reference-image--column-summary"><span class="how-to-use-guide-section__reference-image-crop"><img src="' + mapAsset("assets/guide/column-summary-reference.png?v=20260831-step7-3") + '" alt="Actual Column Summary panel with a horizontal bar chart of uploaded CSV column totals"></span><figcaption>Actual Column Summary panel rendered by Map Studio.</figcaption></figure>';
    if (visual === "column-breakdown-reference") return '<figure class="how-to-use-guide-section__reference-image how-to-use-guide-section__reference-image--actual how-to-use-guide-section__reference-image--breakdown"><img src="' + mapAsset("assets/guide/column-breakdown-reference.png?v=20260831-step7-3") + '" alt="Actual Data Breakdown dialog with geographic rows and metric totals"><figcaption>Actual Data Breakdown dialog opened by View breakdown.</figcaption></figure>';
    if (visual === "standing-template-corn" || visual === "standing-template-rice") {
      const crop = visual.endsWith("corn") ? "corn" : "rice";
      const label = crop === "corn" ? "Corn" : "Rice";
      const columns = crop === "corn" ? "17 columns" : "22 columns";
      return '<span class="how-to-use-guide-section__template-preview" role="img" aria-label="' + label + ' Standing Crops template preview"><span class="how-to-use-guide-section__template-preview-icon"><img src="' + mapAsset("assets/crop-icons/" + crop + ".png") + '" alt=""></span><span><strong>' + label + ' Standing Crops Template</strong><small>' + columns + ' · two header rows · blank stage values</small></span></span>';
    }
    if (visual === "standing-template-headers") return '<span class="how-to-use-guide-section__header-preview" role="img" aria-label="Standing Crops two-row CSV header preview"><span><strong>Row 1 · groups</strong><small>YELLOW · WHITE · GRAND TOTAL</small></span><span><strong>Row 2 · measures</strong><small>Vegetative · Reproductive · Maturity · Total</small></span></span>';
    if (visual === "standing-upload-corn" || visual === "standing-upload-rice") {
      const crop = visual.endsWith("corn") ? "corn" : "rice";
      const label = crop === "corn" ? "Corn" : "Rice";
      const columns = crop === "corn" ? "17 columns" : "22 columns";
      return '<span class="how-to-use-guide-section__upload-preview how-to-use-guide-section__upload-preview--crop" role="img" aria-label="Choose ' + label + ' CSV upload area"><span class="how-to-use-guide-section__upload-preview-icon"><img src="' + mapAsset("assets/crop-icons/" + crop + ".png") + '" alt=""></span><span class="how-to-use-guide-section__upload-preview-copy"><strong>Choose ' + label.toLowerCase() + ' CSV</strong><small>' + columns + ' · UTF-8 · maximum 5,000 rows</small></span></span>';
    }
    if (visual === "validation-result") return '<span class="how-to-use-guide-section__validation-result-preview" role="img" aria-label="View result validation button and status"><span>View result</span><small>Checks · warnings · skipped rows</small></span>';
    if (visual === "standing-filters") return '<span class="how-to-use-guide-section__filters-preview" role="img" aria-label="Standing Crops map filters"><span><small>Commodity</small><strong>Corn⌄</strong></span><span><small>Map level</small><strong>Region⌄</strong></span><span><small>Classification</small><strong>All⌄</strong></span><span><small>Growth stage</small><strong>Total area⌄</strong></span></span>';
    if (visual === "standing-map") return '<span class="how-to-use-guide-section__map-preview how-to-use-preview how-to-use-preview--standing" role="img" aria-label="Sample Standing Crops map"><span class="how-to-use-preview__grid"></span><span class="how-to-use-preview__land how-to-use-preview__land--crop"></span><span class="how-to-use-guide-section__standing-map-land--two"></span><span class="how-to-use-guide-section__standing-map-legend"><i style="--legend-color:#ffffcc"></i><i style="--legend-color:#78c679"></i><i style="--legend-color:#31a354"></i></span></span>';
    if (visual === "standing-popup") return '<span class="how-to-use-guide-section__popup-preview" role="img" aria-label="Standing Crops boundary popup"><strong>Nueva Ecija</strong><small>Province / HUC</small><span><b>Classification</b> Yellow</span><span><b>Growth stage</b> Vegetative</span><span><b>Area</b> 1,240.00 ha</span></span>';
    if (visual === "standing-region-chart") return '<span class="how-to-use-guide-section__chart-preview" role="img" aria-label="Regional Breakdown stacked bar chart"><strong>Regional Breakdown · ha</strong><span class="how-to-use-guide-section__chart-preview-bars"><i style="--chart-height:86%"></i><i style="--chart-height:63%"></i><i style="--chart-height:48%"></i><i style="--chart-height:31%"></i><i style="--chart-height:20%"></i></span><small>Region III · Region II · CAR · Region I</small></span>';
    if (visual === "standing-donut-charts") return '<span class="how-to-use-guide-section__donut-preview" role="img" aria-label="Standing Crops growth-stage and classification donut charts"><span><i class="how-to-use-guide-section__donut-preview-ring how-to-use-guide-section__donut-preview-ring--stage"></i><small>Growth stage</small></span><span><i class="how-to-use-guide-section__donut-preview-ring how-to-use-guide-section__donut-preview-ring--class"></i><small>Classification</small></span></span>';
    if (visual === "hazard-alert-form") return '<span class="how-to-use-guide-section__hazard-form-preview" role="img" aria-label="Volcano alert level input preview"><span><b>Bulusan</b><strong>0</strong></span><span><b>Kanlaon</b><strong>1</strong></span><span><b>Mayon</b><strong>0</strong></span><span><b>Pinatubo</b><strong>0</strong></span><span><b>Taal</b><strong>0</strong></span><small>Alert levels as of · MMM DD, YYYY</small></span>';
    if (visual === "hazard-earthquake-upload") return '<span class="how-to-use-guide-section__upload-preview" role="img" aria-label="Choose earthquake CSV upload area"><span class="how-to-use-guide-section__upload-preview-icon" aria-hidden="true">↑</span><span class="how-to-use-guide-section__upload-preview-copy"><strong>Choose earthquake CSV</strong><small>Date · latitude · longitude · depth · magnitude · location</small></span></span>';
    if (visual === "hazard-map") return '<span class="how-to-use-guide-section__map-preview how-to-use-preview how-to-use-preview--hazards" role="img" aria-label="Sample volcano and earthquake hazard map"><span class="how-to-use-preview__grid"></span><span class="how-to-use-preview__island"></span><span class="how-to-use-preview__triangle"></span><span class="how-to-use-preview__quake how-to-use-preview__quake--one"></span><span class="how-to-use-preview__quake how-to-use-preview__quake--two"></span><span class="how-to-use-preview__legend"></span></span>';
    if (visual === "hazard-summary") return '<span class="how-to-use-guide-section__hazard-summary-preview" role="img" aria-label="Hazard Summary preview"><strong>Summary</strong><span><i style="--hazard-color:#72d84c"></i>Bulusan <b>No Alert</b></span><span><i style="--hazard-color:#ffd75b"></i>Kanlaon <b>Alert level 1</b></span><span class="how-to-use-guide-section__hazard-summary-total">Total events <b>12</b></span></span>';
    if (visual === "hazard-criteria") return '<span class="how-to-use-guide-section__criteria-preview" role="img" aria-label="Volcano monitoring criteria table preview"><span><b>Volcano / level</b><b>Monitoring criteria</b></span><span><strong>Mayon · Level 2</strong><small>Moderate unrest · magma may eventually lead to eruption.</small></span><span><strong>Taal · Level 1</strong><small>Abnormal parameters · no entry into the danger zone.</small></span></span>';
    if (visual === "psgc-search") return '<span class="how-to-use-guide-section__psgc-toolbar-preview" role="img" aria-label="PSGC reference search preview"><span><small>Search reference</small><strong>Code, location, region, or province</strong></span><span><small>Geographic level</small><strong>Region⌄</strong></span></span>';
    if (visual === "psgc-level-filter") return '<span class="how-to-use-guide-section__select-preview" role="img" aria-label="Geographic level filter"><small>Geographic level</small><strong>All levels⌄</strong></span>';
    if (visual === "psgc-hierarchy") return '<span class="how-to-use-guide-section__hierarchy-preview" role="img" aria-label="PSGC grouped hierarchy preview"><span><b>Region III</b><small>Central Luzon</small></span><span><b>Province / HUC</b><small>　Aurora</small></span><span><b>Municipality / City</b><small>　　 Baler</small></span></span>';
    if (visual === "psgc-table") return '<span class="how-to-use-guide-section__psgc-table-preview" role="img" aria-label="PSGC reference table preview"><span><b>PSGC Code</b><b>Location Name</b><b>Geographic Level</b></span><span><small>0300000000</small><small>Central Luzon</small><small>Region</small></span><span><small>0300100000</small><small>Aurora</small><small>Province</small></span><span><small>0300101000</small><small>Baler</small><small>Municipality</small></span></span>';
    return "";
  }
  function howToUsePopupPreviewMarkup(moduleKey) {
    const layerPreview = moduleKey === "standing"
      ? '<div class="map-studio-basemap-section"><strong class="map-studio-basemap-section__title">PAGASA Layers</strong><span class="map-studio-basemap-toggle-option"><span class="map-studio-basemap-toggle-option__label">TC track</span><span class="map-studio-basemap-toggle-option__state">Off</span></span><span class="map-studio-basemap-toggle-option"><span class="map-studio-basemap-toggle-option__label">TC buffer</span><span class="map-studio-basemap-toggle-option__state">Off</span></span></div>'
      : moduleKey === "hazards"
        ? '<div class="map-studio-basemap-section"><strong class="map-studio-basemap-section__title">Map legend</strong><span class="map-studio-basemap-toggle-option"><span class="map-studio-basemap-toggle-option__label">Legend</span><span class="map-studio-basemap-toggle-option__state">Visible</span></span></div>'
        : '<div class="map-studio-basemap-section"><span class="map-studio-basemap-toggle-option"><span class="map-studio-basemap-toggle-option__label">Affected Areas</span><span class="map-studio-basemap-toggle-option__state">No data</span></span></div><div class="map-studio-basemap-section"><span class="map-studio-basemap-toggle-option"><span class="map-studio-basemap-toggle-option__label">Boundary Labels</span><span class="map-studio-basemap-toggle-option__state">No data</span></span></div>';
    return '<div class="how-to-use-guide-section__popup-showcase" aria-label="Rendered map-control popup examples">' +
      '<div class="map-studio-theme-panel how-to-use-guide-section__actual-popup" role="img" aria-label="Background theme and color palette popup example"><strong class="map-studio-theme-title">Background</strong><div class="map-studio-theme-options"><span class="map-studio-theme-option" style="--theme-color:#c0e8ff" aria-pressed="true"></span><span class="map-studio-theme-option" style="--theme-color:#f7f7f7"></span><span class="map-studio-theme-option" style="--theme-color:#cccccc"></span><span class="map-studio-theme-option" style="--theme-color:#969696"></span><span class="map-studio-theme-option" style="--theme-color:#636363"></span><span class="map-studio-theme-option" style="--theme-color:#252525"></span></div><strong class="map-studio-theme-title map-studio-theme-title--palette">Color palette</strong><div class="map-studio-guide-palette-options"><span class="map-studio-palette-option" aria-pressed="true"><span class="map-studio-palette-preview"><span style="background:#eff3ff"></span><span style="background:#bdd7e7"></span><span style="background:#6baed6"></span><span style="background:#3182bd"></span><span style="background:#08519c"></span></span></span><span class="map-studio-palette-option"><span class="map-studio-palette-preview"><span style="background:#fee5d9"></span><span style="background:#fcae91"></span><span style="background:#fb6a4a"></span><span style="background:#de2d26"></span><span style="background:#a50f15"></span></span></span><span class="map-studio-palette-option"><span class="map-studio-palette-preview"><span style="background:#edf8e9"></span><span style="background:#bae4b3"></span><span style="background:#74c476"></span><span style="background:#31a354"></span><span style="background:#006d2c"></span></span></span></div></div>' +
      '<div class="map-studio-basemap-panel how-to-use-guide-section__actual-popup" role="img" aria-label="Basemap and map layers popup example"><strong class="map-studio-basemap-title">Basemap</strong><div class="map-studio-basemap-options"><span class="map-studio-basemap-option" aria-pressed="true"><span class="map-studio-basemap-option__label">Default</span></span><span class="map-studio-basemap-option"><span class="map-studio-basemap-option__label">OpenStreetMap</span></span><span class="map-studio-basemap-option"><span class="map-studio-basemap-option__label">Satellite</span></span></div><div class="map-studio-basemap-section"><strong class="map-studio-basemap-section__title">Legend position</strong><div class="map-studio-basemap-position-options"><span class="map-studio-basemap-position-option" aria-pressed="true">Bottom left</span><span class="map-studio-basemap-position-option">Upper left</span></div></div>' + layerPreview + '</div>' +
      '<div class="map-studio-export-panel how-to-use-guide-section__actual-popup" role="img" aria-label="Resize canvas popup example"><strong class="map-studio-export-title">Resize canvas</strong><div class="map-studio-export-actions map-studio-export-actions--top"><span class="map-studio-export-action">Reset canvas</span></div><div class="map-studio-export-options"><span class="map-studio-export-option" aria-pressed="true"><span class="map-studio-export-option__label">Canva Size</span><small class="map-studio-export-option__detail">1,150 × 1,600 px · 23:32</small></span><span class="map-studio-export-option"><span class="map-studio-export-option__label">Landscape</span><small class="map-studio-export-option__detail">2,400 × 1,800 px · 4:3</small></span><span class="map-studio-export-option"><span class="map-studio-export-option__label">Wide</span><small class="map-studio-export-option__detail">2,560 × 1,440 px · 16:9</small></span><span class="map-studio-export-option"><span class="map-studio-export-option__label">Square</span><small class="map-studio-export-option__detail">1,800 × 1,800 px · 1:1</small></span></div></div>' +
      '</div>';
  }
  function renderHowToUseDetail(moduleKey) {
    const guide = HOW_TO_USE_GUIDES[moduleKey] || HOW_TO_USE_GUIDES.general;
    const overview = $("#how-to-use-overview");
    const detail = $("#how-to-use-detail");
    const title = $("#how-to-use-detail-title");
    const intro = $("#how-to-use-detail-intro");
    const preview = $("#how-to-use-detail-preview");
    const content = $("#how-to-use-detail-content");
    const back = $("#how-to-use-page-back");
    const openModule = $("#how-to-use-open-module");
    if (!overview || !detail || !title || !intro || !preview || !content) return;
    const source = $(".how-to-use-card[data-how-to-use-module=\"" + moduleKey + "\"] .how-to-use-card__preview");
    overview.classList.add("is-hidden");
    detail.hidden = false;
    title.textContent = guide.title;
    intro.textContent = guide.intro;
    preview.className = "how-to-use-detail__preview how-to-use-preview how-to-use-preview--" + moduleKey;
    preview.innerHTML = source ? source.innerHTML : "";
    content.innerHTML = guide.sections.map((section) => {
      const sectionClass = "how-to-use-guide-section" + (section.layout ? " how-to-use-guide-section--" + esc(section.layout) : "");
      const items = section.items.map((item) => {
        const icon = item.icon && MAP_ICONS[item.icon] ? '<span class="how-to-use-guide-section__item-icon" aria-hidden="true">' + MAP_ICONS[item.icon] + '</span>' : "";
        const feedbackTone = { "validation-errors": "error", "validation-warnings": "warning", "validation-info": "info" }[item.type] || "";
        const visual = howToUseVisualMarkup(item);
        const messages = feedbackTone
          ? '<ul class="how-to-use-guide-section__validation-message-list is-' + feedbackTone + '">' + (item.messages || []).map((message) => '<li>' + esc(message) + '</li>').join("") + '</ul>'
          : '<span>' + esc(item.text) + '</span>' + visual;
        const itemClass = feedbackTone ? ' class="how-to-use-guide-section__validation-feedback is-' + feedbackTone + '"' : "";
        if (section.layout === "cards-3" && !feedbackTone) {
          const controlIcon = item.icon && MAP_ICONS[item.icon] ? MAP_ICONS[item.icon] : "";
          return '<li class="how-to-use-guide-section__control-card"><span class="how-to-use-guide-section__control-card-icon" aria-hidden="true">' + controlIcon + '</span><span class="how-to-use-guide-section__control-card-copy"><strong>' + esc(item.label) + '</strong><span class="how-to-use-guide-section__control-card-description">' + esc(item.text) + '</span></span></li>';
        }
        return '<li' + itemClass + '><strong>' + icon + esc(item.label) + '</strong>' + messages + '</li>';
      }).join("");
      const popupPreviews = section.popupPreviews ? howToUsePopupPreviewMarkup(section.popupPreviews === true ? "general" : section.popupPreviews) : "";
      return '<section class="' + sectionClass + '"><h4>' + esc(section.title) + '</h4><ul>' + items + '</ul>' + popupPreviews + '</section>';
    }).join("");
    if (back) {
      back.setAttribute("aria-label", "Back to guides");
      const backLabel = back.querySelector("[data-how-to-use-back-label]");
      if (backLabel) backLabel.textContent = "Back to guides";
    }
    if (openModule) {
      openModule.hidden = false;
      openModule.setAttribute("aria-label", "Go to " + guide.eyebrow);
      const openModuleLabel = openModule.querySelector("[data-how-to-use-open-module-label]");
      if (openModuleLabel) openModuleLabel.textContent = "Go to " + guide.eyebrow;
      openModule.dataset.module = moduleKey;
    }
    state.helpModule = moduleKey;
    title.setAttribute("tabindex", "-1");
    title.focus({ preventScroll: true });
  }
  function openHowToUse(moduleKey) {
    const guide = $("#how-to-use");
    if (!guide) return;
    if (state.currentMode !== "help") {
      state.helpReturnMode = state.currentMode || "general";
      state.helpReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    $$('[data-panel]').forEach((panel) => panel.classList.add("is-hidden"));
    modeControls().forEach((button) => { button.classList.remove("is-active"); button.removeAttribute("aria-current"); });
    guide.classList.remove("is-hidden");
    state.currentMode = "help";
    $("[data-current-workspace]")?.replaceChildren(document.createTextNode("How to use"));
    $("[data-map-studio-workspace-label]")?.replaceChildren(document.createTextNode("How to use"));
    syncHowToUseTrigger(true);
    showHowToUseOverview();
    if (moduleKey) renderHowToUseDetail(moduleKey);
    const scroll = guide.querySelector(".how-to-use-page__scroll");
    if (scroll) scroll.scrollTop = 0;
    if (!moduleKey) focusHowToUseHeading();
    if (window.matchMedia("(max-width: 960px)").matches) setSidebarOpen(false);
  }
  function closeHowToUse() {
    const returnFocus = state.helpReturnFocus;
    state.helpReturnFocus = null;
    syncHowToUseTrigger(false);
    switchMode(state.helpReturnMode || "general");
    if (returnFocus && document.contains(returnFocus)) window.setTimeout(() => returnFocus.focus({ preventScroll: true }), 0);
  }
  function handleHowToUseBack() {
    if (state.helpModule) {
      showHowToUseOverview();
      focusHowToUseHeading();
    }
    else closeHowToUse();
  }
  const modeControls = () => $$(".mode-tab, [data-map-studio-mode]");
  const modeControlValue = (button) => button.dataset.mode || button.dataset.mapStudioMode;
  function switchMode(mode) {
    const nextMode = ["general", "standing", "hazards", "psgc"].includes(mode) ? mode : "general";
    if (state.fullscreenMapId) toggleFullscreen(state.fullscreenMapId);
    state.currentMode = nextMode;
    $("#how-to-use")?.classList.add("is-hidden");
    syncHowToUseTrigger(false);
    modeControls().forEach((button) => {
      const isActive = modeControlValue(button) === nextMode;
      button.classList.toggle("is-active", isActive);
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    $$("[data-panel]").forEach((panel) => panel.classList.toggle("is-hidden", panel.dataset.panel !== nextMode));
    syncPanelHeaderDividers();
    const workspaceName = nextMode === "standing" ? "Standing Crops" : nextMode === "hazards" ? "Geologic Hazards" : nextMode === "psgc" ? "PSGC 2Q 2026" : "Boundary Mapping";
    $("[data-current-workspace]")?.replaceChildren(document.createTextNode(workspaceName));
    $("[data-map-studio-workspace-label]")?.replaceChildren(document.createTextNode(workspaceName));
    if (window.parent !== window) window.parent.postMessage({ type: "rrdbes-map-studio-mode-changed", mode: nextMode }, window.location.origin);
    if (window.matchMedia("(max-width: 960px)").matches) setSidebarOpen(false);
    // Build a map only after its workspace is visible and has had a layout
    // pass. Leaflet measures the container during initialization; constructing
    // it during the same synchronous class toggle can create a permanent 0×0
    // canvas even though the workspace later reports a non-zero DOM rect.
    if (nextMode !== "psgc") {
      const mapId = nextMode + "-map";
      const prepareMap = () => {
        const container = document.getElementById(mapId);
        if (!state.maps[mapId] && container && (container.clientWidth <= 0 || container.clientHeight <= 0)) {
          window.requestAnimationFrame(prepareMap);
          return;
        }
        ensureMapBuilt(mapId);
        const map = state.maps[mapId];
        if (!map) return;
        safeInvalidateMapSize(map);
        initializeBasePresentation(mapId);
        if (mapId === "hazards-map") renderHazardsMap();
        scheduleMapResize(mapId, !state.mapCanvasPresets[mapId]);
      };
      if (state.maps[mapId]) prepareMap();
      else window.requestAnimationFrame(prepareMap);
    }
    if (nextMode === "psgc") renderPsgcReference();
    try { localStorage.setItem(ACTIVE_MODE_STORAGE_KEY, nextMode); } catch (_) { /* storage unavailable */ }
    // Give the newly revealed workspace a layout pass before asking Leaflet
    // to measure it. A zero-delay callback can still run against the old
    // display:none geometry in Chromium, especially on the initial mode.
    Object.entries(state.maps).forEach(([mapId, map]) => setTimeout(() => {
      if (mapId === nextMode + "-map" && state.mapCanvasPresets[mapId]) applyMapCanvasPreset(mapId, state.mapCanvasPresets[mapId]);
      safeInvalidateMapSize(map); initializeBasePresentation(mapId); scheduleMapResize(mapId, mapId === nextMode + "-map" && !state.mapCanvasPresets[mapId]);
    }, 80));
  }

  function syncPanelHeaderDividers() {
    $$(".workspace:not(.is-hidden)").forEach((workspace) => {
      const headings = [
        workspace.querySelector(".control-panel .panel-heading"),
        workspace.querySelector(".data-summary-panel__heading"),
      ].filter((heading) => heading && heading.getClientRects().length);
      if (headings.length < 2) return;
      const titleRows = headings.map((heading) => heading.querySelector(":scope > .panel-title-row")).filter(Boolean);
      titleRows.forEach((row) => { row.style.height = "auto"; });
      const sharedTitleHeight = titleRows.length ? Math.max(...titleRows.map((row) => row.getBoundingClientRect().height)) : 0;
      if (Number.isFinite(sharedTitleHeight) && sharedTitleHeight > 0) titleRows.forEach((row) => { row.style.height = sharedTitleHeight + "px"; });
      headings.forEach((heading) => { heading.style.height = "auto"; });
      const sharedHeight = Math.max(...headings.map((heading) => heading.getBoundingClientRect().height));
      if (!Number.isFinite(sharedHeight) || sharedHeight <= 0) return;
      headings.forEach((heading) => { heading.style.height = sharedHeight + "px"; });
    });
  }

  function observePanelHeaderDividers() {
    const panels = $(".page-shell") ? $$(".workspace .control-panel, .workspace .data-summary-panel") : [];
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => window.requestAnimationFrame(syncPanelHeaderDividers));
      panels.forEach((panel) => observer.observe(panel));
    } else {
      window.addEventListener("resize", syncPanelHeaderDividers);
    }
    syncPanelHeaderDividers();
  }

  let initialMode = "general";
  try {
    const storedMode = localStorage.getItem(ACTIVE_MODE_STORAGE_KEY);
    if (["general", "standing", "hazards", "psgc"].includes(storedMode)) initialMode = storedMode;
  } catch (_) { /* storage unavailable */ }
  state.currentMode = initialMode;
  initializeSidebar();
  initializePrivacyReminder();
  setHazardsDateConstraint();
  updateHazardsDateDisplay();
  // General Map is the default visible workspace in the markup, so it can be
  // initialized immediately. Other modes are built by switchMode after their
  // panel has been revealed and laid out.
  if (initialMode === "general") ensureMapBuilt("general-map");
  $$(".file-drop input[type=file]").forEach((input) => input.addEventListener("change", () => handleFileSelection(input)));
  $("#boundary-template-download")?.addEventListener("click", openBoundaryTemplateDialog);
  $("#standing-template-download")?.addEventListener("click", openStandingTemplateDialog);
  $("#geopackage-download")?.addEventListener("click", openGeopackageDownloadDialog);
  $("#geopackage-download-confirm")?.addEventListener("click", downloadGeopackage);
  $("#earthquake-template-download")?.addEventListener("click", downloadEarthquakeTemplate);
  $("[data-how-to-use-open]")?.addEventListener("click", () => {
    if (state.currentMode === "help") {
      closeHowToUse();
      return;
    }
    const currentModule = ["general", "standing", "hazards", "psgc"].includes(state.currentMode) ? state.currentMode : "";
    openHowToUse(currentModule);
  });
  $("[data-how-to-use-close]")?.addEventListener("click", handleHowToUseBack);
  $$("[data-how-to-use-module]").forEach((button) => button.addEventListener("click", () => renderHowToUseDetail(button.dataset.howToUseModule)));
  $("#how-to-use-open-module")?.addEventListener("click", (event) => switchMode(event.currentTarget.dataset.module || "general"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.currentMode === "help") {
      event.preventDefault();
      closeHowToUse();
    }
  });
  $$('[data-geopackage-dialog-close]').forEach((button) => button.addEventListener("click", closeGeopackageDownloadDialog));
  $$('[data-standing-template-dialog-close]').forEach((button) => button.addEventListener("click", closeStandingTemplateDialog));
  $("#standing-template-confirm")?.addEventListener("click", () => downloadStandingTemplate($("input[name=\"standing-template-crop\"]:checked")?.value || "corn"));
  $$('[data-template-dialog-close]').forEach((button) => button.addEventListener("click", closeBoundaryTemplateDialog));
  $("#boundary-template-confirm")?.addEventListener("click", downloadBoundaryTemplate);
  $("#general-form").addEventListener("submit", handleGeneral);
  $("#hazards-form")?.addEventListener("submit", handleHazards);
  $("#hazards-as-of")?.addEventListener("input", updateHazardsDateDisplay);
  $("#hazards-as-of")?.addEventListener("change", updateHazardsDateDisplay);
  $("#hazards-earthquake-file")?.addEventListener("change", (event) => handleHazardsEarthquakeFileSelection(event.target));
  $("#hazards-clear-inputs")?.addEventListener("click", () => clearMode("hazards"));
  $("#general-summary-breakdown")?.addEventListener("click", openGeneralBreakdown);
  $("#general-breakdown-level")?.addEventListener("change", renderGeneralBreakdown);
  $("#general-breakdown-metrics-clear")?.addEventListener("click", (event) => {
    event.preventDefault();
    $("#general-breakdown-metrics")?.querySelectorAll("input[data-breakdown-metric]").forEach((input) => { input.checked = false; });
    renderGeneralBreakdown();
  });
  $("[data-general-breakdown-close]")?.addEventListener("click", () => $("#general-breakdown-dialog")?.close());
  $("#standing-summary-breakdown")?.addEventListener("click", openStandingBreakdown);
  $("#standing-breakdown-level")?.addEventListener("change", renderStandingBreakdown);
  $("#standing-breakdown-metrics-clear")?.addEventListener("click", (event) => {
    event.preventDefault();
    $("#standing-breakdown-metrics")?.querySelectorAll("input[data-standing-breakdown-metric]").forEach((input) => { input.checked = false; });
    renderStandingBreakdown();
  });
  $("[data-standing-breakdown-close]")?.addEventListener("click", () => $("#standing-breakdown-dialog")?.close());
  $$('dialog').forEach(enableDialogBackdropClose);
  $$('[data-standing-validate]').forEach((button) => button.addEventListener("click", () => handleStanding(button.dataset.standingValidate)));
  $("#general-level").addEventListener("change", () => state.general && renderDatasetMap("general")); $("#general-metric").addEventListener("change", () => state.general && renderDatasetMap("general"));
  ["general-legend-label", "general-unit"].forEach((id) => $("#" + id).addEventListener("input", () => state.general && renderDatasetMap("general")));
  $("#standing-active-crop").addEventListener("change", () => switchStandingDataset($("#standing-active-crop").value));
  ["standing-level", "standing-classification", "standing-stage"].forEach((id) => $("#" + id).addEventListener("change", async () => { if (!activeStandingDataset()) return; await renderDatasetMap("standing"); renderStandingCharts(); const dataset = activeStandingDataset(); $("#analytics-subtitle").textContent = dataset.crop[0].toUpperCase() + dataset.crop.slice(1) + " · " + dataset.analysisRows.length + " " + levelLabel($("#standing-level").value).toLowerCase() + " rows"; }));
  $("#psgc-reference-search-input")?.addEventListener("input", renderPsgcReference);
  $("#psgc-reference-level-select")?.addEventListener("change", renderPsgcReference);
  $(".psgc-reference-table-wrap")?.addEventListener("scroll", schedulePsgcReferenceStickyRows, { passive: true });
  modeControls().forEach((button) => button.addEventListener("click", () => switchMode(modeControlValue(button)))); $$("[data-clear]").forEach((button) => button.addEventListener("click", () => clearMode(button.dataset.clear)));
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "rrdbes-map-studio-mode") return;
    switchMode(event.data.mode);
  });
  document.addEventListener("click", (event) => {
    const insidePanel = event.target.closest(".map-studio-control-rail, .map-studio-theme-control, .map-studio-basemap-control, .map-studio-theme-panel, .map-studio-basemap-panel, .map-studio-export-control, .map-studio-export-panel");
    if (!insidePanel) closeMapPanels();
  });
  window.addEventListener("resize", () => {
    syncPanelHeaderDividers();
    Object.entries(state.mapControls).forEach(([mapId, controls]) => {
      scheduleExportPanelPosition(mapId);
      if (!controls.themePanel.hidden) scheduleMobileControlPanelPosition(mapId, controls.themePanel);
      if (!controls.basemapPanel.hidden) scheduleMobileControlPanelPosition(mapId, controls.basemapPanel);
    });
  });
  document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; closeMapPanels(); if (state.fullscreenMapId) toggleFullscreen(state.fullscreenMapId); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const pagasa = state.pagasa["standing-map"];
    if (pagasa && (pagasa.active.has("track") || pagasa.active.has("buffer"))) refreshPagasaTrack("standing-map", false);
  });
  observePanelHeaderDividers();
  switchMode(initialMode);
})();
