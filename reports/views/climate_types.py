"""Weather and Climate Data climate-type map view."""

from django.shortcuts import render


def climate_types(request):
    """Render the reviewed climate-type trace related to PSGC boundaries."""
    return render(
        request,
        "reports/climate_types.html",
        {"current_view": "climate_types"},
    )
