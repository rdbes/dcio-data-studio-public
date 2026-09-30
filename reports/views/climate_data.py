from pathlib import Path

from django.conf import settings
from django.shortcuts import render

from reports.climate.dry_day_analysis import (
    build_dry_day_analysis,
    build_dry_day_analysis_from_snapshot,
)
from reports.climate.roni_analysis import (
    build_roni_table,
    build_roni_table_from_snapshot,
)
from reports.services.public_data import load_public_json


def climate_data(request):
    """Render the reviewed PAGASA dry-day normals explorer."""
    selected_region = request.GET.get("region", "")
    search_query = request.GET.get("q", "")
    if getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
        payload = load_public_json(
            "modules/dry-days.json",
            Path(settings.BASE_DIR) / "data" / "climate" / "dry-days.json",
        )
        analysis = build_dry_day_analysis_from_snapshot(
            payload,
            selected_region=selected_region,
            search_query=search_query,
        )
    else:
        analysis = build_dry_day_analysis(
            selected_region=selected_region,
            search_query=search_query,
        )

    return render(
        request,
        "reports/climate_data.html",
        {
            "analysis": analysis,
        },
    )


def climate_roni(request):
    """Render the standalone NOAA RONI table in Weather and Climate Data."""
    if getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
        snapshot = load_public_json(
            "modules/roni.json",
            Path(settings.BASE_DIR) / "data" / "crop" / "roni.json",
        )
        roni_table = build_roni_table_from_snapshot(snapshot)
    else:
        roni_table = build_roni_table()
    return render(
        request,
        "reports/climate_roni.html",
        {
            "current_view": "roni",
            "roni_table": roni_table,
        },
    )
