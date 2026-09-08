(function () {
    "use strict";

    const form = document.querySelector(
        "[data-report-generation-form]"
    );

    if (!form) {
        return;
    }

    const controls = {
        years: form.querySelector(
            '[data-report-filter="years"]'
        ),
        months: form.querySelector(
            '[data-report-filter="months"]'
        ),
        region: form.querySelector(
            '[data-report-filter="region"]'
        ),
        province: form.querySelector(
            '[data-report-filter="province"]'
        ),
        hazard: form.querySelector(
            '[data-report-filter="hazard"]'
        ),
        incident: form.querySelector(
            '[data-report-filter="incident"]'
        ),
        group: form.querySelector(
            '[data-report-filter="commodity-group"]'
        ),
        commodity: form.querySelector(
            '[data-report-filter="commodity"]'
        ),
        layout: Array.from(
            form.querySelectorAll(
                'input[name="layout"]'
            )
        )
    };

    const notice = form.querySelector(
        "[data-report-filter-notice]"
    );

    const customDropdowns = [];

    function reportOptionLabel(option) {
        return String(option?.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function reportFilterLabel(dropdown) {
        const fieldLabel = dropdown.closest("label")?.querySelector(
            ".ui-label"
        );

        if (fieldLabel) {
            return reportOptionLabel(fieldLabel);
        }

        const labels = {
            year: "Year",
            month: "Month",
            region: "Region",
            province: "Province",
            hazard: "Hazard Type",
            incident: "Incident",
            commodity_group: "Commodity Group",
            commodity: "Commodity Subgroup"
        };

        return labels[dropdown.dataset.filterKind] || "Filter";
    }

    function closeCustomDropdowns(exceptDropdown) {
        customDropdowns.forEach(function (custom) {
            if (custom.dropdown !== exceptDropdown) {
                custom.dropdown.removeAttribute("open");
                custom.summary?.setAttribute("aria-expanded", "false");
            }
        });
    }

    document.addEventListener("click", function (event) {
        const target = event.target;
        const clickedDropdown = target instanceof Element
            ? target.closest("[data-report-filter-dropdown]")
            : null;

        if (clickedDropdown && form.contains(clickedDropdown)) {
            return;
        }

        closeCustomDropdowns();
    });

    function setCustomDropdownState(custom, disabled) {
        const summary = custom.summary;

        custom.dropdown.dataset.disabled = disabled ? "true" : "false";
        summary?.setAttribute(
            "aria-expanded",
            disabled ? "false" : String(custom.dropdown.open)
        );
        if (disabled) {
            custom.dropdown.removeAttribute("open");
            summary?.classList.add(
                "cursor-not-allowed",
                "border-zinc-200",
                "bg-zinc-50",
                "text-zinc-400"
            );
            summary?.classList.remove(
                "cursor-pointer",
                "border-zinc-300",
                "bg-white",
                "text-zinc-800"
            );
            summary?.setAttribute("aria-disabled", "true");
        } else {
            summary?.classList.add(
                "cursor-pointer",
                "border-zinc-300",
                "bg-white",
                "text-zinc-800"
            );
            summary?.classList.remove(
                "cursor-not-allowed",
                "border-zinc-200",
                "bg-zinc-50",
                "text-zinc-400"
            );
            summary?.removeAttribute("aria-disabled");
        }
    }

    function selectedOptions(select) {
        return Array.from(select.options).filter(function (option) {
            return option.selected && option.value;
        });
    }

    function selectedValues(select) {
        return selectedOptions(select).map(function (option) {
            return option.value;
        });
    }

    function setSelectedValues(select, valuesToSelect) {
        const selected = new Set(valuesToSelect);
        Array.from(select.options).forEach(function (option) {
            option.selected = selected.has(option.value);
        });
    }

    function multiSelectionLabel(custom) {
        const visibleOptions = custom.optionItems
            .filter(function (item) {
                return !item.option.hidden && !item.option.disabled;
            })
            .map(function (item) {
                return item.option;
            });
        const selected = visibleOptions.filter(function (option) {
            return option.selected;
        });
        const allLabels = {
            year: "All Years",
            month: "All Months",
            hazard: "All Hazards"
        };
        const allLabel = allLabels[custom.filterKind] || "All";

        if (!selected.length || selected.length === visibleOptions.length) {
            return allLabel;
        }

        const ordered = selected.slice().sort(function (left, right) {
            return Number(left.value) - Number(right.value);
        });
        const labels = ordered.map(reportOptionLabel);

        if (labels.length === 1) {
            return labels[0];
        }

        const contiguous = ordered.every(function (option, index) {
            return index === 0
                || Number(option.value)
                    === Number(ordered[index - 1].value) + 1;
        });

        return contiguous
            ? `${labels[0]}–${labels[labels.length - 1]}`
            : labels.join(", ");
    }

    function syncCustomDropdown(custom) {
        const select = custom.select;
        const selectedOption = select.options[select.selectedIndex];
        const valueLabel = select.disabled
            ? (custom.dropdown.dataset.disabledLabel || "Unavailable")
            : select.multiple
                ? multiSelectionLabel(custom)
                : reportOptionLabel(selectedOption);
        const label = custom.dropdown.querySelector("[data-filter-label]");

        if (label) {
            label.textContent = valueLabel;
        }

        custom.summary?.setAttribute(
            "aria-label",
            `${custom.fieldLabel}: ${valueLabel}`
        );

        custom.optionsContainer?.setAttribute(
            "aria-label",
            custom.fieldLabel
        );

        custom.optionItems.forEach(function (item) {
            const hidden = Boolean(item.option.hidden);
            const disabled = Boolean(item.option.disabled) || select.disabled;

            item.element.hidden = hidden;
            item.element.setAttribute(
                "aria-hidden",
                hidden ? "true" : "false"
            );
            item.control.disabled = disabled;

            if (select.multiple) {
                item.control.checked = Boolean(item.option.selected);
                item.control.setAttribute(
                    "aria-checked",
                    String(item.option.selected)
                );
            } else {
                item.control.setAttribute(
                    "aria-selected",
                    String(item.option.value === select.value)
                );
            }
        });

        setCustomDropdownState(custom, select.disabled);
    }

    function buildCustomDropdown(select, dropdown) {
        const optionsContainer = dropdown.querySelector(
            "[data-report-filter-options]"
        );
        const optionTarget = dropdown.querySelector(
            "[data-report-multi-options]"
        ) || optionsContainer;

        if (!optionsContainer || !optionTarget) {
            return false;
        }

        const summary = dropdown.querySelector("summary");
        const custom = {
            select,
            dropdown,
            summary,
            optionsContainer,
            optionItems: [],
            filterKind: dropdown.dataset.filterKind,
            fieldLabel: reportFilterLabel(dropdown)
        };
        customDropdowns.push(custom);

        optionsContainer.setAttribute("role", "listbox");
        summary?.setAttribute("aria-haspopup", "listbox");
        summary?.setAttribute("aria-expanded", "false");

        Array.from(select.options).forEach(function (option) {
            if (!option.value && select.multiple) {
                return;
            }

            if (select.multiple) {
                const item = document.createElement("label");
                const checkbox = document.createElement("input");
                const text = document.createElement("span");

                item.className = (
                    "flex cursor-pointer items-center gap-2 rounded-md "
                    + "px-2 py-2 text-sm font-normal text-zinc-700 "
                    + "hover:bg-zinc-50"
                );
                checkbox.type = "checkbox";
                checkbox.className = "ui-choice ui-choice--info";
                checkbox.setAttribute("aria-label", reportOptionLabel(option));
                text.textContent = reportOptionLabel(option);
                item.append(checkbox, text);
                optionTarget.appendChild(item);

                checkbox.addEventListener("change", function () {
                    option.selected = checkbox.checked;
                    select.dispatchEvent(
                        new Event("change", { bubbles: true })
                    );
                });

                custom.optionItems.push({
                    element: item,
                    control: checkbox,
                    option
                });
                return;
            }

            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "option");
            button.setAttribute("aria-selected", "false");
            button.dataset.filterOption = "";
            button.dataset.value = option.value || "";
            button.dataset.label = reportOptionLabel(option);
            button.className = (
                "block w-full rounded-md px-2 py-2 text-left "
                + "text-sm font-normal text-zinc-700 hover:bg-zinc-50"
            );
            button.textContent = reportOptionLabel(option);

            Object.keys(option.dataset).forEach(function (key) {
                button.dataset[key] = option.dataset[key];
            });

            button.addEventListener("click", function () {
                if (select.disabled || button.disabled || button.hidden) {
                    return;
                }

                select.value = button.dataset.value || "";
                select.dispatchEvent(new Event("change", { bubbles: true }));
                dropdown.removeAttribute("open");
            });

            optionTarget.appendChild(button);
            custom.optionItems.push({
                element: button,
                control: button,
                option
            });
        });

        if (select.multiple) {
            dropdown.querySelector("[data-report-select-all]")?.addEventListener(
                "click",
                function () {
                    custom.optionItems.forEach(function (item) {
                        if (!item.option.hidden && !item.option.disabled) {
                            item.option.selected = true;
                        }
                    });
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
            );
            dropdown.querySelector("[data-report-clear]")?.addEventListener(
                "click",
                function () {
                    custom.optionItems.forEach(function (item) {
                        item.option.selected = false;
                    });
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
            );
        }

        summary?.addEventListener("click", function (event) {
            if (select.disabled) {
                event.preventDefault();
                dropdown.removeAttribute("open");
            }
        });

        dropdown.addEventListener("toggle", function () {
            if (dropdown.open && select.disabled) {
                dropdown.removeAttribute("open");
                summary?.setAttribute("aria-expanded", "false");
                return;
            }

            if (dropdown.open) {
                closeCustomDropdowns(dropdown);
            }

            summary?.setAttribute(
                "aria-expanded",
                dropdown.open ? "true" : "false"
            );
        });

        select.addEventListener("change", function () {
            syncCustomDropdown(custom);
        });

        syncCustomDropdown(custom);
        return true;
    }

    form.querySelectorAll("[data-report-custom-select]").forEach(function (wrapper) {
        const select = wrapper.querySelector("select");
        const dropdown = wrapper.querySelector("[data-report-filter-dropdown]");
        if (select && dropdown && buildCustomDropdown(select, dropdown)) {
            select.setAttribute("aria-hidden", "true");
            select.setAttribute("tabindex", "-1");
            wrapper.classList.add("is-enhanced");
        }
    });

    function syncAllCustomDropdowns() {
        customDropdowns.forEach(syncCustomDropdown);
    }

    function setCascadedSelectState(select, disabled) {
        if (!select) {
            return;
        }

        select.disabled = disabled;
        select.setAttribute("aria-disabled", String(disabled));
        if (disabled) {
            select.value = "";
        }
    }

    function values(option, key) {
        return (option.dataset[key] || "")
            .split("|")
            .map((value) => value.trim())
            .filter(Boolean);
    }

    function showOption(option, visible) {
        if (!option.value) {
            option.hidden = false;
            option.disabled = false;
            return;
        }

        option.hidden = !visible;
        option.disabled = !visible;
    }

    function showNotice(message) {
        if (!notice || !message) {
            return;
        }

        notice.textContent = message;
        notice.classList.remove("hidden");
    }

    function clearNotice() {
        if (!notice) {
            return;
        }

        notice.textContent = "";
        notice.classList.add("hidden");
    }

    function clearInvalid(select, message, announce) {
        if (!select || !select.value) {
            return;
        }

        const option =
            select.options[select.selectedIndex];

        if (
            option
            && !option.hidden
            && !option.disabled
        ) {
            return;
        }

        select.value = "";

        if (announce) {
            showNotice(message);
        }
    }

    function clearInvalidMultiple(select, message, announce) {
        const invalid = Array.from(select.options).filter(function (option) {
            return option.selected && (
                option.hidden || option.disabled
            );
        });

        if (!invalid.length) {
            return;
        }

        invalid.forEach(function (option) {
            option.selected = false;
        });

        if (announce) {
            showNotice(message);
        }
    }

    function refreshMonths(announce) {
        const years = selectedValues(controls.years);

        Array.from(
            controls.months.options
        ).forEach((option) => {
            const optionYears = values(
                option,
                "years"
            );

            showOption(
                option,
                optionYears.length > 0
                && (
                    !years.length
                    || optionYears.some(
                        (year) => years.includes(year)
                    )
                )
            );
        });

        clearInvalidMultiple(
            controls.months,
            years.length
                ? "Month selections were cleared because they have no data in the selected years."
                : "Month selections were cleared because they have no report data.",
            announce
        );
    }

    function refreshProvinces(announce) {
        const region = controls.region.value;

        setCascadedSelectState(controls.province, !region);

        Array.from(
            controls.province.options
        ).forEach((option) => {
            showOption(
                option,
                !region
                    ? !option.value
                    : option.dataset.parent === region
            );
        });

        clearInvalid(
            controls.province,
            "Province selection was cleared because it is outside the selected region.",
            announce
        );
    }

    function refreshCommodities(announce) {
        const group = controls.group.value;

        setCascadedSelectState(controls.commodity, !group);

        Array.from(
            controls.commodity.options
        ).forEach((option) => {
            showOption(
                option,
                !group
                    ? !option.value
                    : option.dataset.parent === group
            );
        });

        clearInvalid(
            controls.commodity,
            "Commodity selection was cleared because it is outside the selected commodity group.",
            announce
        );
    }

    function refreshIncidents(announce) {
        const selected = {
            years: selectedValues(controls.years),
            months: selectedValues(controls.months),
            region: controls.region.value,
            province: controls.province.value,
            hazards: selectedValues(controls.hazard)
        };

        setCascadedSelectState(
            controls.incident,
            !selected.hazards.length
        );

        Array.from(
            controls.incident.options
        ).forEach((option) => {
            if (!option.value) {
                showOption(option, true);
                return;
            }

            const matches =
                Boolean(selected.hazards.length)
                &&
                (
                    !selected.years.length
                    || values(option, "years").some(
                        (year) => selected.years.includes(year)
                    )
                )
                && (
                    !selected.months.length
                    || values(option, "months").some(
                        (month) => selected.months.includes(month)
                    )
                )
                && (
                    !selected.region
                    || values(
                        option,
                        "regions"
                    ).includes(selected.region)
                )
                && (
                    !selected.province
                    || values(
                        option,
                        "provinces"
                    ).includes(
                        selected.province
                    )
                )
                && (
                    !selected.hazards.length
                    || selected.hazards.includes(
                        option.dataset.hazard
                    )
                );

            showOption(option, matches);
        });

        clearInvalid(
            controls.incident,
            "Incident selection was cleared because it is outside the selected period, location, or hazard scope.",
            announce
        );
    }

    function selectedSector() {
        if (controls.commodity.value) {
            return controls.commodity
                .options[
                    controls.commodity
                        .selectedIndex
                ]
                .dataset.sector || "";
        }

        if (controls.group.value) {
            return controls.group
                .options[
                    controls.group
                        .selectedIndex
                ]
                .dataset.sector || "";
        }

        return "";
    }

    function refreshMetrics(announce) {
        const sector = selectedSector();

        form.querySelectorAll(
            "[data-report-metric-option]"
        ).forEach((label) => {
            const input = label.querySelector(
                'input[name="metrics"]'
            );
            const sectors = values(
                input,
                "sectors"
            );

            const compatible =
                !sector
                || sectors.length === 0
                || sectors.includes(sector);

            label.hidden = !compatible;
            input.disabled = !compatible;

            if (!compatible && input.checked) {
                input.checked = false;

                if (announce) {
                    showNotice(
                        "Incompatible metrics were cleared for the selected commodity sector."
                    );
                }
            }
        });
    }

    function refreshAll(announce) {
        if (announce) {
            clearNotice();
        }

        refreshMonths(announce);
        refreshProvinces(announce);
        refreshCommodities(announce);
        refreshIncidents(announce);
        refreshMetrics(announce);
        syncAllCustomDropdowns();
    }

    controls.layout.forEach((input) => {
        input.setAttribute(
            "data-report-layout",
            input.value
        );

        input.addEventListener(
            "change",
            function () {
                refreshAll(true);
            }
        );
    });

    controls.province.addEventListener(
        "change",
        function () {
            const option =
                controls.province.options[
                    controls.province.selectedIndex
                ];

            if (
                controls.province.value
                && option.dataset.parent
            ) {
                controls.region.value =
                    option.dataset.parent;
            }

            refreshAll(true);
        }
    );

    controls.commodity.addEventListener(
        "change",
        function () {
            const option =
                controls.commodity.options[
                    controls.commodity.selectedIndex
                ];

            if (
                controls.commodity.value
                && option.dataset.parent
            ) {
                controls.group.value =
                    option.dataset.parent;
            }

            refreshAll(true);
        }
    );

    controls.incident.addEventListener(
        "change",
        function () {
            const option =
                controls.incident.options[
                    controls.incident.selectedIndex
                ];

            if (
                controls.incident.value
                && option.dataset.hazard
            ) {
                setSelectedValues(
                    controls.hazard,
                    [option.dataset.hazard]
                );
                controls.hazard.dispatchEvent(
                    new Event("change", { bubbles: true })
                );
            }

            refreshAll(true);
        }
    );

    [
        controls.years,
        controls.months,
        controls.region,
        controls.hazard,
        controls.group
    ].forEach((control) => {
        control.addEventListener(
            "change",
            function () {
                refreshAll(true);
            }
        );
    });

    form.addEventListener(
        "submit",
        function (event) {
            const selectedMetrics =
                form.querySelectorAll(
                    'input[name="metrics"]:checked:not(:disabled)'
                );

            if (selectedMetrics.length === 0) {
                event.preventDefault();
                showNotice(
                    "Select at least one compatible metric."
                );
            }
        }
    );

    refreshAll(false);
})();
