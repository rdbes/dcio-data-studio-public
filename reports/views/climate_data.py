from django.shortcuts import render

from reports.climate.dry_day_analysis import (
    build_dry_day_analysis,
)
from reports.climate.roni_analysis import build_roni_table


def climate_data(request):
    """Render the reviewed PAGASA dry-day normals explorer."""
    analysis = build_dry_day_analysis(
        selected_region=request.GET.get("region", ""),
        search_query=request.GET.get("q", ""),
    )

    return render(
        request,
        "reports/climate_data.html",
        {
            "analysis": analysis,
        },
    )


def climate_roni(request):
    """Render the standalone NOAA RONI table in Hazard Studio."""
    return render(
        request,
        "reports/climate_roni.html",
        {
            "current_view": "roni",
            "roni_table": build_roni_table(),
        },
    )
