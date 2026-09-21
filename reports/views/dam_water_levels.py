"""Read-only Dam Water Levels module sourced from the standalone monitor."""

from django.shortcuts import render


def dam_water_levels(request):
    """Render the standalone PAGASA dam snapshot inside Data Studio."""

    return render(request, "reports/dam_water_levels.html")
