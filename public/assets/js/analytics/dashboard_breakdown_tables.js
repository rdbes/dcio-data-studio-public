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

    function renderColumns(card, table, metric) {
        const colgroup = card.querySelector("[data-breakdown-table-colgroup]");
        if (!colgroup) {
            return;
        }
        const splitFarmers = metric === "farmers" && table.farmer_breakdown_totals;
        colgroup.replaceChildren();
        const labelColumn = document.createElement("col");
        labelColumn.className = "dashboard-breakdown-label-column";
        colgroup.append(labelColumn);
        (table.years || []).forEach(() => {
            [0, ...(splitFarmers ? [1] : [])].forEach(() => {
                const yearColumn = document.createElement("col");
                yearColumn.className = "dashboard-breakdown-year-column";
                colgroup.append(yearColumn);
            });
        });
    }

    function renderHeader(card, table, metric) {
        const row = card.querySelector("[data-breakdown-table-head-row]");
        const head = card.querySelector("[data-breakdown-table-head]");
        if (!row || !head) {
            return;
        }
        const splitFarmers = metric === "farmers" && table.farmer_breakdown_totals;
        row.replaceChildren();
        const label = document.createElement("th");
        label.scope = "col";
        label.textContent = table.row_label;
        if (splitFarmers) {
            label.rowSpan = 2;
        }
        row.append(label);
        (table.years || []).forEach((year) => {
            const yearCell = document.createElement("th");
            yearCell.scope = "col";
            yearCell.className = "is-numeric dashboard-breakdown-year-header";
            yearCell.textContent = year;
            if (splitFarmers) {
                yearCell.colSpan = 2;
            }
            row.append(yearCell);
        });
        const detailRow = head.querySelector("[data-breakdown-table-detail-row]");
        if (!detailRow) {
            return;
        }
        detailRow.replaceChildren();
        detailRow.hidden = !splitFarmers;
        if (splitFarmers) {
            (table.years || []).forEach(() => {
                ["Farmers", "Fisherfolk"].forEach((labelText, index) => {
                    const detailCell = document.createElement("th");
                    detailCell.scope = "col";
                    detailCell.className = `is-numeric dashboard-breakdown-detail-header ${index === 0 ? "dashboard-breakdown-detail-header--start" : "dashboard-breakdown-detail-header--end"}`;
                    detailCell.textContent = labelText;
                    detailRow.append(detailCell);
                });
            });
        }
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
        renderColumns(card, table, metric);
        renderHeader(card, table, metric);
        const splitFarmers = metric === "farmers" && table.farmer_breakdown_totals;
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
            if (splitFarmers) {
                (table.years || []).forEach((_, index) => {
                    ["farmers", "fisherfolk"].forEach((farmerGroup) => {
                        const cell = document.createElement("td");
                        cell.className = "is-numeric";
                        cell.textContent = formatValue(row.farmer_breakdown?.[farmerGroup]?.[index]);
                        tableRow.append(cell);
                    });
                });
            } else {
                (row.metrics?.[metric] || []).forEach((value) => {
                    const cell = document.createElement("td");
                    cell.className = "is-numeric";
                    cell.textContent = formatValue(value);
                    tableRow.append(cell);
                });
            }
            body.append(tableRow);
        });
        const totalRow = document.createElement("tr");
        totalRow.className = "dashboard-breakdown-total-row";
        const totalLabel = document.createElement("th");
        totalLabel.scope = "row";
        totalLabel.textContent = "Total";
        totalRow.append(totalLabel);
        if (splitFarmers) {
            (table.years || []).forEach((_, index) => {
                ["farmers", "fisherfolk"].forEach((farmerGroup) => {
                    const cell = document.createElement("td");
                    cell.className = "is-numeric";
                    cell.textContent = formatValue(table.farmer_breakdown_totals?.[farmerGroup]?.[index]);
                    totalRow.append(cell);
                });
            });
        } else {
            (table.totals?.[metric] || []).forEach((value) => {
                const cell = document.createElement("td");
                cell.className = "is-numeric";
                cell.textContent = formatValue(value);
                totalRow.append(cell);
            });
        }
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
