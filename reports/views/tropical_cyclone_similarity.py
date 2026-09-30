"""Read-only similarity workspace for an active tropical-cyclone track."""

from __future__ import annotations

from django.shortcuts import render
from django.utils import timezone

from reports.hazards.tropical_cyclone_similarity import (
    build_climatology_reference_paths,
    build_historical_similarity_tracks,
)


def tropical_cyclone_similarity(request):
    """Compare an active operational track with archived occurrences."""

    historical_tracks = build_historical_similarity_tracks()

    return render(
        request,
        "reports/tropical_cyclone_similarity.html",
        {
            "historical_tracks": historical_tracks,
            "climatology_paths": build_climatology_reference_paths(),
            "default_climatology_month": timezone.localdate().month,
            "ranked_tracks": [],
        },
    )
