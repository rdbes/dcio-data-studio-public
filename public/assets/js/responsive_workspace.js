/* Compact map tools and chart ticks without changing the underlying data. */
(function () {
    "use strict";
    const compact = window.matchMedia("(max-width: 1023px)");
    function initializeMapControlToggles() {
        document.querySelectorAll("[data-map-canvas-card]").forEach((card, index) => {
            if (card.querySelector("[data-map-controls-toggle]")) return;

            const svtrToolbar = card.querySelector(":scope [data-svtr-toolbar-controls]");
            const controlGroups = svtrToolbar
                ? [svtrToolbar]
                : Array.from(card.querySelectorAll(
                    ":scope [data-map-control-rail], :scope [data-map-export-controls]"
                ));
            if (!controlGroups.length) return;

            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "ui-icon-button ui-map-icon-button map-canvas-controls-toggle";
            toggle.dataset.mapControlsToggle = "true";
            toggle.setAttribute("aria-pressed", "true");
            toggle.setAttribute("aria-label", "Hide map controls");
            toggle.title = "Hide map controls";
            toggle.innerHTML = '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';

            const controlIds = controlGroups.map((group, groupIndex) => {
                if (!group.id) group.id = `map-canvas-controls-${index}-${groupIndex}`;
                return group.id;
            });
            toggle.setAttribute("aria-controls", controlIds.join(" "));

            let hidden = false;
            function render() {
                card.dataset.mapControlsHidden = String(hidden);
                toggle.setAttribute("aria-pressed", String(!hidden));
                toggle.setAttribute("aria-label", hidden ? "Show map controls" : "Hide map controls");
                toggle.title = hidden ? "Show map controls" : "Hide map controls";
                toggle.innerHTML = `<i class="fa-solid ${hidden ? "fa-eye" : "fa-eye-slash"}" aria-hidden="true"></i>`;
            }

            toggle.addEventListener("click", event => {
                event.stopPropagation();
                hidden = !hidden;
                render();
            });
            (svtrToolbar || card).append(toggle);
            render();
        });
    }
    function initialize() {
        initializeMapControlToggles();
        document.querySelectorAll("[data-map-control-rail]").forEach((rail, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "map-tools-disclosure";
            button.innerHTML = '<i class="fa-solid fa-sliders" aria-hidden="true"></i><span>Tools</span>';
            const controls = Array.from(rail.children);
            controls.forEach((control, childIndex) => {
                if (!control.id) control.id = `map-tools-${index}-${childIndex}`;
            });
            button.setAttribute("aria-controls", controls.map(control => control.id).join(" "));
            rail.prepend(button);
            let expanded = false;
            function render() {
                rail.dataset.toolsCollapsed = String(compact.matches && !expanded);
                button.setAttribute("aria-expanded", String(!compact.matches || expanded));
                button.setAttribute("aria-label", expanded ? "Hide map tools" : "Show map tools");
            }
            button.addEventListener("click", event => {
                event.stopPropagation();
                expanded = !expanded;
                render();
            });
            rail.addEventListener("keydown", event => {
                if (event.key === "Escape" && compact.matches && expanded) {
                    expanded = false;
                    render();
                    button.focus();
                }
            });
            compact.addEventListener("change", render);
            render();
        });
        if (!window.Chart) return;
        window.Chart.register({
            id: "compactWorkspaceTicks",
            afterBuildTicks(chart, {scale}) {
                // Keep all plotted observations; thin only crowded category labels.
                if (chart.width >= 1024 || scale.axis !== "x" || scale.type !== "category") return;
                const ticks = scale.ticks;
                const capacity = Math.max(2, Math.floor(chart.width / 48));
                if (ticks.length <= capacity) return;
                const stride = Math.ceil((ticks.length - 1) / (capacity - 1));
                scale.ticks = ticks.filter((tick, index) => index % stride === 0 && index < ticks.length - stride / 2 || index === ticks.length - 1);
            }
        });
        Object.values(window.Chart.instances).forEach(chart => chart.update("none"));
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, {once: true});
    else initialize();
})();
