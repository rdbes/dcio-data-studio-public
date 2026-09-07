from django.shortcuts import render

from reports.hazards.incidents import build_incident_year_groups


def hazard_incidents(request):
    """Render calendar-year incident damage summaries."""
    return render(
        request,
        "reports/hazard_incidents.html",
        {"year_groups": build_incident_year_groups()},
    )
