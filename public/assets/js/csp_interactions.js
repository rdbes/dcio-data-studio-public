/* Interactive controls for templates that must work without runtime expression evaluation. */
(function () {
    "use strict";

    document.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("[data-stop-details-toggle]")) {
            event.stopPropagation();
        }
    });

    function setRegionExpanded(region, expanded) {
        region.querySelectorAll("[data-region-detail]").forEach((detail) => {
            detail.hidden = !expanded;
        });
        const icon = region.querySelector("[data-region-icon]");
        icon?.classList.toggle("rotate-90", expanded);
        region.querySelector("[data-region-toggle]")?.setAttribute("aria-expanded", String(expanded));
    }

    document.querySelectorAll("[data-expandable-region]").forEach((region) => {
        const toggle = region.querySelector("[data-region-toggle]");
        if (!toggle) return;
        toggle.setAttribute("role", "button");
        toggle.setAttribute("tabindex", "0");
        setRegionExpanded(region, false);
        const toggleRegion = () => {
            const expanded = toggle.getAttribute("aria-expanded") === "true";
            setRegionExpanded(region, !expanded);
        };
        toggle.addEventListener("click", toggleRegion);
        toggle.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleRegion();
            }
        });
    });

    const importRoot = document.querySelector("[data-import-controls]");
    if (importRoot) {
        const importForm = importRoot.querySelector("[data-import-form]");
        const progress = importRoot.querySelector("[data-import-progress]");
        const submit = importForm?.querySelector("button[type='submit']");
        const acknowledgements = Array.from(importRoot.querySelectorAll("[data-import-ack]"));
        const values = new Map(Array.from(importRoot.querySelectorAll("[data-import-ack-value]")).map((input) => [input.dataset.importAckValue, input]));
        let importing = false;

        function syncImportState() {
            const ready = acknowledgements.every((input) => input.checked);
            acknowledgements.forEach((input) => {
                const value = values.get(input.dataset.importAck);
                if (value) value.value = input.checked ? "1" : "";
            });
            if (submit) {
                submit.disabled = importing || !ready;
                submit.setAttribute("aria-disabled", String(submit.disabled));
                submit.classList.toggle("pointer-events-none", submit.disabled);
                submit.classList.toggle("opacity-60", submit.disabled);
            }
        }

        acknowledgements.forEach((input) => input.addEventListener("change", syncImportState));
        importForm?.addEventListener("submit", (event) => {
            const ready = acknowledgements.every((input) => input.checked);
            if (!ready || importing) {
                event.preventDefault();
                return;
            }
            importing = true;
            if (progress) progress.hidden = false;
            syncImportState();
        });
        syncImportState();
    }

    const preview = document.querySelector("[data-report-preview-modal]");
    if (preview) {
        const trigger = document.querySelector("[data-report-preview-trigger]");
        const closeButton = preview.querySelector("[data-report-preview-close]");
        const tabs = Array.from(preview.querySelectorAll("[data-report-preview-tab]"));
        const sheets = Array.from(preview.querySelectorAll("[data-report-preview-sheet]"));
        let activeSheet = 0;

        function focusableElements() {
            return Array.from(preview.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")).filter((element) => element.offsetParent !== null);
        }

        function selectSheet(index) {
            activeSheet = index;
            sheets.forEach((sheet, sheetIndex) => { sheet.style.display = sheetIndex === activeSheet ? "" : "none"; });
            tabs.forEach((tab, tabIndex) => {
                const selected = tabIndex === activeSheet;
                tab.setAttribute("aria-selected", String(selected));
                tab.classList.toggle("border-emerald-600", selected);
                tab.classList.toggle("bg-white", selected);
                tab.classList.toggle("text-emerald-800", selected);
                tab.classList.toggle("border-transparent", !selected);
                tab.classList.toggle("bg-transparent", !selected);
                tab.classList.toggle("text-zinc-500", !selected);
                tab.classList.toggle("hover:text-zinc-800", !selected);
            });
        }

        function closePreview() {
            preview.style.display = "none";
            document.body.classList.remove("overflow-hidden");
            const previewUrl = new URL(window.location.href);
            previewUrl.searchParams.delete("preview");
            window.history.replaceState({}, "", previewUrl.toString());
            trigger?.focus({ preventScroll: true });
        }

        preview.style.removeProperty("display");
        document.body.classList.add("overflow-hidden");
        closeButton?.focus({ preventScroll: true });
        selectSheet(0);
        closeButton?.addEventListener("click", closePreview);
        preview.querySelector("[data-report-preview-backdrop]")?.addEventListener("click", closePreview);
        tabs.forEach((tab) => tab.addEventListener("click", () => selectSheet(Number(tab.dataset.reportPreviewTab))));
        document.addEventListener("keydown", (event) => {
            if (preview.style.display === "none") return;
            if (event.key === "Escape") {
                closePreview();
                return;
            }
            if (event.key !== "Tab") return;
            const focusable = focusableElements();
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !preview.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !preview.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        });
        window.addEventListener("report-download-finished", closePreview);
    }
}());
