(function () {
    "use strict";

    function titleCaseFilterLabel(value) {
        return String(value || "").replace(
            /[A-Za-zÀ-ÖØ-öø-ÿ]+/g,
            function (word) {
                if (
                    word === word.toUpperCase()
                    && (
                        word.length <= 5
                        || /\d/.test(word)
                    )
                ) {
                    return word;
                }
                return word.charAt(0).toUpperCase()
                    + word.slice(1).toLowerCase();
            }
        );
    }

    window.ADDTitleCaseFilterLabel = titleCaseFilterLabel;

    /*
     * Data-heavy workspaces keep the shared navigation bar, but render their
     * filter summary directly in the topbar after the sidebar control. Move
     * the existing details element into that header slot so the form, IDs,
     * and existing filter behavior remain single-sourced. The empty body
     * wrapper is then removed to reclaim the former filter-row height.
     */
    document.querySelectorAll("[data-filter-header-slot]").forEach(function (slot) {
        const panelId = slot.dataset.filterPanelTarget;
        const panel = panelId ? document.getElementById(panelId) : null;
        if (!panel || slot.contains(panel)) return;

        const wrapper = panel.parentElement;
        slot.appendChild(panel);
        if (wrapper && wrapper !== slot && !wrapper.children.length) {
            wrapper.remove();
        }

        const shell = slot.closest(".farm-main-panel");
        shell?.classList.add("farm-main-panel--header-filter");
    });

    document.querySelectorAll("[data-analytics-filter-panel]").forEach(function (panel) {
        panel.querySelectorAll("[data-filter-label]").forEach(function (label) {
            label.textContent = titleCaseFilterLabel(label.textContent);
        });
        const panelSummary = panel.querySelector("summary");
        if (panelSummary) {
            function syncPanelExpandedState() {
                panelSummary.setAttribute(
                    "aria-expanded",
                    panel.open ? "true" : "false"
                );
            }

            panel.addEventListener("toggle", syncPanelExpandedState);
            syncPanelExpandedState();
        }

        const periodDropdowns = Array.from(panel.querySelectorAll("[data-period-dropdown]"));
        const filterDropdowns = Array.from(panel.querySelectorAll("[data-filter-dropdown]"));
        const pageScroller = (
            panel.closest(".overflow-y-auto")
            || document.querySelector("[data-page-body].overflow-y-auto")
        );
        const useDiscretePeriodLabels = (
            panel.dataset.discretePeriodLabels === "true"
        );

        function syncDropdownExpandedState(dropdown) {
            const summary = dropdown.querySelector("summary");
            if (summary) {
                summary.setAttribute(
                    "aria-expanded",
                    dropdown.open ? "true" : "false"
                );

                const valueLabel = dropdown.querySelector(
                    "[data-filter-label]"
                )?.textContent.trim();
                const filterLabel = (
                    dropdown.dataset.filterLabelName
                    || dropdown.dataset.periodLabelName
                    || {
                        year: "Year",
                        month: "Month"
                    }[dropdown.dataset.periodKind]
                    || {
                        hazard: "Hazard Type",
                        region: "Region",
                        province: "Province",
                        commodity_group: "Commodity Group",
                        commodity_subgroup: "Commodity Subgroup",
                        incident: "Incident"
                    }[dropdown.dataset.filterKind]
                    || "Filter"
                );

                if (valueLabel) {
                    summary.setAttribute(
                        "aria-label",
                        `${filterLabel}: ${valueLabel}`
                    );
                }
            }
        }

        function registerDropdownExpandedState(dropdown) {
            dropdown.addEventListener(
                "toggle",
                function () {
                    syncDropdownExpandedState(dropdown);
                }
            );
            syncDropdownExpandedState(dropdown);
        }

        function closePeriodDropdowns(exceptDropdown) {
            periodDropdowns.forEach(function (dropdown) {
                if (dropdown !== exceptDropdown) {
                    dropdown.removeAttribute("open");
                    syncDropdownExpandedState(dropdown);
                }
            });
        }

        function closeFilterDropdowns(exceptDropdown) {
            filterDropdowns.forEach(function (dropdown) {
                if (dropdown !== exceptDropdown) {
                    dropdown.removeAttribute("open");
                    syncDropdownExpandedState(dropdown);
                }
            });
        }

        document.addEventListener("click", function (event) {
            const target = event.target;
            const clickedDropdown = target instanceof Element
                ? target.closest("[data-period-dropdown], [data-filter-dropdown]")
                : null;

            if (clickedDropdown && panel.contains(clickedDropdown)) {
                return;
            }

            closePeriodDropdowns();
            closeFilterDropdowns();
        });

        periodDropdowns.forEach(function (dropdown) {
            registerDropdownExpandedState(dropdown);
            const label = dropdown.querySelector("[data-period-label]");
            const inputs = Array.from(dropdown.querySelectorAll('input[type="checkbox"]'));
            const isMonth = dropdown.dataset.periodKind === "month";

            function optionLabel(input) {
                return input.dataset.shortLabel || input.value;
            }

            function selectedInputs() {
                return inputs.filter(function (input) {
                    return input.checked;
                });
            }

            function renderLabel() {
                const selected = selectedInputs();
                if (!label) {
                    syncDropdownExpandedState(dropdown);
                    return;
                }

                let nextLabel;

                if (selected.length === 0) {
                    nextLabel = isMonth
                        ? "All Months"
                        : "All Years";
                } else if (selected.length === 1) {
                    nextLabel = titleCaseFilterLabel(
                        optionLabel(selected[0])
                    );
                } else {
                    const ordered = selected.slice().sort(function (
                        left,
                        right
                    ) {
                        return (
                            Number(left.value)
                            - Number(right.value)
                        );
                    });

                    const contiguous = ordered.every(function (
                        input,
                        index
                    ) {
                        if (index === 0) return true;
                        return (
                            Number(input.value)
                            === Number(ordered[index - 1].value) + 1
                        );
                    });

                    if (selected.length === inputs.length) {
                        nextLabel = isMonth
                            ? "All Months"
                            : "All Years";
                    } else if (
                        useDiscretePeriodLabels
                        && !contiguous
                    ) {
                        nextLabel = ordered
                            .map(function (input) {
                                return titleCaseFilterLabel(
                                    optionLabel(input)
                                );
                            })
                            .join(", ");
                    } else {
                        nextLabel = titleCaseFilterLabel(
                            optionLabel(ordered[0])
                            + (useDiscretePeriodLabels ? "–" : "-")
                            + optionLabel(ordered[ordered.length - 1])
                        );
                    }
                }

                label.textContent = nextLabel;
                syncDropdownExpandedState(dropdown);
            }

            dropdown.querySelector("[data-period-select-all]")?.addEventListener("click", function () {
                inputs.forEach(function (input) {
                    input.checked = true;
                });
                renderLabel();
            });
            dropdown.querySelector("[data-period-clear]")?.addEventListener("click", function () {
                inputs.forEach(function (input) {
                    input.checked = false;
                });
                renderLabel();
            });
            inputs.forEach(function (input) {
                input.addEventListener("change", renderLabel);
            });
            dropdown.addEventListener("toggle", function () {
                if (dropdown.open) {
                    closePeriodDropdowns(dropdown);
                    closeFilterDropdowns();
                }
            });
            renderLabel();
        });

        function filterDropdownByKind(kind) {
            return filterDropdowns.find(function (dropdown) {
                return dropdown.dataset.filterKind === kind;
            });
        }

        function setFilterValue(dropdown, value, text) {
            const input = dropdown.querySelector("[data-filter-input]");
            const label = dropdown.querySelector("[data-filter-label]");
            if (input) input.value = value;
            if (label) label.textContent = titleCaseFilterLabel(text);
            syncDropdownExpandedState(dropdown);
        }

        function setDropdownDisabled(dropdown, disabled) {
            const summary = dropdown.querySelector("summary");
            dropdown.dataset.disabled = disabled ? "true" : "false";
            if (disabled) {
                dropdown.removeAttribute("open");
                summary?.classList.add("cursor-not-allowed", "border-zinc-200", "bg-zinc-50", "text-zinc-400");
                summary?.classList.remove("cursor-pointer", "border-zinc-300", "bg-white", "text-zinc-800");
                summary?.setAttribute("aria-disabled", "true");
            } else {
                summary?.classList.add("cursor-pointer", "border-zinc-300", "bg-white", "text-zinc-800");
                summary?.classList.remove("cursor-not-allowed", "border-zinc-200", "bg-zinc-50", "text-zinc-400");
                summary?.removeAttribute("aria-disabled");
            }
            syncDropdownExpandedState(dropdown);
        }

        function setupMultiSelectDropdown(dropdown) {
            const label = dropdown.querySelector("[data-filter-label]");
            const inputs = Array.from(
                dropdown.querySelectorAll('input[data-filter-multi-option]')
            );
            const optionsContainer = dropdown.querySelector(
                "[data-filter-options]"
            );

            optionsContainer?.setAttribute("role", "group");
            optionsContainer?.setAttribute(
                "aria-label",
                dropdown.dataset.filterLabelName || "Hazard Type"
            );

            function renderLabel() {
                const selected = inputs.filter(function (input) {
                    return input.checked;
                });

                if (!label || selected.length === 0 || selected.length === inputs.length) {
                    if (label) label.textContent = "All Hazards";
                    syncDropdownExpandedState(dropdown);
                    return;
                }

                const names = selected.map(function (input) {
                    return titleCaseFilterLabel(
                        input.closest("label")?.querySelector("span")?.textContent
                        || input.value
                    );
                });
                label.textContent = names.length <= 2
                    ? names.join(", ")
                    : `${names.length} Hazards Selected`;
                syncDropdownExpandedState(dropdown);
            }

            dropdown.querySelector("[data-filter-select-all]")?.addEventListener(
                "click",
                function () {
                    inputs.forEach(function (input) {
                        input.checked = true;
                    });
                    renderLabel();
                }
            );

            dropdown.querySelector("[data-filter-clear-all]")?.addEventListener(
                "click",
                function () {
                    inputs.forEach(function (input) {
                        input.checked = false;
                    });
                    renderLabel();
                }
            );
            inputs.forEach(function (input) {
                input.addEventListener("change", renderLabel);
            });
            renderLabel();
        }

        function cascadeChildOptions(childKind) {
            const child = filterDropdownByKind(childKind);
            if (!child) return;

            const parent = filterDropdownByKind(child.dataset.cascadeParent);
            const parentValue = parent?.querySelector("[data-filter-input]")?.value || "";
            const childInput = child.querySelector("[data-filter-input]");
            const childLabel = child.querySelector("[data-filter-label]");
            const defaultOption = child.querySelector('[data-filter-option][data-value=""]');

            if (!parentValue) {
                child.querySelectorAll("[data-filter-option]").forEach(function (option) {
                    option.hidden = option.dataset.value !== "";
                });
                setFilterValue(child, "", child.dataset.disabledLabel || defaultOption?.dataset.label || childLabel?.textContent || "");
                setDropdownDisabled(child, true);
                return;
            }

            setDropdownDisabled(child, false);

            if (
                (!childInput || !childInput.value)
                && defaultOption
            ) {
                setFilterValue(
                    child,
                    "",
                    defaultOption.dataset.label
                    || childLabel?.textContent
                    || ""
                );
            }

            let childSelectionVisible = !childInput || !childInput.value;
            child.querySelectorAll("[data-filter-option]").forEach(function (option) {
                const optionParent = option.dataset.parent || "";
                const isVisible = !optionParent || optionParent === parentValue;
                option.hidden = !isVisible;
                if (isVisible && childInput && option.dataset.value === childInput.value) {
                    childSelectionVisible = true;
                }
            });
            if (!childSelectionVisible && childInput && childLabel) {
                setFilterValue(child, "", defaultOption?.dataset.label || childLabel.textContent);
            }
        }

        filterDropdowns.forEach(function (dropdown) {
            registerDropdownExpandedState(dropdown);
            if (dropdown.dataset.filterMulti === "true") {
                setupMultiSelectDropdown(dropdown);
                dropdown.addEventListener("toggle", function () {
                    if (dropdown.open) {
                        closeFilterDropdowns(dropdown);
                        closePeriodDropdowns();
                    }
                });
                return;
            }
            dropdown.addEventListener("toggle", function () {
                if (dropdown.open && dropdown.dataset.disabled === "true") {
                    dropdown.removeAttribute("open");
                    return;
                }
                if (dropdown.open) {
                    closeFilterDropdowns(dropdown);
                    closePeriodDropdowns();
                }
            });
            dropdown.querySelectorAll("[data-filter-option]").forEach(function (option) {
                option.addEventListener("click", function () {
                    setFilterValue(dropdown, option.dataset.value || "", option.dataset.label || option.textContent.trim());
                    dropdown.removeAttribute("open");
                    if (dropdown.dataset.filterKind === "hazard") {
                        cascadeChildOptions("incident");
                    } else if (dropdown.dataset.filterKind === "region") {
                        cascadeChildOptions("province");
                    } else if (dropdown.dataset.filterKind === "commodity_group") {
                        cascadeChildOptions("commodity_subgroup");
                    }
                });
            });
        });
        cascadeChildOptions("incident");
        cascadeChildOptions("province");
        cascadeChildOptions("commodity_subgroup");

        /*
         * Damage & Losses live Incident dependency.
         *
         * The map/dashboard remains Apply-driven, but Incident choices
         * refresh immediately from the pending form values.
         */
        const dynamicIncidentEndpoint = (
            window.ADD_DAMAGE_LOSSES_INCIDENT_OPTIONS_URL
            || ""
        );

        const dynamicIncidentApi = (
            window.ADDDynamicIncidentOptions
            || null
        );

        const dynamicIncidentDropdown = (
            filterDropdownByKind("incident")
        );

        const dynamicIncidentList = (
            dynamicIncidentDropdown?.querySelector(
                "[data-incident-options-list]"
            )
        );

        const dynamicIncidentForm = (
            dynamicIncidentDropdown?.closest("form")
        );

        let dynamicIncidentAbortController = null;
        let dynamicIncidentSignature = "";
        let dynamicIncidentRefreshTimer = null;

        function dynamicIncidentParameters() {
            const parameters = new URLSearchParams();

            if (!dynamicIncidentForm) {
                return parameters;
            }

            const formData = new FormData(
                dynamicIncidentForm
            );

            formData.forEach(
                function (value, key) {
                    /*
                     * Incident itself must not constrain its own
                     * option lookup. CSRF is irrelevant to this GET.
                     */
                    if (
                        key === "incident"
                        || key === "csrfmiddlewaretoken"
                    ) {
                        return;
                    }

                    parameters.append(
                        key,
                        value
                    );
                }
            );

            return parameters;
        }

        function buildDynamicIncidentButton(
            option
        ) {
            const button = document.createElement(
                "button"
            );

            button.type = "button";

            button.setAttribute(
                "data-filter-option",
                ""
            );

            button.dataset.value = (
                option.value || ""
            );

            button.dataset.label = titleCaseFilterLabel(
                option.label || ""
            );

            button.dataset.parent = (
                option.parent || ""
            );

            button.className = (
                "block w-full rounded-md "
                + "px-2 py-1.5 text-left "
                + "text-sm font-normal "
                + "text-zinc-700 hover:bg-zinc-50"
            );

            button.textContent = titleCaseFilterLabel(
                option.label || ""
            );

            button.addEventListener(
                "click",
                function () {
                    if (!dynamicIncidentDropdown) {
                        return;
                    }

                    setFilterValue(
                        dynamicIncidentDropdown,
                        button.dataset.value || "",
                        button.dataset.label
                        || button.textContent.trim()
                    );

                    dynamicIncidentDropdown.removeAttribute(
                        "open"
                    );
                }
            );

            return button;
        }

        function replaceDynamicIncidentOptions(
            options
        ) {
            if (
                !dynamicIncidentDropdown
                || !dynamicIncidentList
            ) {
                return;
            }

            const input = (
                dynamicIncidentDropdown.querySelector(
                    "[data-filter-input]"
                )
            );

            const previousValue = (
                input?.value || ""
            );

            const normalizedOptions = (
                Array.isArray(options)
                    ? options
                    : []
            );

            dynamicIncidentList.replaceChildren();

            const allOption = (
                buildDynamicIncidentButton(
                    {
                        value: "",
                        label: "All Incidents",
                        parent: "",
                    }
                )
            );

            dynamicIncidentList.appendChild(
                allOption
            );

            normalizedOptions.forEach(
                function (option) {
                    dynamicIncidentList.appendChild(
                        buildDynamicIncidentButton(
                            option
                        )
                    );
                }
            );

            const retainedOption = (
                normalizedOptions.find(
                    function (option) {
                        return (
                            String(
                                option.value || ""
                            )
                            === previousValue
                        );
                    }
                )
            );

            if (retainedOption) {
                setFilterValue(
                    dynamicIncidentDropdown,
                    retainedOption.value,
                    retainedOption.label
                );
            } else {
                setFilterValue(
                    dynamicIncidentDropdown,
                    "",
                    "All Incidents"
                );
            }

            setDropdownDisabled(
                dynamicIncidentDropdown,
                false
            );
        }

        async function refreshDynamicIncidentOptions(
            force
        ) {
            if (
                !dynamicIncidentEndpoint
                || !dynamicIncidentDropdown
                || !dynamicIncidentList
                || !dynamicIncidentForm
                || !dynamicIncidentApi
            ) {
                return;
            }

            const hazardDropdown = (
                filterDropdownByKind("hazard")
            );

            const hazardValue = (
                hazardDropdown?.dataset.filterMulti === "true"
                    ? Array.from(
                        hazardDropdown.querySelectorAll(
                            'input[data-filter-multi-option]:checked'
                        )
                    ).map(function (input) { return input.value; }).join(",")
                    : hazardDropdown?.querySelector("[data-filter-input]")?.value
            ) || "";

            if (!hazardValue) {
                dynamicIncidentSignature = "";

                replaceDynamicIncidentOptions(
                    []
                );

                setFilterValue(
                    dynamicIncidentDropdown,
                    "",
                    dynamicIncidentDropdown
                        .dataset
                        .disabledLabel
                    || "Select a Hazard Type First"
                );

                setDropdownDisabled(
                    dynamicIncidentDropdown,
                    true
                );

                return;
            }

            const parameters = (
                dynamicIncidentParameters()
            );

            const signature = (
                parameters.toString()
            );

            if (
                !force
                && signature
                    === dynamicIncidentSignature
            ) {
                return;
            }

            dynamicIncidentSignature = signature;

            if (dynamicIncidentAbortController) {
                dynamicIncidentAbortController.abort();
            }

            dynamicIncidentAbortController = (
                new AbortController()
            );

            const summary = (
                dynamicIncidentDropdown.querySelector(
                    "summary"
                )
            );

            summary?.setAttribute(
                "aria-busy",
                "true"
            );

            try {
                const result = (
                    await dynamicIncidentApi.requestOptions(
                        {
                            endpoint: dynamicIncidentEndpoint,
                            form: dynamicIncidentForm,
                            signal: (
                                dynamicIncidentAbortController
                                    .signal
                            ),
                            fetchImpl: window.fetch.bind(
                                window
                            ),
                        }
                    )
                );

                replaceDynamicIncidentOptions(
                    result.options
                );
            } catch (error) {
                if (
                    error?.name
                    === "AbortError"
                ) {
                    return;
                }

                /*
                 * Do not leave a stale selected incident attached
                 * to criteria for which it may no longer be valid.
                 */
                dynamicIncidentSignature = "";

                replaceDynamicIncidentOptions(
                    []
                );

                console.warn(
                    "Unable to refresh Damage & Losses "
                    + "incident options.",
                    error
                );
            } finally {
                summary?.removeAttribute(
                    "aria-busy"
                );
            }
        }

        function scheduleDynamicIncidentRefresh() {
            if (!dynamicIncidentEndpoint) {
                return;
            }

            window.clearTimeout(
                dynamicIncidentRefreshTimer
            );

            /*
             * Existing dropdown/period handlers mutate hidden
             * inputs during the current click. Defer one turn so
             * FormData sees their final values.
             */
            dynamicIncidentRefreshTimer = (
                window.setTimeout(
                    function () {
                        refreshDynamicIncidentOptions(
                            false
                        );
                    },
                    0
                )
            );
        }

        if (
            dynamicIncidentEndpoint
            && dynamicIncidentForm
        ) {
            /*
             * Watching the form instead of specific period widgets
             * keeps this compatible with the existing discrete-year
             * and discrete-month UI.
             *
             * The signature check prevents unnecessary requests.
             */
            dynamicIncidentForm.addEventListener(
                "click",
                scheduleDynamicIncidentRefresh
            );

            dynamicIncidentForm.addEventListener(
                "change",
                scheduleDynamicIncidentRefresh
            );

            dynamicIncidentForm.addEventListener(
                "input",
                scheduleDynamicIncidentRefresh
            );

            /*
             * Normalize the initial server-rendered list too.
             */
            refreshDynamicIncidentOptions(
                true
            );
        }

        document.addEventListener("click", function (event) {
            if (!panel.contains(event.target)) {
                panel.removeAttribute("open");
                closePeriodDropdowns();
                closeFilterDropdowns();
            }
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                panel.removeAttribute("open");
                closePeriodDropdowns();
                closeFilterDropdowns();
            }
        });

        let lastScrollTop = pageScroller?.scrollTop || window.scrollY || 0;
        function closeOnScroll(currentScrollTop) {
            if (panel.open && Math.abs(currentScrollTop - lastScrollTop) > 4) {
                panel.removeAttribute("open");
                closePeriodDropdowns();
                closeFilterDropdowns();
            }
            lastScrollTop = currentScrollTop;
        }
        if (pageScroller) {
            pageScroller.addEventListener("scroll", function () {
                closeOnScroll(pageScroller.scrollTop);
            }, { passive: true });
        } else {
            window.addEventListener("scroll", function () {
                closeOnScroll(window.scrollY || 0);
            }, { passive: true });
        }
    });
})();
