"""Small helpers for views that are shared across platform applications."""


def is_el_nino_view(request) -> bool:
    """Return whether the request is for the fixed El Niño Drought Monitor view."""

    return bool(getattr(request, "_drought_monitor_el_nino", False))


def el_nino_route_name(request, suffix: str) -> str:
    """Resolve the El Niño route in the active URL namespace."""

    namespace = getattr(getattr(request, "resolver_match", None), "namespace", "")
    if namespace not in {"agri_drought", "drought_monitor"}:
        namespace = "agri_drought" if request.path.startswith("/drought-monitor/") else "reports"
    return f"{namespace}:el_nino_{suffix}"

