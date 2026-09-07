(function () {
    "use strict";

    function mount(container, options) {
        const section = document.createElement("section");
        const heading = document.createElement("div");
        const list = document.createElement("div");
        const baseAriaLabel = (
            container.getAttribute("aria-label")
            || "Map legend"
        );

        section.className = "add-map-overlay-legend";
        section.dataset.mapOverlayLegend = "";
        section.hidden = true;
        heading.className = "add-map-overlay-legend__title";
        heading.textContent = (
            options && options.title
                ? options.title
                : "Map Layers"
        );
        list.className = "add-map-overlay-legend__list";
        section.append(heading, list);
        container.prepend(section);

        function setItems(items) {
            const normalizedItems = items || [];
            list.replaceChildren();

            normalizedItems.forEach(function (item) {
                const row = document.createElement("div");
                const swatch = document.createElement("span");
                const label = document.createElement("span");
                const color = item.color || "";

                row.className = "add-map-overlay-legend__row";
                swatch.className = (
                    "add-map-overlay-legend__swatch "
                    + `add-map-overlay-legend__swatch--${item.kind || "line"}`
                );
                swatch.dataset.mapOverlayKind = item.kind || "line";
                swatch.setAttribute("aria-hidden", "true");
                label.className = "add-map-overlay-legend__label";
                label.textContent = item.label;

                if (color) {
                    swatch.dataset.mapOverlayColor = color;
                    swatch.style.setProperty(
                        "--map-overlay-color",
                        color
                    );
                }

                if (item.kind === "category") {
                    const code = document.createElement(
                        "span"
                    );

                    swatch.dataset.mapOverlayCode =
                        item.code || "";
                    swatch.dataset.mapOverlayIcon =
                        item.icon || "";
                    swatch.dataset.mapOverlayTextColor =
                        item.textColor || "#18181b";
                    code.className = (
                        "add-map-overlay-legend__category-code"
                    );

                    if (item.icon === "hurricane") {
                        const icon = document.createElement(
                            "i"
                        );
                        icon.className = (
                            "fa-solid fa-hurricane"
                        );
                        code.appendChild(icon);
                    } else {
                        code.textContent = item.code || "";
                    }

                    code.style.setProperty(
                        "--map-overlay-text-color",
                        item.textColor || "#18181b"
                    );
                    swatch.appendChild(code);
                }

                row.append(swatch, label);
                list.appendChild(row);
            });

            section.hidden = !list.childElementCount;
            container.setAttribute(
                "aria-label",
                list.childElementCount
                    ? (
                        `${baseAriaLabel}. Map layers: `
                        + normalizedItems.map(function (item) {
                            return item.label;
                        }).join(", ")
                    )
                    : baseAriaLabel
            );
        }

        return Object.freeze({
            setItems: setItems
        });
    }

    function drawSnapshotSwatch(
        context,
        swatch,
        mapBounds
    ) {
        const bounds = swatch.getBoundingClientRect();
        const kind = (
            swatch.dataset.mapOverlayKind || "line"
        );
        const x = bounds.left - mapBounds.left;
        const y = bounds.top - mapBounds.top;
        const color = (
            swatch.dataset.mapOverlayColor
            || "#52525b"
        );
        const textColor = (
            swatch.dataset.mapOverlayTextColor
            || "#18181b"
        );

        context.save();

        if (
            kind === "category"
        ) {
            const radius = Math.min(
                bounds.width,
                bounds.height
            ) / 2;
            const centerX = x + bounds.width / 2;
            const centerY = y + bounds.height / 2;

            context.fillStyle = color;
            context.strokeStyle = "rgba(255, 255, 255, 0.92)";
            context.lineWidth = 1;
            context.beginPath();
            context.arc(
                centerX,
                centerY,
                radius,
                0,
                Math.PI * 2
            );
            context.fill();
            context.stroke();
            context.fillStyle = textColor;
            context.font = (
                swatch.dataset.mapOverlayIcon
                    === "hurricane"
                    ? (
                        "900 8px "
                        + '"Font Awesome 6 Free"'
                    )
                    : "700 12px Inter, sans-serif"
            );
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(
                swatch.dataset.mapOverlayIcon
                    === "hurricane"
                    ? "\uf751"
                    : (
                        swatch.dataset.mapOverlayCode
                        || ""
                    ),
                centerX,
                centerY
            );
        } else if (kind === "area") {
            context.globalAlpha = 0.72;
            context.fillStyle = color;
            context.fillRect(
                x,
                y,
                bounds.width,
                bounds.height
            );
        } else if (kind === "dot") {
            context.fillStyle = color;
            context.beginPath();
            context.arc(
                x + bounds.width / 2,
                y + bounds.height / 2,
                Math.min(bounds.width, bounds.height) / 3,
                0,
                Math.PI * 2
            );
            context.fill();
        } else {
            context.strokeStyle = color;
            context.lineWidth = 2;
            context.setLineDash(
                kind === "dashed"
                    ? [4, 3]
                    : []
            );
            context.beginPath();
            context.moveTo(
                x,
                y + bounds.height / 2
            );
            context.lineTo(
                x + bounds.width,
                y + bounds.height / 2
            );
            context.stroke();
        }

        context.restore();
    }

    function tropicalCycloneCategoryItems(colors) {
        const categories = [
            {
                colorKey: "STY",
                icon: "hurricane",
                label: "Super Typhoon",
                textColor: "#ffffff"
            },
            {
                colorKey: "TY",
                code: "T",
                label: "Typhoon",
                textColor: "#ffffff"
            },
            {
                colorKey: "STS",
                icon: "hurricane",
                label: "Severe Tropical Storm",
                textColor: "#ffffff"
            },
            {
                colorKey: "TS",
                code: "S",
                label: "Tropical Storm",
                textColor: "#ffffff"
            },
            {
                colorKey: "TD",
                code: "D",
                label: "Tropical Depression",
                textColor: "#ffffff"
            },
            {
                colorKey: "LPA",
                code: "L",
                label: "Low Pressure Area",
                textColor: "#ffffff"
            }
        ];

        return categories.map(function (category) {
            return {
                label: category.label,
                kind: "category",
                code: category.code,
                icon: category.icon,
                color: colors[category.colorKey],
                textColor: category.textColor
            };
        });
    }

    window.ADDMapOverlayLegend = Object.freeze({
        mount: mount,
        drawSnapshotSwatch: drawSnapshotSwatch,
        tropicalCycloneCategoryItems:
            tropicalCycloneCategoryItems
    });
}());
