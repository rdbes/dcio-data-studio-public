"""An explicit allow-list: no authentication, admin or mutation endpoints."""

from django.urls import include, path
from django.views.decorators.http import require_http_methods, require_safe
from django.views.generic import RedirectView

from reports.views.bulletin_checker import bulletin_checker
from reports.views.crop_production import crop_production
from reports.views.dam_water_levels import dam_water_levels
from reports.views.damage_losses import damage_losses_incident_options, dashboard
from reports.views.dashboard import analytics
from reports.views.incidents import hazard_incidents
from reports.views.report_generation import report_generation
from reports.views.tropical_cyclone_frequency import tropical_cyclone_frequency
from reports.views.tropical_cyclone_tracks import tropical_cyclone_tracks

public_patterns = [
    path("dashboard/", require_safe(dashboard), name="dashboard"),
    path("dashboard/incidents/", require_safe(damage_losses_incident_options), name="damage_losses_incidents"),
    path("bulletin-checker/", require_http_methods(["GET", "HEAD", "POST"])(bulletin_checker), name="bulletin_checker"),
    path("analytics/", require_safe(analytics), name="analytics"),
    path("crop-production/", require_safe(crop_production), name="crop_production"),
    path("dam-water-levels/", require_safe(dam_water_levels), name="dam_water_levels"),
    path("incidents/", require_safe(hazard_incidents), name="hazard_incidents"),
    path("tropical-cyclone-tracks/", require_safe(tropical_cyclone_tracks), name="tropical_cyclone_tracks"),
    path("tropical-cyclone-frequency/", require_safe(tropical_cyclone_frequency), name="tropical_cyclone_frequency"),
    path("report-generation/", require_safe(report_generation), name="report_generation"),
]
urlpatterns = [
    path("", RedirectView.as_view(pattern_name="reports:dashboard")),
    path("", include((public_patterns, "reports"))),
]
