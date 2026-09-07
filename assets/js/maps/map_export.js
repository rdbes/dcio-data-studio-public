(function (root) {
    "use strict";

    const exportPresets = Object.freeze({
        clipboard: Object.freeze({
            targetLongEdge: 3072,
            maximumScale: 8
        }),
        download: Object.freeze({
            targetLongEdge: 4096,
            maximumScale: 8
        })
    });
    const maximumCanvasEdge = 8192;
    const maximumCanvasPixels = 40000000;

    function filenamePart(value) {
        return String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function resolveImageSize(
        bounds,
        presetName
    ) {
        const width = Number(bounds?.width);
        const height = Number(bounds?.height);
        const preset = (
            exportPresets[presetName]
            || exportPresets.download
        );

        if (
            !Number.isFinite(width)
            || !Number.isFinite(height)
            || width <= 0
            || height <= 0
        ) {
            throw new Error(
                "The map is not currently visible."
            );
        }

        const longEdge = Math.max(
            width,
            height
        );
        const targetScale = Math.max(
            preset.targetLongEdge / longEdge,
            1
        );
        const edgeScale = (
            maximumCanvasEdge / longEdge
        );
        const pixelScale = Math.sqrt(
            maximumCanvasPixels
            / (width * height)
        );
        const scale = Math.min(
            targetScale,
            preset.maximumScale,
            edgeScale,
            pixelScale
        );

        return Object.freeze({
            width: Math.max(
                1,
                Math.floor(width * scale)
            ),
            height: Math.max(
                1,
                Math.floor(height * scale)
            ),
            scale: scale
        });
    }

    function prepareCanvas(
        canvas,
        bounds,
        presetName
    ) {
        const size = resolveImageSize(
            bounds,
            presetName
        );

        canvas.width = size.width;
        canvas.height = size.height;

        const context =
            canvas.getContext("2d");

        if (!context) {
            throw new Error(
                "The browser could not create "
                + "the map image."
            );
        }

        context.imageSmoothingEnabled = true;

        if (
            "imageSmoothingQuality"
            in context
        ) {
            context.imageSmoothingQuality =
                "high";
        }

        context.setTransform(
            size.scale,
            0,
            0,
            size.scale,
            0,
            0
        );

        return {
            context: context,
            height: size.height,
            scale: size.scale,
            width: size.width
        };
    }

    function collectLatLngRings(
        value,
        result
    ) {
        const rings = result || [];

        if (
            !Array.isArray(value)
            || !value.length
        ) {
            return rings;
        }

        const first = value[0];

        if (
            first
            && Number.isFinite(first.lat)
            && Number.isFinite(first.lng)
        ) {
            rings.push(value);
            return rings;
        }

        value.forEach(function (item) {
            collectLatLngRings(
                item,
                rings
            );
        });

        return rings;
    }

    function projectLatLng(
        map,
        latLng
    ) {
        /*
         * Leaflet's layer points are rounded for
         * screen rendering. Reproject the original
         * LatLng so enlarged exports retain the
         * available boundary detail.
         */
        const projected = map.project(
            latLng,
            map.getZoom()
        );
        const pixelOrigin =
            map.getPixelOrigin();
        const mapPanePosition = (
            typeof map._getMapPanePos
            === "function"
        )
            ? map._getMapPanePos()
            : root.L.point(0, 0);

        return projected
            .subtract(pixelOrigin)
            .add(mapPanePosition);
    }

    function tracePolyline(
        context,
        map,
        layer,
        closed
    ) {
        const latLngs = (
            typeof layer.getLatLngs
            === "function"
        )
            ? layer.getLatLngs()
            : [];
        const rings =
            collectLatLngRings(latLngs);

        if (!rings.length) {
            return false;
        }

        context.beginPath();

        rings.forEach(function (ring) {
            ring.forEach(
                function (latLng, index) {
                    const point =
                        projectLatLng(
                            map,
                            latLng
                        );

                    if (index === 0) {
                        context.moveTo(
                            point.x,
                            point.y
                        );
                    } else {
                        context.lineTo(
                            point.x,
                            point.y
                        );
                    }
                }
            );

            if (closed) {
                context.closePath();
            }
        });

        return true;
    }

    function traceCircle(
        context,
        map,
        layer
    ) {
        const latLng = (
            typeof layer.getLatLng
            === "function"
        )
            ? layer.getLatLng()
            : null;

        if (
            !latLng
            || !Number.isFinite(layer._radius)
            || layer._radius <= 0
        ) {
            return false;
        }

        const point = projectLatLng(
            map,
            latLng
        );
        const radius = Number(layer._radius);
        const radiusY = (
            Number.isFinite(layer._radiusY)
                ? Number(layer._radiusY)
                : radius
        );

        context.beginPath();
        context.save();
        context.translate(
            point.x,
            point.y
        );

        if (
            radiusY > 0
            && Math.abs(radiusY - radius)
                > 0.01
        ) {
            context.scale(
                1,
                radiusY / radius
            );
        }

        context.arc(
            0,
            0,
            radius,
            0,
            Math.PI * 2,
            false
        );
        context.restore();

        return true;
    }

    function dashArray(value) {
        const values = Array.isArray(value)
            ? value
            : String(value || "")
                .split(/[,\s]+/);

        return values
            .map(function (item) {
                return Number.parseFloat(item);
            })
            .filter(function (item) {
                return (
                    Number.isFinite(item)
                    && item >= 0
                );
            });
    }

    function paintPath(
        context,
        layer
    ) {
        const options = layer.options || {};

        if (options.fill) {
            const fillOpacity =
                Number.parseFloat(
                    options.fillOpacity
                );

            context.save();
            context.globalAlpha *= (
                Number.isFinite(fillOpacity)
                    ? fillOpacity
                    : 0.2
            );
            context.fillStyle = (
                options.fillColor
                || options.color
                || "#3388ff"
            );
            context.fill(
                options.fillRule || "evenodd"
            );
            context.restore();
        }

        const weight = Number.parseFloat(
            options.weight
        );

        if (
            options.stroke !== false
            && Number.isFinite(weight)
            && weight > 0
        ) {
            const strokeOpacity =
                Number.parseFloat(
                    options.opacity
                );
            const offset =
                Number.parseFloat(
                    options.dashOffset
                );

            context.save();
            context.globalAlpha *= (
                Number.isFinite(strokeOpacity)
                    ? strokeOpacity
                    : 1
            );
            context.strokeStyle = (
                options.color || "#3388ff"
            );
            context.lineWidth = weight;
            context.lineCap = (
                options.lineCap || "round"
            );
            context.lineJoin = (
                options.lineJoin || "round"
            );
            context.setLineDash(
                dashArray(options.dashArray)
            );
            context.lineDashOffset = (
                Number.isFinite(offset)
                    ? offset
                    : 0
            );
            context.stroke();
            context.restore();
        }
    }

    function drawLeafletPathLayer(
        context,
        map,
        layer
    ) {
        if (
            !layer
            || layer._map !== map
            || (
                typeof layer._empty
                === "function"
                && layer._empty()
            )
        ) {
            return false;
        }

        const isCircle = (
            typeof layer.getLatLng
            === "function"
            && Number.isFinite(layer._radius)
        );
        const closed = Boolean(
            root.L
            && root.L.Polygon
            && layer instanceof root.L.Polygon
        );
        const traced = isCircle
            ? traceCircle(
                context,
                map,
                layer
            )
            : tracePolyline(
                context,
                map,
                layer,
                closed
            );

        if (traced) {
            paintPath(context, layer);
        }

        return traced;
    }

    function isCanvasRenderedLayer(layer) {
        const canvas = layer?._renderer?._container;
        return Boolean(
            canvas
            && String(canvas.tagName || "").toLowerCase() === "canvas"
        );
    }

    function drawCanvasSnapshot(
        context,
        canvasElement,
        mapBounds
    ) {
        if (!canvasElement || !mapBounds) {
            return false;
        }

        const bounds = canvasElement.getBoundingClientRect();
        const styles = root.getComputedStyle(canvasElement);
        if (
            !bounds.width
            || !bounds.height
            || styles.display === "none"
            || styles.visibility === "hidden"
        ) {
            return false;
        }

        context.save();
        const opacity = Number.parseFloat(styles.opacity);
        if (Number.isFinite(opacity)) {
            context.globalAlpha *= opacity;
        }
        context.drawImage(
            canvasElement,
            0,
            0,
            canvasElement.width,
            canvasElement.height,
            bounds.left - mapBounds.left,
            bounds.top - mapBounds.top,
            bounds.width,
            bounds.height
        );
        context.restore();
        return true;
    }

    function drawLeafletCanvasLayers(
        context,
        mapNode,
        mapBounds
    ) {
        const canvases = Array.from(
            mapNode?.querySelectorAll?.(".leaflet-pane canvas") || []
        )
            .filter(function (canvas) {
                const styles = root.getComputedStyle(canvas);
                return (
                    styles.display !== "none"
                    && styles.visibility !== "hidden"
                );
            })
            .sort(function (first, second) {
                const firstPane = first.closest(".leaflet-pane");
                const secondPane = second.closest(".leaflet-pane");
                const firstZ = Number.parseInt(
                    root.getComputedStyle(firstPane || first).zIndex,
                    10
                ) || 0;
                const secondZ = Number.parseInt(
                    root.getComputedStyle(secondPane || second).zIndex,
                    10
                ) || 0;
                return firstZ - secondZ;
            });

        let rendered = 0;
        canvases.forEach(function (canvas) {
            if (drawCanvasSnapshot(context, canvas, mapBounds)) {
                rendered += 1;
            }
        });
        return rendered;
    }

    function drawTextSnapshot(
        context,
        element,
        mapBounds,
        opacity
    ) {
        if (!context || !element || !mapBounds) {
            return false;
        }

        const bounds = element.getBoundingClientRect();
        const styles = root.getComputedStyle(element);
        const text = String(element.textContent || "").trim();
        if (!bounds.width || !bounds.height || !text) {
            return false;
        }

        const fontSize = Number.parseFloat(styles.fontSize) || 8;
        context.save();
        context.globalAlpha *= Number.isFinite(Number(opacity))
            ? Number(opacity)
            : (Number.parseFloat(styles.opacity) || 1);
        context.fillStyle = styles.color;
        context.font = (
            `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`
        );
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(
            text,
            bounds.left - mapBounds.left + bounds.width / 2,
            bounds.top - mapBounds.top + bounds.height / 2 + fontSize * 0.05
        );
        context.restore();
        return true;
    }

    function drawCrsSnapshot(
        context,
        cartography,
        mapBounds,
        opacity
    ) {
        const crsLabel = cartography?.querySelector?.(
            ".add-map-crs-label"
        );
        return drawTextSnapshot(
            context,
            crsLabel,
            mapBounds,
            opacity
        );
    }

    async function copyImageBlob(blob) {
        if (
            !blob
            || !root.navigator?.clipboard
            || typeof root.navigator.clipboard.write !== "function"
            || !root.ClipboardItem
        ) {
            throw new Error(
                "Image copying is not supported by this browser."
            );
        }

        await root.navigator.clipboard.write([
            new root.ClipboardItem({
                "image/png": blob
            })
        ]);
    }

    function downloadBlob(
        blob,
        filename
    ) {
        const url = (
            root.URL.createObjectURL(blob)
        );
        const link = (
            root.document.createElement("a")
        );

        link.href = url;
        link.download = filename;
        link.style.display = "none";

        root.document.body.appendChild(
            link
        );
        link.click();
        link.remove();

        root.setTimeout(
            function () {
                root.URL.revokeObjectURL(
                    url
                );
            },
            0
        );
    }

    root.ADDMapExport = Object.freeze({
        copyImageBlob: copyImageBlob,
        drawCanvasSnapshot: drawCanvasSnapshot,
        drawLeafletCanvasLayers: drawLeafletCanvasLayers,
        drawCrsSnapshot: drawCrsSnapshot,
        drawLeafletPathLayer:
            drawLeafletPathLayer,
        drawTextSnapshot: drawTextSnapshot,
        downloadBlob: downloadBlob,
        filenamePart: filenamePart,
        isCanvasRenderedLayer: isCanvasRenderedLayer,
        prepareCanvas: prepareCanvas,
        resolveImageSize: resolveImageSize
    });
}(
    typeof window !== "undefined"
        ? window
        : globalThis
));
