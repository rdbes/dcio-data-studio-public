/* Shared native-dialog controls. Keep this module dependency-free and CSP-safe. */
(function () {
    "use strict";

    const lastTrigger = new WeakMap();

    function focusDialog(dialog) {
        const target = dialog.querySelector(
            "[autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
        );
        target?.focus({ preventScroll: true });
    }

    function openDialog(dialog, trigger) {
        if (!dialog) return;
        if (trigger) lastTrigger.set(dialog, trigger);
        if (typeof dialog.showModal === "function" && !dialog.open) {
            dialog.showModal();
        } else {
            dialog.setAttribute("open", "");
        }
        dialog.setAttribute("aria-hidden", "false");
        trigger?.setAttribute("aria-expanded", "true");
        focusDialog(dialog);
    }

    function closeDialog(dialog) {
        if (!dialog) return;
        if (typeof dialog.close === "function" && dialog.open) {
            dialog.close();
        } else {
            dialog.removeAttribute("open");
        }
        dialog.setAttribute("aria-hidden", "true");
    }

    document.addEventListener("click", (event) => {
        const openTrigger = event.target.closest("[data-dialog-open]");
        if (openTrigger) {
            const dialog = document.getElementById(openTrigger.dataset.dialogOpen);
            if (dialog) {
                event.preventDefault();
                openDialog(dialog, openTrigger);
            }
            return;
        }

        const closeTrigger = event.target.closest("[data-dialog-close]");
        if (closeTrigger) {
            event.preventDefault();
            closeDialog(closeTrigger.closest("dialog"));
        }
    });

    document.querySelectorAll("dialog").forEach((dialog) => {
        dialog.setAttribute("aria-hidden", dialog.open ? "false" : "true");
        dialog.addEventListener("close", () => {
            dialog.setAttribute("aria-hidden", "true");
            const trigger = lastTrigger.get(dialog);
            trigger?.setAttribute("aria-expanded", "false");
            trigger?.focus({ preventScroll: true });
        });
        dialog.addEventListener("click", (event) => {
            if (event.target === dialog && dialog.dataset.dismissible !== "false") {
                closeDialog(dialog);
            }
        });
    });

    document.querySelectorAll("dialog[data-open-on-load='true']").forEach((dialog) => {
        openDialog(dialog);
    });

    const confirmDialog = document.querySelector("[data-confirm-dialog]");
    if (confirmDialog) {
        const title = confirmDialog.querySelector("[data-confirm-title]");
        const message = confirmDialog.querySelector("[data-confirm-message]");
        const label = confirmDialog.querySelector("[data-confirm-label]");
        const icon = confirmDialog.querySelector("[data-confirm-icon]");
        const accept = confirmDialog.querySelector("[data-confirm-accept]");
        const cancel = confirmDialog.querySelector("[data-confirm-cancel]");
        const acceptBaseClass = accept?.className || "ui-button";
        const iconBaseClass = "p-3 rounded-xl shrink-0";
        let pendingForm = null;

        window.addEventListener("confirm-modal", (event) => {
            const detail = event.detail || {};
            pendingForm = detail.formElement || (detail.formId ? document.getElementById(detail.formId) : null);
            if (title) title.textContent = detail.title || "Confirm Action";
            if (message) message.textContent = detail.message || "";
            if (label) label.textContent = detail.confirmText || "Confirm";
            if (accept) {
                accept.className = [
                    acceptBaseClass,
                    detail.confirmClass || "ui-button--danger",
                ].filter(Boolean).join(" ");
            }
            if (icon) {
                icon.className = [
                    iconBaseClass,
                    detail.iconClass || "bg-red-50 text-red-700",
                ].filter(Boolean).join(" ");
            }
            openDialog(confirmDialog, detail.trigger);
        });

        accept?.addEventListener("click", () => {
            const form = pendingForm;
            pendingForm = null;
            closeDialog(confirmDialog);
            form?.requestSubmit();
        });
        cancel?.addEventListener("click", () => {
            pendingForm = null;
            closeDialog(confirmDialog);
        });
        confirmDialog.addEventListener("close", () => {
            pendingForm = null;
        });
    }
}());
