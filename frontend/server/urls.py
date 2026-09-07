"""An explicit allow-list: no authentication, admin or mutation endpoints."""

from django.urls import include, path
from django.views.decorators.http import require_safe
from django.views.generic import RedirectView

from reports.views.damage_losses import damage_losses_incident_options, dashboard
from reports.views.dashboard import analytics
from reports.views.incidents import hazard_incidents
from reports.views.tropical_cyclone_tracks import tropical_cyclone_tracks

public_patterns = [
    path("dashboard/", require_safe(dashboard), name="dashboard"),
    path("dashboard/incidents/", require_safe(damage_losses_incident_options), name="damage_losses_incidents"),
    path("analytics/", require_safe(analytics), name="analytics"),
    path("incidents/", require_safe(hazard_incidents), name="hazard_incidents"),
    path("tropical-cyclone-tracks/", require_safe(tropical_cyclone_tracks), name="tropical_cyclone_tracks"),
]
urlpatterns = [
    path("", RedirectView.as_view(pattern_name="reports:dashboard")),
    path("", include((public_patterns, "reports"))),
]
