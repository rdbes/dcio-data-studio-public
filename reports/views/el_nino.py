"""El Niño-only dashboard and analytics views for the Drought Monitor."""

from .damage_losses import dashboard as dashboard_view
from .dashboard import analytics as analytics_view

EL_NINO_HAZARD_KEY = "HZD_EL_NINO"


def _with_el_nino_filter(request, view):
    """Run a shared Data Studio view with an immutable El Niño scope."""

    query = request.GET.copy()
    query.setlist("hazard", [EL_NINO_HAZARD_KEY])
    query.pop("incident", None)
    original_query = request.GET
    original_marker = getattr(request, "_drought_monitor_el_nino", None)
    request.GET = query
    request._drought_monitor_el_nino = True
    try:
        return view(request)
    finally:
        request.GET = original_query
        if original_marker is None:
            try:
                del request._drought_monitor_el_nino
            except AttributeError:
                pass
        else:
            request._drought_monitor_el_nino = original_marker


def el_nino_dashboard(request):
    """Show the shared map dashboard scoped to El Niño records."""

    return _with_el_nino_filter(request, dashboard_view)


def el_nino_analytics(request):
    """Show the shared analytics dashboard scoped to El Niño records."""

    return _with_el_nino_filter(request, analytics_view)


__all__ = (
    "EL_NINO_HAZARD_KEY",
    "el_nino_dashboard",
    "el_nino_analytics",
)
