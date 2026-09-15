/* Establish the persisted sidebar state before the application shell renders. */
(function () {
    "use strict";

    var desktop = window.matchMedia("(min-width: 1280px)").matches;
    var open = desktop;

    try {
        var stored = window.localStorage.getItem("dcio.sidebarOpen");
        open = desktop && (stored === null || stored === "true");
    } catch (error) {
        open = desktop;
    }

    document.documentElement.dataset.sidebarOpen = open ? "true" : "false";
}());
