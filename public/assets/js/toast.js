(function () {
    "use strict";

    function dismissToast(toast) {
        toast.classList.remove("is-visible");
        window.setTimeout(function () {
            toast.remove();
        }, 200);
    }

    function showToast(message, options) {
        const settings = options || {};
        const type = settings.type === "error" ? "error" : "success";
        const container = document.getElementById("toast-container");
        if (!container) {
            return;
        }

        const toast = document.createElement("div");
        const text = document.createElement("span");
        const dismissButton = document.createElement("button");
        toast.className = `add-runtime-toast add-runtime-toast--${type}`;
        toast.setAttribute("role", type === "error" ? "alert" : "status");
        text.textContent = String(message || "Action completed.");
        dismissButton.type = "button";
        dismissButton.className = "add-runtime-toast__dismiss";
        dismissButton.setAttribute("aria-label", "Dismiss notification");
        dismissButton.textContent = "×";
        dismissButton.addEventListener("click", function () {
            dismissToast(toast);
        });
        toast.append(text, dismissButton);
        container.appendChild(toast);

        window.requestAnimationFrame(function () {
            toast.classList.add("is-visible");
        });
        window.setTimeout(function () {
            if (toast.isConnected) {
                dismissToast(toast);
            }
        }, Number(settings.duration) || 4000);
    }

    window.ADDToast = { show: showToast };
})();
