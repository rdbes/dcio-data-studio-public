(function () {
    "use strict";

    function deepFreeze(value) {
        if (
            !value
            || typeof value !== "object"
            || Object.isFrozen(value)
        ) {
            return value;
        }

        Object.values(value).forEach(deepFreeze);
        return Object.freeze(value);
    }

    function themeColor(propertyName, fallback) {
        if (
            !window.getComputedStyle
            || !window.document?.documentElement
        ) {
            return fallback;
        }

        return (
            window.getComputedStyle(
                window.document.documentElement
            ).getPropertyValue(propertyName).trim()
            || fallback
        );
    }

    function mappingRamp(tokenName, fallbackColors) {
        return fallbackColors.map(function (fallback, index) {
            return themeColor(
                `--map-${tokenName}-${index + 1}`,
                fallback
            );
        });
    }

    const noDataColor = themeColor("--map-no-data", "transparent");
    const boundaryOutlineColor = themeColor(
        "--map-boundary-outline",
        "#fcfcfa"
    );

    const palettes = deepFreeze({
        singleGreen: {
            accent: themeColor("--map-green-4", "#31A354"),
            colors: mappingRamp("green", [
                "#EDF8E9", "#BAE4B3", "#74C476",
                "#31A354", "#006D2C"
            ])
        },
        red: {
            accent: themeColor("--map-red-4", "#DE2D26"),
            colors: mappingRamp("red", [
                "#FEE5D9", "#FCAE91", "#FB6A4A",
                "#DE2D26", "#A50F15"
            ])
        },
        blue: {
            accent: themeColor("--map-blue-4", "#3182BD"),
            colors: mappingRamp("blue", [
                "#EFF3FF", "#BDD7E7", "#6BAED6",
                "#3182BD", "#08519C"
            ])
        },
        purple: {
            accent: themeColor("--map-purple-4", "#756BB1"),
            colors: mappingRamp("purple", [
                "#F2F0F7", "#CBC9E2", "#9E9AC8",
                "#756BB1", "#54278F"
            ])
        },
        orange: {
            accent: themeColor("--map-orange-4", "#E6550D"),
            colors: mappingRamp("orange", [
                "#FEEDDE", "#FDBE85", "#FD8D3C",
                "#E6550D", "#A63603"
            ])
        },
        gray: {
            accent: themeColor("--map-gray-4", "#636363"),
            colors: mappingRamp("gray", [
                "#F7F7F7", "#CCCCCC", "#969696",
                "#636363", "#252525"
            ])
        },
        ylgn: {
            accent: themeColor("--map-ylgn-4", "#31A354"),
            colors: mappingRamp("ylgn", [
                "#FFFFCC", "#C2E699", "#78C679",
                "#31A354", "#006837"
            ])
        },
        gnbu: {
            accent: themeColor("--map-gnbu-4", "#43A2CA"),
            colors: mappingRamp("gnbu", [
                "#F0F9E8", "#BAE4BC", "#7BCCC4",
                "#43A2CA", "#0868AC"
            ])
        },
        ylgnbu: {
            accent: themeColor("--map-ylgnbu-4", "#2C7FB8"),
            colors: mappingRamp("ylgnbu", [
                "#FFFFCC", "#A1DAB4", "#41B6C4",
                "#2C7FB8", "#253494"
            ])
        },
        ylorrd: {
            accent: themeColor("--map-ylorrd-4", "#F03B20"),
            colors: mappingRamp("ylorrd", [
                "#FFFFB2", "#FECC5C", "#FD8D3C",
                "#F03B20", "#BD0026"
            ])
        },
        ylorbr: {
            accent: themeColor("--map-ylorbr-4", "#D95F0E"),
            colors: mappingRamp("ylorbr", [
                "#FFFFD4", "#FED98E", "#FE9929",
                "#D95F0E", "#993404"
            ])
        },
        pubugn: {
            accent: themeColor("--map-pubugn-4", "#1C9099"),
            colors: mappingRamp("pubugn", [
                "#F6EFF7", "#BDC9E1", "#67A9CF",
                "#1C9099", "#016C59"
            ])
        }
    });

    // Keep persisted palette selections readable after the FARM ramp rename.
    const paletteAliases = deepFreeze({
        yellow: "ylorrd",
        green: "ylgn"
    });

    function normalizePaletteKey(value, fallback) {
        const normalized = paletteAliases[value] || value;
        if (palettes[normalized]) {
            return normalized;
        }
        return palettes[fallback] ? fallback : "blue";
    }

    const backgrounds = deepFreeze({
        sky: {
            color: "#c0e8ff",
            overviewColor: "#4f9fc8",
            controlColor: "#0284c7",
            gridColor: "#e0f2fe",
            cartographyColor: "#075985",
            cartographySecondaryColor: "#ffffff",
            tone: "light"
        },
        lightest: {
            color: "#f7f7f7",
            controlColor: "#969696",
            gridColor: "#cccccc",
            cartographyColor: "#52525b",
            cartographySecondaryColor: "#ffffff",
            tone: "light"
        },
        light: {
            color: "#cccccc",
            controlColor: "#cccccc",
            gridColor: "#f7f7f7",
            cartographyColor: "#52525b",
            cartographySecondaryColor: "#ffffff",
            tone: "light"
        },
        medium: {
            color: "#969696",
            controlColor: "#969696",
            gridColor: "#cccccc",
            cartographyColor: "#3f3f46",
            cartographySecondaryColor: "#ffffff",
            tone: "light"
        },
        dark: {
            color: "#636363",
            controlColor: "#636363",
            gridColor: "#969696",
            cartographyColor: "#f4f4f5",
            cartographySecondaryColor: "#52525b",
            tone: "dark"
        },
        darkest: {
            color: "#252525",
            overviewColor: "#636363",
            controlColor: "#252525",
            gridColor: "#636363",
            cartographyColor: "#f4f4f5",
            cartographySecondaryColor: "#52525b",
            tone: "dark"
        }
    });

    const interfaceThemes = deepFreeze({
        light: {
            surface: "rgba(255, 255, 255, 0.84)",
            popupSurface: "rgba(255, 255, 255, 0.56)",
            popupSurfaceOpaque: "#ffffff",
            legendSurface: "transparent",
            glassHover: "rgba(255, 255, 255, 0.72)",
            surfaceHover: "#ffffff",
            text: "#3f3f46",
            muted: "#71717a",
            border: "rgba(212, 212, 216, 0.82)",
            focus: "#3f7254",
            shadow: "0 8px 22px rgba(24, 24, 27, 0.12)"
        },
        sky: {
            surface: "rgba(240, 249, 255, 0.86)",
            popupSurface: "rgba(255, 255, 255, 0.56)",
            popupSurfaceOpaque: "#ffffff",
            legendSurface: "transparent",
            glassHover: "rgba(255, 255, 255, 0.72)",
            surfaceHover: "#f0f9ff",
            text: "#075985",
            muted: "#0369a1",
            border: "rgba(14, 116, 144, 0.28)",
            focus: "#0369a1",
            shadow: "0 8px 22px rgba(7, 89, 133, 0.14)"
        },
        dark: {
            surface: "rgba(24, 24, 27, 0.82)",
            popupSurface: "rgba(9, 9, 11, 0.42)",
            popupSurfaceOpaque: "#09090b",
            legendSurface: "transparent",
            glassHover: "rgba(9, 9, 11, 0.58)",
            surfaceHover: "rgba(39, 39, 42, 0.94)",
            text: "#f4f4f5",
            muted: "#cbd5e1",
            border: "rgba(244, 244, 245, 0.22)",
            focus: "#d4d4d8",
            shadow: "0 10px 26px rgba(0, 0, 0, 0.28)"
        }
    });

    function interfaceFor(backgroundKey) {
        if (backgroundKey === "sky") {
            return interfaceThemes.sky;
        }

        return (
            backgrounds[backgroundKey]?.tone === "dark"
                ? interfaceThemes.dark
                : interfaceThemes.light
        );
    }

    function populateControlPreviews(rootDocument) {
        const documentRoot = (
            rootDocument
            || window.document
        );

        documentRoot.querySelectorAll(
            "[data-map-palette-option]"
        ).forEach(function (button) {
            const palette = palettes[
                button.dataset.mapPaletteOption
            ];
            const preview = button.querySelector(
                "[data-map-palette-preview]"
            );

            if (!palette || !preview) {
                return;
            }

            preview.replaceChildren();

            palette.colors.forEach(function (color) {
                const colorBox =
                    documentRoot.createElement("span");

                colorBox.className =
                    "add-map-palette-color-box";
                colorBox.style.backgroundColor = color;

                preview.appendChild(colorBox);
            });
        });

        documentRoot.querySelectorAll(
            "[data-map-background-option]"
        ).forEach(function (button) {
            const background = backgrounds[
                button.dataset.mapBackgroundOption
            ];
            const swatch = button.querySelector(
                "[data-map-background-swatch]"
            );

            if (background && swatch) {
                swatch.style.backgroundColor =
                    background.color;
            }
        });
    }

    function bindStylePanel(rootDocument) {
        const documentRoot = (
            rootDocument
            || window.document
        );
        const control = documentRoot.querySelector(
            "[data-map-style-control]"
        );
        const panel = documentRoot.getElementById(
            "map-style-panel"
        );
        const toggle = documentRoot.getElementById(
            "map-style-toggle"
        );

        if (!control || !panel || !toggle) {
            return null;
        }

        if (
            control.dataset.mapStylePanelBound
            === "true"
        ) {
            return null;
        }

        control.dataset.mapStylePanelBound = "true";

        function setOpen(isOpen) {
            panel.classList.toggle(
                "hidden",
                !isOpen
            );
            toggle.setAttribute(
                "aria-expanded",
                isOpen ? "true" : "false"
            );
        }

        toggle.addEventListener(
            "click",
            function (event) {
                event.preventDefault();

                setOpen(
                    toggle.getAttribute(
                        "aria-expanded"
                    ) !== "true"
                );
            }
        );

        documentRoot.addEventListener(
            "click",
            function (event) {
                if (
                    !control.contains(
                        event.target
                    )
                ) {
                    setOpen(false);
                }
            }
        );

        documentRoot.addEventListener(
            "keydown",
            function (event) {
                if (
                    event.key === "Escape"
                    && !panel.classList.contains(
                        "hidden"
                    )
                ) {
                    setOpen(false);
                    toggle.focus();
                }
            }
        );

        documentRoot.addEventListener(
            "add:map-browser-fullscreen-change",
            function () {
                setOpen(false);
            }
        );

        return Object.freeze({
            setOpen: setOpen
        });
    }

    window.ADDMapAppearance = Object.freeze({
        palettes: palettes,
        backgrounds: backgrounds,
        noDataColor: noDataColor,
        boundaryOutlineColor: boundaryOutlineColor,
        themeColor: themeColor,
        normalizePaletteKey: normalizePaletteKey,
        interfaceFor: interfaceFor,
        populateControlPreviews: populateControlPreviews,
        bindStylePanel: bindStylePanel
    });
}());
