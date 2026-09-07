/* The shared sidebar without an expression evaluator on anonymous pages. */
(() => {
  const desktop = () => window.matchMedia("(min-width: 1280px)").matches;
  const stored = () => {
    try { return localStorage.getItem("dcio.sidebarOpen") !== "false"; }
    catch { return true; }
  };
  function setOpen(open, persist = false) {
    document.documentElement.dataset.sidebarOpen = String(open);
    const sidebar = document.querySelector("[data-sidebar-shell]");
    if (sidebar) {
      sidebar.style.width = open ? "" : "0px";
      sidebar.style.overflow = open ? "" : "hidden";
      sidebar.style.transform = open || desktop() ? "" : "translateX(-100%)";
    }
    const backdrop = document.querySelector("[data-sidebar-backdrop]");
    if (backdrop) {
      backdrop.removeAttribute("x-cloak");
      backdrop.hidden = !open || desktop();
    }
    document.querySelectorAll("[data-sidebar-toggle]").forEach(button => {
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Hide sidebar" : "Show sidebar");
      button.title = open ? "Hide sidebar" : "Show sidebar";
    });
    document.querySelectorAll("[data-sidebar-icon]").forEach(icon => {
      icon.removeAttribute("x-cloak");
      icon.hidden = (icon.dataset.sidebarIcon === "collapse") !== open;
    });
    if (persist && desktop()) {
      try { localStorage.setItem("dcio.sidebarOpen", String(open)); } catch {}
    }
    window.dispatchEvent(new Event("dcio:sidebar-changed"));
  }
  document.addEventListener("click", event => {
    if (event.target.closest("[data-sidebar-toggle]")) {
      setOpen(document.documentElement.dataset.sidebarOpen !== "true", true);
    } else if (event.target.closest('[data-sidebar-backdrop], [aria-label="Close Sidebar"]')) {
      setOpen(false, true);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !desktop()) setOpen(false);
  });
  window.addEventListener("resize", () => setOpen(desktop() && stored()));
  setOpen(desktop() && stored());
})();
