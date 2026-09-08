(function () {
    "use strict";

    const form = document.querySelector(
        "[data-report-generation-form]"
    );

    const modal = document.querySelector(
        "[data-report-preview-modal]"
    );

    if (!form || !modal) {
        return;
    }

    const downloadButton = modal.querySelector(
        "[data-report-download-button]"
    );

    const progressLayer = modal.querySelector(
        "[data-report-download-progress]"
    );

    if (!downloadButton || !progressLayer) {
        return;
    }

    const elements = {
        iconWrap: progressLayer.querySelector(
            "[data-report-download-icon-wrap]"
        ),
        icon: progressLayer.querySelector(
            "[data-report-download-icon]"
        ),
        title: progressLayer.querySelector(
            "[data-report-download-title]"
        ),
        message: progressLayer.querySelector(
            "[data-report-download-message]"
        ),
        track: progressLayer.querySelector(
            "[data-report-download-bar-track]"
        ),
        bar: progressLayer.querySelector(
            "[data-report-download-bar]"
        ),
        percent: progressLayer.querySelector(
            "[data-report-download-percent]"
        ),
        bytes: progressLayer.querySelector(
            "[data-report-download-bytes]"
        ),
        actions: progressLayer.querySelector(
            "[data-report-download-actions]"
        ),
        retry: progressLayer.querySelector(
            "[data-report-download-retry]"
        ),
        dismiss: progressLayer.querySelector(
            "[data-report-download-dismiss]"
        )
    };

    let downloadActive = false;
    let pollTimer = null;
    let timeoutTimer = null;
    let activeFrame = null;
    let activeCookieName = "";

    function setIcon(state) {
        elements.iconWrap.classList.remove(
            "is-working",
            "is-success",
            "is-error"
        );

        if (state === "success") {
            elements.iconWrap.classList.add(
                "is-success"
            );
            elements.icon.className = (
                "fa-solid fa-circle-check"
            );
            return;
        }

        if (state === "error") {
            elements.iconWrap.classList.add(
                "is-error"
            );
            elements.icon.className = (
                "fa-solid "
                + "fa-triangle-exclamation"
            );
            return;
        }

        elements.iconWrap.classList.add(
            "is-working"
        );
        elements.icon.className = (
            "fa-solid fa-file-arrow-down"
        );
    }

    function showProgress({
        title,
        message,
        state = "working",
        showActions = false
    }) {
        progressLayer.hidden = false;

        elements.title.textContent = title;
        elements.message.textContent = message;
        elements.actions.hidden = (
            !showActions
        );

        setIcon(state);

        if (state === "working") {
            elements.track.classList.add(
                "is-indeterminate"
            );
            elements.bar.style.width = "";
            elements.percent.textContent = (
                "Working…"
            );
        } else {
            elements.track.classList.remove(
                "is-indeterminate"
            );
            elements.bar.style.width = (
                state === "success"
                ? "100%"
                : "0%"
            );
            elements.percent.textContent = (
                state === "success"
                ? "Ready"
                : "Failed"
            );
        }

        elements.bytes.textContent = "";
    }

    function hideProgress() {
        progressLayer.hidden = true;

        elements.track.classList.remove(
            "is-indeterminate"
        );

        elements.bar.style.width = "0%";
        elements.actions.hidden = true;
    }

    function unlockPage() {
        document.body.classList.remove(
            "overflow-hidden"
        );
    }

    function showToast(type, message) {
        const container = document.getElementById(
            "toast-container"
        );

        if (!container) {
            return;
        }

        const toast = document.createElement(
            "div"
        );

        toast.className = (
            "report-download-toast "
            + "report-download-toast--"
            + type
        );

        toast.setAttribute(
            "role",
            type === "error"
                ? "alert"
                : "status"
        );

        const icon = document.createElement(
            "i"
        );

        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        if (type === "success") {
            icon.className = (
                "fa-solid fa-circle-check"
            );
        } else if (type === "error") {
            icon.className = (
                "fa-solid "
                + "fa-triangle-exclamation"
            );
        } else {
            icon.className = (
                "fa-solid fa-circle-info"
            );
        }

        const content = document.createElement(
            "div"
        );

        content.className = (
            "report-download-toast-message"
        );
        content.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(content);
        container.appendChild(toast);

        window.requestAnimationFrame(
            function () {
                toast.classList.add(
                    "is-visible"
                );
            }
        );

        window.setTimeout(
            function () {
                toast.classList.remove(
                    "is-visible"
                );

                window.setTimeout(
                    function () {
                        toast.remove();
                    },
                    220
                );
            },
            type === "error"
                ? 6500
                : 5000
        );
    }

    function makeToken() {
        if (
            window.crypto
            && typeof window.crypto.randomUUID
            === "function"
        ) {
            return window.crypto
                .randomUUID()
                .replaceAll("-", "");
        }

        return (
            Date.now().toString(36)
            + Math.random()
                .toString(36)
                .slice(2)
            + Math.random()
                .toString(36)
                .slice(2)
        ).slice(0, 64);
    }

    function cookieName(token) {
        return (
            "report_download_"
            + token
        );
    }

    function readCookie(name) {
        const prefix = name + "=";

        const item = document.cookie
            .split(";")
            .map((value) => value.trim())
            .find(
                (value) => (
                    value.startsWith(prefix)
                )
            );

        if (!item) {
            return "";
        }

        return decodeURIComponent(
            item.slice(prefix.length)
        );
    }

    function clearCookie(name) {
        document.cookie = (
            name
            + "=; Max-Age=0; Path=/; "
            + "SameSite=Lax"
        );
    }

    function buildDownloadUrl(token) {
        const action = (
            form.getAttribute("action")
            || window.location.pathname
        );

        const url = new URL(
            action,
            window.location.href
        );

        url.search = "";

        const formData = new FormData(form);

        for (
            const [key, value]
            of formData.entries()
        ) {
            if (
                key === "preview"
                || key === "download"
                || value === ""
            ) {
                continue;
            }

            url.searchParams.append(
                key,
                value
            );
        }

        url.searchParams.set(
            "download",
            "1"
        );

        url.searchParams.set(
            "download_token",
            token
        );

        return url;
    }

    function stopPolling() {
        if (pollTimer) {
            window.clearInterval(
                pollTimer
            );
            pollTimer = null;
        }

        if (timeoutTimer) {
            window.clearTimeout(
                timeoutTimer
            );
            timeoutTimer = null;
        }
    }

    function releaseDownloadState() {
        stopPolling();

        downloadActive = false;
        downloadButton.disabled = false;
    }

    function scheduleFrameRemoval(frame) {
        window.setTimeout(
            function () {
                frame.remove();

                if (activeFrame === frame) {
                    activeFrame = null;
                }
            },
            10 * 60 * 1000
        );
    }

    function finishSuccess() {
        releaseDownloadState();

        if (activeCookieName) {
            clearCookie(
                activeCookieName
            );
        }

        showProgress({
            title: "Download ready",
            message: (
                "The Excel file is ready. Check "
                + "your downloads or selected save "
                + "location."
            ),
            state: "success"
        });

        showToast(
            "success",
            (
                "Excel download started. Check "
                + "your downloads for the saved file."
            )
        );

        window.setTimeout(
            function () {
                hideProgress();
                unlockPage();

                window.dispatchEvent(
                    new CustomEvent(
                        "report-download-finished"
                    )
                );

                window.focus();
            },
            1200
        );
    }

    function finishError(message) {
        releaseDownloadState();

        if (activeCookieName) {
            clearCookie(
                activeCookieName
            );
        }

        showProgress({
            title: "Download failed",
            message,
            state: "error",
            showActions: true
        });

        showToast(
            "error",
            (
                "Excel download failed. "
                + "Retry from the preview."
            )
        );
    }

    function startNativeDownload() {
        if (downloadActive) {
            return;
        }

        const token = makeToken();

        activeCookieName = cookieName(
            token
        );

        clearCookie(
            activeCookieName
        );

        downloadActive = true;
        downloadButton.disabled = true;

        showProgress({
            title: "Preparing workbook",
            message: (
                "The report is being generated. "
                + "Waiting for the download to start..."
            )
        });

        const frame = document.createElement(
            "iframe"
        );

        frame.hidden = true;
        frame.name = (
            "report-download-"
            + token
        );
        frame.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.appendChild(
            frame
        );

        activeFrame = frame;

        /*
         * Assigning the attachment URL directly
         * during the user's click preserves the
         * browser's native download permission.
         */
        frame.src = buildDownloadUrl(
            token
        ).toString();

        pollTimer = window.setInterval(
            function () {
                const status = readCookie(
                    activeCookieName
                );

                if (status === "success") {
                    scheduleFrameRemoval(
                        frame
                    );
                    finishSuccess();
                    return;
                }

                if (status === "error") {
                    scheduleFrameRemoval(
                        frame
                    );
                    finishError(
                        "The server could not "
                        + "generate the Excel "
                        + "workbook."
                    );
                }
            },
            250
        );

        timeoutTimer = window.setTimeout(
            function () {
                scheduleFrameRemoval(
                    frame
                );

                finishError(
                    "The download did not start. Check "
                    + "whether downloads are allowed "
                    + "for this site, then try again."
                );
            },
            5 * 60 * 1000
        );
    }

    downloadButton.addEventListener(
        "click",
        startNativeDownload
    );

    elements.retry.addEventListener(
        "click",
        function () {
            hideProgress();
            startNativeDownload();
        }
    );

    elements.dismiss.addEventListener(
        "click",
        function () {
            hideProgress();
            downloadButton.focus();
        }
    );

    window.addEventListener(
        "pagehide",
        function () {
            stopPolling();
            unlockPage();
        }
    );

    window.addEventListener(
        "pageshow",
        function () {
            const modalHidden = (
                modal.hidden
                || window.getComputedStyle(
                    modal
                ).display === "none"
            );

            if (modalHidden) {
                unlockPage();
            }
        }
    );
}());
