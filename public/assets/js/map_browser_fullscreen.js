(function () {
    "use strict";

    const changeEventName = "add:map-browser-fullscreen-change";
    const bodyClass = "add-map-browser-fullscreen-open";
    const mapControlOpenEventName = "add:map-control-open";

    function initializeMapBrowserFullscreen() {
        const mapCanvasCard = document.querySelector(
            "[data-map-canvas-card]"
        );
        const fullscreenButton = document.getElementById(
            "map-fullscreen"
        );
        const fullscreenIcon = fullscreenButton?.querySelector(
            "[data-map-fullscreen-icon]"
        );
        const resizeButton = document.getElementById("map-resize");
        const resizeIcon = resizeButton?.querySelector(
            "[data-map-resize-icon]"
        );
        const resizeMenu = document.querySelector(
            "[data-map-resize-menu]"
        );
        const resizeControl = resizeButton?.closest(
            "[data-map-resize-control]"
        );
        const resetResizeButton = resizeMenu?.querySelector(
            "[data-map-resize-reset]"
        );
        const presetButtons = Array.from(
            resizeMenu?.querySelectorAll("[data-map-resize-preset]") || []
        );

        if (
            !mapCanvasCard
            || (!fullscreenButton && !resizeButton)
            || fullscreenButton?.dataset.mapBrowserFullscreenReady === "true"
        ) {
            return;
        }

        if (fullscreenButton) {
            fullscreenButton.dataset.mapBrowserFullscreenReady = "true";
        }

        const initialCanvasStyle = {
            cssText: mapCanvasCard.style.cssText,
            width: mapCanvasCard.style.width,
            height: mapCanvasCard.style.height,
            minWidth: mapCanvasCard.style.minWidth,
            minHeight: mapCanvasCard.style.minHeight,
            maxWidth: mapCanvasCard.style.maxWidth,
            maxHeight: mapCanvasCard.style.maxHeight
        };

        function fitPresetToWorkspace(width, height) {
            const parent = mapCanvasCard.parentElement;
            const cardRect = mapCanvasCard.getBoundingClientRect();
            const viewportWidth = window.innerWidth
                || document.documentElement.clientWidth
                || width;
            const viewportHeight = window.innerHeight
                || document.documentElement.clientHeight
                || height;
            const compactViewport = viewportWidth < 1024;
            const availableWidth = Math.max(
                1,
                Math.min(
                    parent?.getBoundingClientRect().width || cardRect.width || width,
                    viewportWidth - 24
                )
            );
            const availableHeight = Math.max(
                240,
                Math.min(
                    compactViewport ? 640 : 832,
                    viewportHeight - cardRect.top - 48
                )
            );
            const scale = Math.min(
                1,
                availableWidth / width,
                availableHeight / height
            );

            return {
                width: Math.max(1, Math.floor(width * scale)),
                height: Math.max(1, Math.floor(height * scale))
            };
        }

        function mapFillsBrowserWindow() {
            return mapCanvasCard.dataset.mapFullscreen === "true";
        }

        function closeApplicationSidebar() {
            if (
                document.documentElement.dataset.sidebarOpen !== "true"
            ) {
                return;
            }

            document.querySelector("[data-sidebar-toggle]")?.click();
        }

        function syncFullscreenControl(expanded) {
            const label = expanded
                ? "Exit browser-window map view"
                : "Expand map to browser window";

            mapCanvasCard.dataset.mapFullscreen = expanded
                ? "true"
                : "false";
            document.body.classList.toggle(bodyClass, expanded);

            if (fullscreenButton) {
                fullscreenButton.setAttribute("aria-label", label);
                fullscreenButton.setAttribute(
                    "aria-pressed",
                    expanded ? "true" : "false"
                );
                fullscreenButton.title = label;
            }

            fullscreenIcon?.classList.toggle("fa-expand", !expanded);
            fullscreenIcon?.classList.toggle("fa-compress", expanded);
        }

        function syncResizeControl(resized) {
            const label = resized ? "Restore map size" : "Resize map canvas";

            mapCanvasCard.dataset.mapResized = resized ? "true" : "false";
            resizeButton?.setAttribute("aria-label", label);
            resizeButton?.setAttribute(
                "aria-pressed",
                resized ? "true" : "false"
            );
            if (resizeButton) {
                resizeButton.title = label;
            }

            resizeIcon?.classList.toggle(
                "fa-up-right-and-down-left-from-center",
                !resized
            );
            resizeIcon?.classList.toggle("fa-compress", resized);
        }

        function syncResizeMenu(open) {
            if (!resizeMenu || !resizeButton) {
                return;
            }

            resizeMenu.hidden = !open;
            resizeMenu.dataset.open = open ? "true" : "false";
            resizeButton.setAttribute(
                "aria-expanded",
                open ? "true" : "false"
            );
            resizeButton.classList.toggle("is-open", open);
        }

        function syncPresetButtons(activePreset) {
            presetButtons.forEach(function (button) {
                const selected = button.dataset.mapResizePreset === activePreset;
                button.setAttribute("aria-pressed", selected ? "true" : "false");
                button.dataset.selected = selected ? "true" : "false";
            });
        }

        function notifyMapResize() {
            // Leaflet and the shared map ResizeObservers listen to the browser
            // resize event. Two frames allow fixed canvas dimensions to settle
            // before those observers recalculate their viewport.
            window.dispatchEvent(new Event("resize"));
            const scheduleFrame = window.requestAnimationFrame
                || function (callback) {
                    callback();
                };
            scheduleFrame(function () {
                window.dispatchEvent(new Event("resize"));
            });
        }

        function resetCanvas() {
            mapCanvasCard.style.cssText = initialCanvasStyle.cssText;
            mapCanvasCard.style.width = initialCanvasStyle.width;
            mapCanvasCard.style.height = initialCanvasStyle.height;
            mapCanvasCard.style.minWidth = initialCanvasStyle.minWidth;
            mapCanvasCard.style.minHeight = initialCanvasStyle.minHeight;
            mapCanvasCard.style.maxWidth = initialCanvasStyle.maxWidth;
            mapCanvasCard.style.maxHeight = initialCanvasStyle.maxHeight;
            delete mapCanvasCard.dataset.mapResizePreset;
            syncPresetButtons("");
            syncResizeControl(false);
            syncResizeMenu(false);
            notifyMapResize();
        }

        function applyPreset(button) {
            const presetWidth = Number(button.dataset.mapResizeWidth);
            const presetHeight = Number(button.dataset.mapResizeHeight);
            const preset = button.dataset.mapResizePreset;

            if (
                !Number.isFinite(presetWidth)
                || !Number.isFinite(presetHeight)
                || presetWidth <= 0
                || presetHeight <= 0
            ) {
                return;
            }

            // Preset values describe the intended export aspect ratio. Fit
            // that ratio to the live workspace so a 1,600px export height
            // cannot turn the in-page map into a vertically overflowing card.
            const displaySize = fitPresetToWorkspace(
                presetWidth,
                presetHeight
            );
            mapCanvasCard.style.width = `${displaySize.width}px`;
            mapCanvasCard.style.height = `${displaySize.height}px`;
            mapCanvasCard.style.minWidth = `${displaySize.width}px`;
            mapCanvasCard.style.minHeight = `${displaySize.height}px`;
            mapCanvasCard.style.maxWidth = "100%";
            mapCanvasCard.style.maxHeight = "none";
            mapCanvasCard.dataset.mapResizePreset = preset;
            syncPresetButtons(preset);
            syncResizeControl(true);
            notifyMapResize();
        }

        let presetFitFrame = null;

        function refitActivePreset() {
            const activePreset = mapCanvasCard.dataset.mapResizePreset;
            const activeButton = presetButtons.find(function (button) {
                return button.dataset.mapResizePreset === activePreset;
            });

            if (!activeButton || mapFillsBrowserWindow()) {
                return;
            }

            const presetWidth = Number(activeButton.dataset.mapResizeWidth);
            const presetHeight = Number(activeButton.dataset.mapResizeHeight);
            if (
                !Number.isFinite(presetWidth)
                || !Number.isFinite(presetHeight)
                || presetWidth <= 0
                || presetHeight <= 0
            ) {
                return;
            }

            const displaySize = fitPresetToWorkspace(
                presetWidth,
                presetHeight
            );
            mapCanvasCard.style.width = `${displaySize.width}px`;
            mapCanvasCard.style.height = `${displaySize.height}px`;
            mapCanvasCard.style.minWidth = `${displaySize.width}px`;
            mapCanvasCard.style.minHeight = `${displaySize.height}px`;
        }

        function setMapBrowserFullscreen(expanded) {
            const nextExpanded = Boolean(expanded);
            if (mapFillsBrowserWindow() === nextExpanded) {
                return;
            }

            if (nextExpanded) {
                closeApplicationSidebar();
            }

            syncFullscreenControl(nextExpanded);
            document.dispatchEvent(
                new CustomEvent(changeEventName, {
                    detail: { expanded: nextExpanded }
                })
            );
        }

        fullscreenButton?.addEventListener("click", function () {
            setMapBrowserFullscreen(!mapFillsBrowserWindow());
        });

        resizeButton?.addEventListener("click", function () {
            const nextOpen = resizeMenu?.hidden !== false;
            if (nextOpen) {
                document.dispatchEvent(
                    new CustomEvent(mapControlOpenEventName, {
                        detail: { source: "resize" }
                    })
                );
            }
            syncResizeMenu(nextOpen);
        });

        resetResizeButton?.addEventListener("click", resetCanvas);
        presetButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                applyPreset(button);
            });
        });

        window.addEventListener("resize", function () {
            if (
                !mapCanvasCard.dataset.mapResizePreset
                || presetFitFrame !== null
            ) {
                return;
            }

            const scheduleFrame = window.requestAnimationFrame
                || function (callback) {
                    callback();
                };
            presetFitFrame = scheduleFrame(function () {
                presetFitFrame = null;
                refitActivePreset();
            });
        });

        document.addEventListener("click", function (event) {
            if (
                resizeMenu?.hidden === false
                && !resizeControl?.contains(event.target)
            ) {
                syncResizeMenu(false);
            }
        });

        document.addEventListener(
            mapControlOpenEventName,
            function (event) {
                if (event.detail?.source !== "resize") {
                    syncResizeMenu(false);
                }
            }
        );

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") {
                return;
            }

            if (resizeMenu?.hidden === false) {
                syncResizeMenu(false);
                resizeButton?.focus();
                return;
            }

            if (mapFillsBrowserWindow()) {
                setMapBrowserFullscreen(false);
                fullscreenButton?.focus();
            }
        });

        syncFullscreenControl(false);
        syncResizeControl(false);
        syncPresetButtons("");
        syncResizeMenu(false);
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initializeMapBrowserFullscreen,
            { once: true }
        );
    } else {
        initializeMapBrowserFullscreen();
    }
})();
