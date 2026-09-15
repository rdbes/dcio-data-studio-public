/* Shared sidebar for both local and anonymous pages, without code evaluation. */
(() => {
  const desktop = () => window.matchMedia("(min-width: 1280px)").matches;
  let lastToggle = null;
  let wasDesktop = desktop();
  const stored = () => {
    try { return localStorage.getItem("dcio.sidebarOpen") !== "false"; }
    catch { return true; }
  };
  function setOpen(open, persist = false, restoreFocus = false) {
    document.documentElement.dataset.sidebarOpen = String(open);
    const sidebar = document.querySelector("[data-sidebar-shell]");
    if (sidebar) {
      // CSS owns drawer geometry. Inline width/transform values fight the
      // responsive transition and make the closed mobile drawer collapse.
      sidebar.setAttribute("aria-hidden", String(!open));
      sidebar.inert = !open;
    }
    const mainPanel = document.querySelector("[data-main-panel]");
    if (mainPanel) mainPanel.inert = Boolean(sidebar && open && !desktop());
    const backdrop = document.querySelector("[data-sidebar-backdrop]");
    if (backdrop) {
      backdrop.hidden = !open || desktop();
      backdrop.setAttribute("aria-hidden", String(!open || desktop()));
    }
    document.querySelectorAll("[data-sidebar-toggle]").forEach(button => {
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Hide sidebar" : "Show sidebar");
      button.title = open ? "Hide sidebar" : "Show sidebar";
    });
    document.querySelectorAll("[data-sidebar-icon]").forEach(icon => {
      icon.hidden = (icon.dataset.sidebarIcon === "collapse") !== open;
    });
    if (persist && desktop()) {
      try { localStorage.setItem("dcio.sidebarOpen", String(open)); } catch {}
    }
    if (restoreFocus) {
      const target = open && !desktop()
        ? sidebar?.querySelector("[data-sidebar-close]")
        : lastToggle;
      if (target && typeof target.focus === "function") {
        window.requestAnimationFrame(() => target.focus());
      }
    }
    window.dispatchEvent(new Event("dcio:sidebar-changed"));
  }
  document.addEventListener("click", event => {
    const toggle = event.target.closest("[data-sidebar-toggle]");
    if (toggle) {
      lastToggle = toggle;
      setOpen(document.documentElement.dataset.sidebarOpen !== "true", true, true);
    } else if (event.target.closest("[data-sidebar-backdrop], [data-sidebar-close]")) {
      setOpen(false, true, true);
    }
  });
  document.addEventListener("keydown", event => {
    if (desktop() || document.documentElement.dataset.sidebarOpen !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false, false, true);
    }
    if (event.key === "Tab") {
      const sidebar = document.querySelector("[data-sidebar-shell]");
      const controls = Array.from(sidebar?.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]') || [])
        .filter(control => control.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  window.addEventListener("resize", () => {
    if (desktop() === wasDesktop) return;
    wasDesktop = desktop();
    setOpen(wasDesktop && stored(), false, true);
  });
  setOpen(desktop() && stored());
})();
