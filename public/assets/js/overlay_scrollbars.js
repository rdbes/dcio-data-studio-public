(function () {
    "use strict";

    const entries = [];
    let nextContainerId = 0;
    let updateFrame = null;

    function isOverflowValue(value) {
        return value === "auto" || value === "scroll" || value === "overlay";
    }

    function isScrollContainer(element) {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        return isOverflowValue(style.overflowX) || isOverflowValue(style.overflowY);
    }

    function createAxisScrollbar(scrollContainer, axis) {
        const scrollbar = document.createElement("div");
        const thumb = document.createElement("div");
        const isVertical = axis === "vertical";

        scrollbar.className = `overlay-scrollbar overlay-scrollbar--${axis}`;
        scrollbar.setAttribute("role", "scrollbar");
        scrollbar.setAttribute(
            "aria-label",
            `${isVertical ? "Vertical" : "Horizontal"} content scrollbar`,
        );
        scrollbar.setAttribute("aria-controls", scrollContainer.id);
        scrollbar.setAttribute("aria-orientation", axis);
        scrollbar.tabIndex = isVertical && scrollContainer.matches(
            "[data-page-body], .report-table-wrap, [data-analytics-content-scroll], [data-dashboard-analysis-panel]",
        ) ? 0 : -1;
        thumb.className = "overlay-scrollbar__thumb";
        scrollbar.append(thumb);
        document.body.append(scrollbar);

        const entry = { axis, isVertical, scrollContainer, scrollbar, thumb, hideTimer: null, update };

        function update() {
            const rect = scrollContainer.getBoundingClientRect();
            const maxScroll = Math.max(
                0,
                (isVertical ? scrollContainer.scrollHeight - scrollContainer.clientHeight
                    : scrollContainer.scrollWidth - scrollContainer.clientWidth),
            );
            const hasScroll = maxScroll > 0 && rect.width > 0 && rect.height > 0;
            const otherAxis = entries.find(
                (candidate) => candidate.scrollContainer === scrollContainer
                    && candidate.axis !== axis,
            );
            const otherMaxScroll = otherAxis
                ? Math.max(
                    0,
                    (otherAxis.isVertical
                        ? scrollContainer.scrollHeight - scrollContainer.clientHeight
                        : scrollContainer.scrollWidth - scrollContainer.clientWidth),
                )
                : 0;

            scrollbar.hidden = !hasScroll;
            if (!hasScroll) {
                scrollbar.classList.remove("is-visible");
                return;
            }

            const inset = 4;
            const cornerInset = otherMaxScroll > 0 ? 14 : 8;
            const trackLength = isVertical
                ? Math.max(0, rect.height - cornerInset)
                : Math.max(0, rect.width - cornerInset);
            const viewportLength = isVertical ? scrollContainer.clientHeight : scrollContainer.clientWidth;
            const contentLength = isVertical ? scrollContainer.scrollHeight : scrollContainer.scrollWidth;
            const thumbLength = Math.max(24, trackLength * (viewportLength / contentLength));
            const maxThumbOffset = Math.max(0, trackLength - thumbLength);
            const scrollPosition = isVertical ? scrollContainer.scrollTop : scrollContainer.scrollLeft;
            const thumbOffset = maxScroll > 0 ? maxThumbOffset * (scrollPosition / maxScroll) : 0;

            if (isVertical) {
                scrollbar.style.top = `${rect.top + inset}px`;
                scrollbar.style.left = `${Math.max(0, rect.right - 6)}px`;
                scrollbar.style.height = `${trackLength}px`;
            } else {
                scrollbar.style.left = `${rect.left + inset}px`;
                scrollbar.style.top = `${Math.max(0, rect.bottom - 6)}px`;
                scrollbar.style.width = `${trackLength}px`;
            }
            thumb.style.transform = isVertical
                ? `translateY(${thumbOffset}px)`
                : `translateX(${thumbOffset}px)`;
            if (isVertical) {
                thumb.style.height = `${thumbLength}px`;
            } else {
                thumb.style.width = `${thumbLength}px`;
            }
            scrollbar.setAttribute("aria-valuemin", "0");
            scrollbar.setAttribute("aria-valuemax", `${maxScroll}`);
            scrollbar.setAttribute("aria-valuenow", `${Math.round(scrollPosition)}`);
        }

        function hideAfterScroll() {
            window.clearTimeout(entry.hideTimer);
            entry.hideTimer = window.setTimeout(() => {
                if (!scrollbar.matches(":focus-visible")) {
                    scrollbar.classList.remove("is-visible");
                }
            }, 700);
        }

        function showWhileScrolling() {
            update();
            if (scrollbar.hidden) return;
            scrollbar.classList.add("is-visible");
            hideAfterScroll();
        }

        scrollbar.addEventListener("focus", showWhileScrolling);
        scrollbar.addEventListener("blur", hideAfterScroll);
        scrollbar.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || scrollbar.hidden) return;
            event.preventDefault();

            const trackRect = scrollbar.getBoundingClientRect();
            const thumbRect = thumb.getBoundingClientRect();
            const trackLength = isVertical ? trackRect.height : trackRect.width;
            const thumbLength = isVertical ? thumbRect.height : thumbRect.width;
            const maxThumbOffset = Math.max(0, trackLength - thumbLength);
            const pointerPosition = isVertical ? event.clientY : event.clientX;
            const thumbStart = isVertical ? thumbRect.top : thumbRect.left;
            const pointerOffset = event.target === thumb
                ? pointerPosition - thumbStart
                : thumbLength / 2;

            const updateFromPointer = (position) => {
                if (maxThumbOffset <= 0) return;
                const thumbOffset = Math.min(
                    maxThumbOffset,
                    Math.max(0, position - (isVertical ? trackRect.top : trackRect.left) - pointerOffset),
                );
                const ratio = thumbOffset / maxThumbOffset;
                if (isVertical) {
                    scrollContainer.scrollTop = ratio * (scrollContainer.scrollHeight - scrollContainer.clientHeight);
                } else {
                    scrollContainer.scrollLeft = ratio * (scrollContainer.scrollWidth - scrollContainer.clientWidth);
                }
                showWhileScrolling();
            };

            const moveThumb = (moveEvent) => {
                updateFromPointer(isVertical ? moveEvent.clientY : moveEvent.clientX);
            };
            const finishDrag = () => {
                scrollbar.releasePointerCapture?.(event.pointerId);
                scrollbar.removeEventListener("pointermove", moveThumb);
                hideAfterScroll();
            };

            updateFromPointer(pointerPosition);
            scrollbar.setPointerCapture?.(event.pointerId);
            scrollbar.addEventListener("pointermove", moveThumb);
            scrollbar.addEventListener("pointerup", finishDrag, { once: true });
            scrollbar.addEventListener("pointercancel", finishDrag, { once: true });
            showWhileScrolling();
        });

        if (isVertical && scrollbar.tabIndex === 0) {
            scrollbar.addEventListener("keydown", (event) => {
                const pageStep = Math.max(1, scrollContainer.clientHeight * 0.9);
                const keySteps = {
                    ArrowDown: 40,
                    ArrowUp: -40,
                    PageDown: pageStep,
                    PageUp: -pageStep,
                };
                if (event.key === "Home") {
                    scrollContainer.scrollTop = 0;
                } else if (event.key === "End") {
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
                } else if (event.key in keySteps) {
                    scrollContainer.scrollTop += keySteps[event.key];
                } else {
                    return;
                }
                event.preventDefault();
                showWhileScrolling();
            });
        }

        scrollContainer.addEventListener("scroll", showWhileScrolling, { passive: true });
        entries.push(entry);
        update();
    }

    function initScrollContainer(element) {
        if (element.hasAttribute("data-overlay-scrollbar-target") || !isScrollContainer(element)) {
            return;
        }

        if (!element.id) {
            element.id = `overlay-scroll-container-${nextContainerId}`;
            nextContainerId += 1;
        }
        element.setAttribute("data-overlay-scrollbar-target", "true");
        createAxisScrollbar(element, "vertical");
        createAxisScrollbar(element, "horizontal");
        scheduleUpdate();

        if (typeof ResizeObserver === "function") {
            const observer = new ResizeObserver(scheduleUpdate);
            observer.observe(element);
        }
    }

    function scanScrollContainers() {
        document.querySelectorAll("*").forEach(initScrollContainer);
    }

    function scheduleUpdate() {
        if (updateFrame !== null) return;
        updateFrame = window.requestAnimationFrame(() => {
            updateFrame = null;
            entries.forEach((entry) => entry.update());
        });
    }

    scanScrollContainers();
    window.addEventListener("resize", scheduleUpdate, { passive: true });
    window.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });

    if (typeof MutationObserver === "function") {
        const observer = new MutationObserver(scanScrollContainers);
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
