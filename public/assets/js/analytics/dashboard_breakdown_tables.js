(function () {
    "use strict";

    const dataNode = document.getElementById("dashboard-breakdown-tables-data");
    if (!dataNode) {
        return;
    }

    const tables = JSON.parse(dataNode.textContent || "[]");
    const metricDetails = {
        value: {label: "Value Loss (PHP)"},
        area: {label: "Area Affected (HA)"},
        volume: {label: "Volume Loss (MT)"},
        farmers: {label: "Affected Farmers/Fisherfolk"},
    };
    const formatter = new Intl.NumberFormat("en-PH", {
        maximumFractionDigits: 0,
    });

    function formatValue(value) {
        return value === null || value === undefined || value === ""
            ? "-"
            : formatter.format(Number(value));
    }

    function renderTable(card, table, metric) {
        const body = card.querySelector("[data-breakdown-table-body]");
        const heading = card.querySelector("[data-breakdown-table-heading]");
        if (!body || !table) {
            return;
        }
        if (heading) {
            heading.textContent = `${metricDetails[metric]?.label || metricDetails.value.label} ${table.title}`;
        }
        const rows = [...(table.rows || [])].sort((left, right) => {
            const leftValue = Number(left.metrics?.[metric]?.reduce((sum, value) => sum + (Number(value) || 0), 0) || 0);
            const rightValue = Number(right.metrics?.[metric]?.reduce((sum, value) => sum + (Number(value) || 0), 0) || 0);
            return rightValue - leftValue || String(left.label).localeCompare(String(right.label));
        });
        body.replaceChildren();
        rows.forEach((row) => {
            const tableRow = document.createElement("tr");
            const label = document.createElement("th");
            label.scope = "row";
            label.textContent = row.label || "Unclassified";
            tableRow.append(label);
            (row.metrics?.[metric] || []).forEach((value) => {
                const cell = document.createElement("td");
                cell.className = "is-numeric";
                cell.textContent = formatValue(value);
                tableRow.append(cell);
            });
            body.append(tableRow);
        });
        const totalRow = document.createElement("tr");
        totalRow.className = "dashboard-breakdown-total-row";
        const totalLabel = document.createElement("th");
        totalLabel.scope = "row";
        totalLabel.textContent = "Total";
        totalRow.append(totalLabel);
        (table.totals?.[metric] || []).forEach((value) => {
            const cell = document.createElement("td");
            cell.className = "is-numeric";
            cell.textContent = formatValue(value);
            totalRow.append(cell);
        });
        body.append(totalRow);
    }

    document.querySelectorAll("[data-breakdown-table]").forEach((card) => {
        const table = tables.find((item) => item.key === card.dataset.breakdownTable);
        if (!table) {
            return;
        }
        const setMetric = (metric) => {
            const selected = metricDetails[metric] ? metric : "value";
            card.querySelectorAll("[data-breakdown-table-metric]").forEach((button) => {
                const active = button.dataset.breakdownTableMetric === selected;
                button.classList.toggle("is-active", active);
                button.setAttribute("aria-pressed", String(active));
            });
            renderTable(card, table, selected);
        };

        card.querySelectorAll("[data-breakdown-table-metric]").forEach((button) => {
            button.addEventListener("click", () => setMetric(button.dataset.breakdownTableMetric));
        });
        setMetric("value");
    });
})();
