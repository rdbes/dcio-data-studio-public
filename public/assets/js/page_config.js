/* Bridge server-rendered page configuration into the existing map modules. */
(function () {
    "use strict";

    var cycloneConfig = document.querySelector("[data-tc-map-config]");
    if (cycloneConfig) {
        window.DATA_STUDIO_PHILIPPINES_GEOJSON_URL = cycloneConfig.dataset.provincesUrl;
        window.DATA_STUDIO_PHILIPPINES_OUTLINE_URL = cycloneConfig.dataset.outlineUrl;
    }

    var damageConfig = document.querySelector("[data-damage-losses-config]");
    if (damageConfig) {
        window.ADD_DAMAGE_LOSSES_INCIDENT_OPTIONS_URL = damageConfig.dataset.incidentOptionsUrl;
        window.ADD_PROVINCES_GEOJSON_URL = damageConfig.dataset.provincesUrl;
        window.ADD_PHILIPPINES_OUTLINE_GEOJSON_URL = damageConfig.dataset.outlineUrl;
    }
}());
