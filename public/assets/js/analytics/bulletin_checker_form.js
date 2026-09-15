(function () {
    "use strict";

    const viewport = document.querySelector(".bulletin-scroll");
    if (viewport) {
        const fitPages = () => {
            const style = getComputedStyle(viewport);
            const available = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            viewport.querySelectorAll(".bulletin-sheet").forEach(sheet => {
                sheet.style.zoom = Math.min(1, Math.max(0.1, available / 800));
            });
        };
        new ResizeObserver(fitPages).observe(viewport);
        fitPages();
    }

    const cover = document.querySelector(".bulletin-cover");
    const coverTitle = cover?.querySelector("h2");
    const coverAsOf = cover?.querySelector(".bulletin-cover-as-of");
    if (coverTitle && coverAsOf) {
        const fitCoverTitle = () => {
            let size = 42;
            coverTitle.style.fontSize = `${size}px`;
            const targetBottom = coverAsOf.getBoundingClientRect().top - 16;
            while (coverTitle.getBoundingClientRect().bottom > targetBottom && size > 24) {
                size -= 1;
                coverTitle.style.fontSize = `${size}px`;
            }
        };
        new ResizeObserver(fitCoverTitle).observe(cover);
        fitCoverTitle();
    }

    const fitIncidentTitles = () => {
        document.querySelectorAll(".bulletin-incident-details > span").forEach((titleNode) => {
            let size = 15;
            titleNode.style.fontSize = `${size}px`;
            while (titleNode.scrollWidth > titleNode.clientWidth + 0.5 && size > 9) {
                size = Math.max(9, size - 0.5);
                titleNode.style.fontSize = `${size}px`;
            }
        });
    };
    const titleViewport = document.querySelector(".bulletin-scroll") || document.body;
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(fitIncidentTitles).observe(titleViewport);
    fitIncidentTitles();

    const fitFinalMarkers = () => {
        const renderedTextWidth = (node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const width = range.getBoundingClientRect().width;
            range.detach?.();
            return width;
        };
        document.querySelectorAll(".bulletin-incident-label--final").forEach((marker) => {
            const finalNode = marker.querySelector("b");
            const bulletinNode = marker.querySelector("strong");
            if (!finalNode || !bulletinNode) return;

            // Keep FINAL bold while BULLETIN remains semibold, then match the
            // measured rendered widths by adjusting only BULLETIN's tracking.
            finalNode.style.letterSpacing = "5px";
            bulletinNode.style.letterSpacing = "0px";
            const targetWidth = renderedTextWidth(finalNode);
            const gapCount = Math.max(1, bulletinNode.textContent.trim().length - 1);
            const baseWidth = renderedTextWidth(bulletinNode);
            bulletinNode.style.letterSpacing = `${(targetWidth - baseWidth) / gapCount}px`;
        });
    };
    fitFinalMarkers();
    if (document.fonts?.ready) document.fonts.ready.then(() => {
        fitIncidentTitles();
        fitFinalMarkers();
    });

    const form = document.querySelector("[data-bulletin-source-form]");
    if (!form) return;

    const cards = form.querySelectorAll("[data-bulletin-source-card]");
    const incident = form.querySelector("#id_incident");
    const csv = form.querySelector("#id_csv_file");
    const mode = form.querySelector("#bulletin-source-mode");
    const title = form.querySelector('[name="bulletin_title"]');
    const finalToggle = form.querySelector('[name="bulletin_final"]');
    const bulletinNumber = form.querySelector('[name="bulletin_number"]');

    function setTitleFromIncident() {
        const option = incident.selectedOptions[0];
        if (title && option?.dataset.incidentName) title.value = option.dataset.incidentName;
    }

    function updateSource(selected, clearOpposite) {
        selected = selected === "external" ? "external" : "existing";
        const isExternal = selected === "external";
        mode.value = selected;
        cards.forEach((card) => card.classList.toggle("is-active", card.dataset.bulletinSourceCard === selected));
        incident.required = !isExternal;
        csv.required = isExternal;
        if (clearOpposite) {
            if (isExternal) incident.value = "";
            else csv.value = "";
        }
    }

    function updateFinalState() {
        if (!finalToggle || !bulletinNumber) return;
        bulletinNumber.disabled = finalToggle.checked;
    }

    incident.addEventListener("change", () => {
        updateSource("existing", true);
        setTitleFromIncident();
    });
    csv.addEventListener("change", () => {
        if (csv.files.length) {
            updateSource("external", true);
            if (title) title.value = "Incident Name";
        }
    });
    finalToggle?.addEventListener("change", updateFinalState);
    updateSource(mode.value, false);
    updateFinalState();
}());
