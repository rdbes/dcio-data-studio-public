document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-incident-accordion]").forEach((accordion) => {
        const yearGroups = Array.from(
            accordion.querySelectorAll("details[data-incident-year]")
        );

        yearGroups.forEach((yearGroup) => {
            yearGroup.addEventListener("toggle", () => {
                if (!yearGroup.open || accordion.dataset.searchActive === "true") return;

                yearGroups.forEach((otherGroup) => {
                    if (otherGroup !== yearGroup) otherGroup.open = false;
                });
            });
        });
    });

    const searchForm = document.querySelector("[data-incident-search-form]");
    const searchInput = document.querySelector("[data-incident-search-input]");
    const searchClear = document.querySelector("[data-incident-search-clear]");
    const searchStatus = document.querySelector("[data-incident-search-status]");
    const searchEmpty = document.querySelector("[data-incident-search-empty]");
    const yearGroupsContainer = document.querySelector("[data-incident-year-groups]");

    if (searchForm && searchInput && yearGroupsContainer) {
        const yearGroups = Array.from(
            yearGroupsContainer.querySelectorAll("details[data-incident-year]")
        );

        function applyIncidentSearch(rawQuery) {
            const query = rawQuery.trim().toLowerCase();
            let matchCount = 0;
            let matchedYearCount = 0;
            yearGroupsContainer.dataset.searchActive = query !== ""
                ? "true"
                : "false";

            yearGroups.forEach((yearGroup) => {
                const incidentRows = Array.from(
                    yearGroup.querySelectorAll("[data-incident-row]")
                );
                const matchingRows = incidentRows.filter((row) => (
                    incidentName(row).toLowerCase().includes(query)
                ));
                const totalRow = yearGroup.querySelector("[data-incident-total]");
                const countBadge = yearGroup.querySelector("[data-incident-year-count]");

                incidentRows.forEach((row) => {
                    row.hidden = query !== "" && !matchingRows.includes(row);
                });
                if (totalRow) totalRow.hidden = query !== "";

                if (query !== "") {
                    if (!Object.hasOwn(yearGroup.dataset, "searchPreviousOpen")) {
                        yearGroup.dataset.searchPreviousOpen = String(yearGroup.open);
                    }
                    yearGroup.hidden = matchingRows.length === 0;
                    yearGroup.open = matchingRows.length > 0;
                    if (countBadge) {
                        countBadge.textContent = `${matchingRows.length} incident${matchingRows.length === 1 ? "" : "s"}`;
                    }
                } else {
                    yearGroup.hidden = false;
                    if (Object.hasOwn(yearGroup.dataset, "searchPreviousOpen")) {
                        yearGroup.open = yearGroup.dataset.searchPreviousOpen === "true";
                        delete yearGroup.dataset.searchPreviousOpen;
                    }
                    if (countBadge) {
                        const totalCount = Number(countBadge.dataset.totalCount || 0);
                        countBadge.textContent = `${totalCount} incident${totalCount === 1 ? "" : "s"}`;
                    }
                }

                matchCount += matchingRows.length;
                if (matchingRows.length > 0) matchedYearCount += 1;
            });

            if (searchClear) searchClear.classList.toggle("hidden", query === "");
            if (searchEmpty) searchEmpty.hidden = query === "" || matchCount > 0;
            if (searchStatus) {
                searchStatus.textContent = query === ""
                    ? ""
                    : matchCount === 0
                        ? `No incidents found for “${rawQuery.trim()}”.`
                        : `Showing ${matchCount} matching incident${matchCount === 1 ? "" : "s"} across ${matchedYearCount} year${matchedYearCount === 1 ? "" : "s"}.`;
            }
        }

        searchForm.addEventListener("submit", (event) => {
            event.preventDefault();
            applyIncidentSearch(searchInput.value);
        });

        searchClear?.addEventListener("click", () => {
            searchInput.value = "";
            applyIncidentSearch("");
            searchInput.focus();
        });
    }

    const modal = document.querySelector("[data-incident-dashboard-modal]");
    const modalTitle = modal?.querySelector("[data-incident-dashboard-title]");
    const dashboardFrame = modal?.querySelector("[data-incident-dashboard-frame]");
    const modalStatus = modal?.querySelector("[data-incident-dashboard-status]");
    const closeButtons = modal?.querySelectorAll("[data-incident-dashboard-close]") || [];
    let activeRow = null;

    if (!modal || !modalTitle || !dashboardFrame) return;

    function closeModal() {
        if (typeof modal.close === "function") {
            if (modal.open) modal.close();
        } else {
            modal.removeAttribute("open");
        }
    }

    function openModal() {
        if (modal.open) return;
        if (typeof modal.showModal === "function") {
            modal.showModal();
        } else {
            modal.setAttribute("open", "open");
        }
    }

    function incidentName(row) {
        return (
            row.querySelector('th[scope="row"] > span > span')?.textContent.trim()
            || row.querySelector('th[scope="row"]')?.textContent.trim()
            || "Incident details"
        );
    }

    function openIncidentDashboard(row) {
        const dashboardUrl = row.dataset.incidentDashboardUrl;
        if (!dashboardUrl) return;

        activeRow = row;
        const cells = Array.from(row.cells);
        const name = incidentName(row);
        const incidentContext = [
            cells[1]?.textContent.trim(),
            cells[3]?.textContent.trim(),
        ].filter(Boolean).join(", ");
        modalTitle.textContent = incidentContext
            ? `${name} (${incidentContext})`
            : name;
        dashboardFrame.title = `${name} dashboard`;
        dashboardFrame.setAttribute("aria-busy", "true");
        dashboardFrame.src = dashboardUrl;
        if (modalStatus) modalStatus.textContent = `Loading dashboard for ${name}.`;
        openModal();
    }

    dashboardFrame.addEventListener("load", () => {
        dashboardFrame.setAttribute("aria-busy", "false");
        if (modalStatus && activeRow) {
            modalStatus.textContent = `${incidentName(activeRow)} dashboard loaded.`;
        }
    });

    document.querySelectorAll("[data-incident-row][data-incident-dashboard-url]").forEach((row) => {
        row.addEventListener("click", (event) => {
            if (event.target.closest("a, button, input, select, textarea")) return;
            openIncidentDashboard(row);
        });
        row.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            openIncidentDashboard(row);
        });
    });

    closeButtons.forEach((button) => {
        button.addEventListener("click", closeModal);
    });

    modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
    });

    modal.addEventListener("close", () => {
        dashboardFrame.setAttribute("aria-busy", "false");
        dashboardFrame.src = "about:blank";
        activeRow?.focus();
        activeRow = null;
    });
});
