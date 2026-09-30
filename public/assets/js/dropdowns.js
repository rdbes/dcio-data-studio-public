/* Shared outside-click behavior for dropdowns and map control popovers. */
(function () {
    "use strict";

    const selector = [
        "details.platform-app-switcher",
        "[data-sidebar-shell] details.group",
        "details.sidebar-bottom-nav",
        "details[data-analytics-filter-panel]",
        "details[data-filter-dropdown]",
        "details[data-period-dropdown]",
        "details[data-report-filter-dropdown]",
        "details.tc-tracks-catalogue-filters",
        "details.bulletin-page-menu",
        "details.data-breakdown-multi-dropdown"
    ].join(",");

    const mapPopoverSelector = [
        "[data-map-control-popover]",
        "#map-boundary-panel",
        "#map-level-panel",
        "#map-metric-panel",
        "#map-style-panel",
        "#map-resize-menu"
    ].join(",");

    const mapControlSelector = [
        "[data-map-boundary-control]",
        "[data-map-level-control]",
        "[data-map-metric-control]",
        "[data-map-style-control]",
        "[data-map-resize-control]",
        ".drought-map-product-control",
        ".map-studio-theme-control",
        ".map-studio-basemap-control",
        ".map-studio-export-control"
    ].join(",");

    function dropdowns() {
        return Array.from(document.querySelectorAll(selector));
    }

    function syncExpandedState(dropdown) {
        dropdown.querySelector(":scope > summary")?.setAttribute(
            "aria-expanded",
            String(dropdown.open)
        );
    }

    function closeOutside(target) {
        const isTropicalCycloneTrackPage = target instanceof Element
            && target.closest("[data-tc-tracks-page]");

        dropdowns().forEach(function (dropdown) {
            if (
                isTropicalCycloneTrackPage
                && dropdown.matches("[data-sidebar-shell] details.group")
            ) {
                return;
            }
            if (dropdown.open && !dropdown.contains(target)) {
                dropdown.removeAttribute("open");
                syncExpandedState(dropdown);
            }
        });
    }

    function mapPopovers() {
        return Array.from(document.querySelectorAll(mapPopoverSelector));
    }

    function mapPopoverContainer(panel) {
        const directContainer = panel.closest(mapControlSelector);
        if (directContainer) return directContainer;

        const trigger = mapPopoverTrigger(panel);
        return (
            trigger?.closest(mapControlSelector)
            || trigger?.parentElement
            || panel.parentElement
        );
    }

    function mapPopoverIsOpen(panel) {
        return !panel.hidden && !panel.classList.contains("hidden");
    }

    function mapPopoverTrigger(panel) {
        const id = panel.id;
        if (!id) return null;

        return Array.from(document.querySelectorAll("[aria-controls]")).find(
            function (control) {
                return control.getAttribute("aria-controls") === id;
            }
        ) || null;
    }

    function closeMapPopover(panel) {
        const usesHiddenAttribute = panel.matches(
            "[data-map-resize-menu], .map-studio-theme-panel, "
            + ".map-studio-basemap-panel, .map-studio-export-panel"
        ) || panel.dataset.mapControlUsesHidden === "true";

        if (usesHiddenAttribute) {
            panel.hidden = true;
        } else {
            panel.classList.add("hidden");
        }

        if (panel.dataset.mapControlUsesHidden === "true") {
            panel.classList.add("hidden");
        }
        if (panel.matches("[data-map-resize-menu]")) {
            panel.dataset.open = "false";
            mapPopoverTrigger(panel)?.classList.remove("is-open");
        }
        mapPopoverTrigger(panel)?.setAttribute("aria-expanded", "false");
    }

    function closeMapPopoversOutside(target) {
        mapPopovers().forEach(function (panel) {
            const container = mapPopoverContainer(panel);
            if (
                mapPopoverIsOpen(panel)
                && container
                && !panel.contains(target)
                && !container.contains(target)
            ) {
                closeMapPopover(panel);
            }
        });
    }

    dropdowns().forEach(function (dropdown) {
        syncExpandedState(dropdown);
        dropdown.addEventListener("toggle", function () {
            syncExpandedState(dropdown);
        });
    });

    document.addEventListener("click", function (event) {
        if (!(event.target instanceof Node)) return;
        closeOutside(event.target);
        closeMapPopoversOutside(event.target);
    });

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        dropdowns().forEach(function (dropdown) {
            if (dropdown.open) {
                dropdown.removeAttribute("open");
                syncExpandedState(dropdown);
            }
        });
        mapPopovers().forEach(function (panel) {
            if (mapPopoverIsOpen(panel)) {
                closeMapPopover(panel);
            }
        });
    });
}());
