(function () {
    "use strict";

    const CARD_SELECTOR = "[data-annual-summary-card]";
    const PAGINATION_LINK_SELECTOR =
        '[aria-label="Annual summary pages"] a[href]';
    const NO_PAGE_TRANSITION_ATTRIBUTE =
        "data-no-page-transition";

    let activeRequestController = null;

    function getAnnualSummaryCard() {
        return document.querySelector(CARD_SELECTOR);
    }

    function markCardPaginationLinks(root) {
        if (!root || !root.querySelectorAll) {
            return;
        }

        root.querySelectorAll(
            PAGINATION_LINK_SELECTOR
        ).forEach(function (link) {
            if (!link.closest(CARD_SELECTOR)) {
                return;
            }

            link.setAttribute(
                NO_PAGE_TRANSITION_ATTRIBUTE,
                "true"
            );
        });
    }

    function setBusy(card, isBusy) {
        if (!card) {
            return;
        }

        if (isBusy) {
            card.setAttribute(
                "aria-busy",
                "true"
            );
        } else {
            card.removeAttribute(
                "aria-busy"
            );
        }
    }

    function focusUpdatedCard(card) {
        if (!card) {
            return;
        }

        card.setAttribute(
            "tabindex",
            "-1"
        );

        try {
            card.focus({
                preventScroll: true
            });
        } catch (error) {
            card.focus();
        }

        card.addEventListener(
            "blur",
            function () {
                card.removeAttribute(
                    "tabindex"
                );
            },
            {
                once: true
            }
        );
    }

    function hardNavigate(url) {
        window.location.assign(url);
    }

    async function updateAnnualSummary(
        requestedUrl
    ) {
        const currentCard =
            getAnnualSummaryCard();

        if (!currentCard) {
            hardNavigate(requestedUrl);
            return;
        }

        if (activeRequestController) {
            activeRequestController.abort();
        }

        const controller =
            new AbortController();

        activeRequestController =
            controller;

        const url = new URL(
            requestedUrl,
            window.location.href
        );

        let fallbackUrl = url.href;

        setBusy(
            currentCard,
            true
        );

        try {
            const response = await fetch(
                url.href,
                {
                    method: "GET",
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: {
                        "X-Requested-With":
                            "XMLHttpRequest"
                    },
                    signal: controller.signal
                }
            );

            fallbackUrl =
                response.url || fallbackUrl;

            if (!response.ok) {
                throw new Error(
                    "Annual Summary request "
                    + "failed: "
                    + response.status
                );
            }

            const responseHtml =
                await response.text();

            const responseDocument =
                new DOMParser().parseFromString(
                    responseHtml,
                    "text/html"
                );

            const nextCard =
                responseDocument.querySelector(
                    CARD_SELECTOR
                );

            if (!nextCard) {
                throw new Error(
                    "Annual Summary card was "
                    + "missing from the response."
                );
            }

            /*
             * Mark the replacement links before
             * inserting them so the global page
             * transition handler always ignores
             * this card-level navigation.
             */
            markCardPaginationLinks(nextCard);

            currentCard.replaceWith(nextCard);

            focusUpdatedCard(nextCard);
        } catch (error) {
            if (
                error.name === "AbortError"
            ) {
                return;
            }

            /*
             * Normal navigation remains available
             * as the progressive-enhancement
             * fallback when AJAX fails.
             */
            hardNavigate(fallbackUrl);
        } finally {
            if (
                activeRequestController
                === controller
            ) {
                setBusy(
                    getAnnualSummaryCard(),
                    false
                );

                activeRequestController =
                    null;
            }
        }
    }

    /*
     * The script is loaded after the dashboard
     * markup, so mark the initial pagination
     * links before the user can interact with
     * them.
     */
    markCardPaginationLinks(document);

    document.addEventListener(
        "click",
        function (event) {
            const target = event.target;

            if (!(target instanceof Element)) {
                return;
            }

            const link = target.closest(
                PAGINATION_LINK_SELECTOR
            );

            if (
                !link
                || !link.closest(CARD_SELECTOR)
                || event.defaultPrevented
                || event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
                || link.hasAttribute(
                    "download"
                )
                || (
                    link.target
                    && link.target !== "_self"
                )
            ) {
                return;
            }

            const url = new URL(
                link.href,
                window.location.href
            );

            if (
                url.origin
                !== window.location.origin
            ) {
                return;
            }

            event.preventDefault();

            updateAnnualSummary(
                url.href
            );
        }
    );
})();
