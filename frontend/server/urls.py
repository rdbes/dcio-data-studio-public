"""An explicit public allow-list with Supabase-gated private module routes."""

from django.urls import include, path
from django.views.decorators.http import require_http_methods, require_safe
from django.views.generic import RedirectView

from frontend.server.auth_views import login, logout, supabase_login_required
from frontend.server.public_data import drought_snapshot
from map_studio.views import public_home as public_map_studio_home
from map_studio.views import public_pagasa_track
from reports.views.bulletin_checker import bulletin_checker
from crop_studio.views import crop_production, damage_matrix
from reports.views.dam_water_levels import (
    dam_water_levels,
    dam_water_levels_data,
    dam_water_levels_report,
)
from reports.views.damage_losses import damage_losses_incident_options, dashboard
from reports.views.dashboard import analytics
from reports.views.el_nino import el_nino_analytics, el_nino_dashboard
from reports.views.incidents import hazard_incidents
from reports.views.program_areas import program_areas
from reports.views.public_agricultural_drought import (
    agricultural_drought as public_agricultural_drought,
)
from reports.views.report_generation import report_generation
from reports.views.seed_distribution import seed_distribution
from reports.views.sra_drought import susceptible_rice_areas
from hazard_studio.views import (
    climate_data,
    climate_roni,
    climate_types,
    tropical_cyclone_frequency,
    tropical_cyclone_similarity,
    tropical_cyclone_tracks,
)

public_patterns = [
    path("dashboard/", require_safe(dashboard), name="dashboard"),
    path("dashboard/incidents/", require_safe(damage_losses_incident_options), name="damage_losses_incidents"),
    path("bulletin-checker/", require_http_methods(["GET", "HEAD", "POST"])(bulletin_checker), name="bulletin_checker"),
    path("analytics/", require_safe(analytics), name="analytics"),
    path("crop-production/", require_safe(crop_production), name="crop_production"),
    path("dam-water-levels/", require_safe(dam_water_levels), name="dam_water_levels"),
    path("dam-water-levels/data/", require_safe(dam_water_levels_data), name="dam_water_levels_data"),
    path(
        "dam-water-levels/report/",
        require_http_methods(["GET", "POST"])(dam_water_levels_report),
        name="dam_water_levels_report",
    ),
    path("incidents/", require_safe(hazard_incidents), name="hazard_incidents"),
    path("tropical-cyclone-tracks/", require_safe(tropical_cyclone_tracks), name="tropical_cyclone_tracks"),
    path("tropical-cyclone-similarity/", require_safe(tropical_cyclone_similarity), name="tropical_cyclone_similarity"),
    path("tropical-cyclone-frequency/", require_safe(tropical_cyclone_frequency), name="tropical_cyclone_frequency"),
    path("report-generation/", require_safe(report_generation), name="report_generation"),
]
private_drought_patterns = [
    path("", supabase_login_required(RedirectView.as_view(pattern_name="drought_monitor:agricultural_drought"))),
    path("el-nino-dashboard/", supabase_login_required(require_safe(el_nino_dashboard)), name="el_nino_dashboard"),
    path("el-nino-analytics/", supabase_login_required(require_safe(el_nino_analytics)), name="el_nino_analytics"),
    path("agricultural-drought-maps/", supabase_login_required(require_safe(public_agricultural_drought)), name="agricultural_drought"),
    path("seed-distribution/", supabase_login_required(require_safe(seed_distribution)), name="seed_distribution"),
    path("program-areas/", supabase_login_required(require_safe(program_areas)), name="program_areas"),
    path("susceptible-rice-areas/", supabase_login_required(require_safe(susceptible_rice_areas)), name="susceptible_rice_areas"),
]
private_crop_studio_patterns = [
    path(
        "",
        RedirectView.as_view(pattern_name="crop_studio:crop_production", query_string=True),
        name="home",
    ),
    path("crop-production/", require_safe(crop_production), name="crop_production"),
    path("damage-matrix/", supabase_login_required(require_safe(damage_matrix)), name="damage_matrix"),
]
public_hazard_studio_patterns = [
    path(
        "",
        RedirectView.as_view(pattern_name="hazard_studio:tropical_cyclone_tracks", query_string=True),
        name="home",
    ),
    path("dam-water-levels/", require_safe(dam_water_levels), name="dam_water_levels"),
    path("dam-water-levels/data/", require_safe(dam_water_levels_data), name="dam_water_levels_data"),
    path(
        "dam-water-levels/report/",
        require_http_methods(["GET", "POST"])(dam_water_levels_report),
        name="dam_water_levels_report",
    ),
    path("tropical-cyclone-tracks/", require_safe(tropical_cyclone_tracks), name="tropical_cyclone_tracks"),
    path("similar-track-occurrence/", require_safe(tropical_cyclone_similarity), name="similar_track_occurrence"),
    path("tropical-cyclone-frequency/", require_safe(tropical_cyclone_frequency), name="tropical_cyclone_frequency"),
    path("dry-days/", require_safe(climate_data), name="dry_days"),
    path("roni/", require_safe(climate_roni), name="roni"),
    path("climate-types/", require_safe(climate_types), name="climate_types"),
]
public_map_studio_patterns = [
    path("", require_safe(public_map_studio_home), name="home"),
    path("pagasa-track/", require_safe(public_pagasa_track), name="pagasa_track"),
]
urlpatterns = [
    path("accounts/login/", login, name="login"),
    path("accounts/logout/", logout, name="logout"),
    path("data/drought/current.json", supabase_login_required(drought_snapshot), name="drought_snapshot"),
    path("", RedirectView.as_view(pattern_name="reports:dashboard")),
    path("", include((public_patterns, "reports"))),
    path("drought-monitor/", include((private_drought_patterns, "drought_monitor"))),
    path("crop-studio/", include((private_crop_studio_patterns, "crop_studio"))),
    path("hazard-studio/", include((public_hazard_studio_patterns, "hazard_studio"))),
    path("map-studio/", include((public_map_studio_patterns, "map_studio"))),
]
