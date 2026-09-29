(function () {
    "use strict";

    const LOCATION_ROWS_PER_PAGE = 9;
    const MUNICIPAL_ROWS_PER_PAGE = 18;

    function applyDroughtReportLayout(root) {
        const pages = root?.querySelectorAll?.(
            ".drought-report-page--boundary-level, "
            + ".drought-report-page--municipality"
        ) || [];

        pages.forEach(function (page) {
            const wrapper = page.querySelector(".drought-report-table-wrap");
            const table = wrapper?.querySelector(".drought-report-table");
            const head = table?.tHead;
            const body = table?.tBodies?.[0];
            if (!wrapper || !table || !body) return;

            const rows = Array.from(body.rows);
            rows.forEach(function (row) {
                row.style.removeProperty("height");
            });

            const isMunicipality = page.classList.contains(
                "drought-report-page--municipality"
            );
            const wrapperHeight = wrapper.clientHeight;
            const columnHeaderHeight = head?.getBoundingClientRect().height || 0;
            const groupHeaderHeight = rows
                .filter(function (row) {
                    return row.classList.contains("drought-report-table__group");
                })
                .reduce(function (total, row) {
                    return total + row.getBoundingClientRect().height;
                }, 0);
            const summaryRow = isMunicipality
                ? rows.find(function (row) {
                    return row.classList.contains(
                        "drought-report-table__province-summary-row"
                    ) && row.classList.contains(
                        "drought-report-table__location-row"
                    );
                })
                : null;
            const summaryRainfallRow = summaryRow?.nextElementSibling?.classList
                .contains("drought-report-table__rainfall-row")
                ? summaryRow.nextElementSibling
                : null;
            const summaryHeight = summaryRow
                ? summaryRow.getBoundingClientRect().height
                    + (summaryRainfallRow?.getBoundingClientRect().height || 0)
                : 0;
            const wrapperBorder = Math.max(
                0,
                wrapper.offsetHeight - wrapper.clientHeight
            );
            const rowsPerPage = isMunicipality
                ? MUNICIPAL_ROWS_PER_PAGE
                : LOCATION_ROWS_PER_PAGE;
            const locationBlockHeight = Math.max(
                0,
                (
                    wrapperHeight
                    - columnHeaderHeight
                    - groupHeaderHeight
                    - summaryHeight
                    - wrapperBorder
                ) / rowsPerPage
            );
            if (!Number.isFinite(locationBlockHeight) || locationBlockHeight <= 0) {
                return;
            }

            page.style.setProperty(
                "--drought-report-location-block-height",
                `${locationBlockHeight}px`
            );

            rows.forEach(function (row) {
                if (!row.classList.contains("drought-report-table__location-row")) {
                    return;
                }
                const rainfallRow = row.nextElementSibling?.classList.contains(
                    "drought-report-table__rainfall-row"
                ) ? row.nextElementSibling : null;
                const isSummary = row.classList.contains(
                    "drought-report-table__province-summary-row"
                );
                const height = isSummary
                    ? row.getBoundingClientRect().height
                    : rainfallRow
                    ? locationBlockHeight / 2
                    : locationBlockHeight;
                row.style.height = `${height}px`;
                if (rainfallRow) {
                    rainfallRow.style.height = isSummary
                        ? rainfallRow.getBoundingClientRect().height + "px"
                        : `${height}px`;
                }
            });
        });
    }

    window.ADDDroughtReportLayout = {
        apply: applyDroughtReportLayout,
    };
})();
