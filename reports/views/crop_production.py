"""Crop-production analytics views."""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import DatabaseError
from django.shortcuts import render

from reports.climate.roni import RONI_INDEX_KEY, classify_roni_episode_phases
from reports.models import ClimateIndexObservation

logger = logging.getLogger(__name__)

SUMMARY_RANGE_MODES = (
    ("annual", "Annual"),
    ("s1", "S1"),
    ("s2", "S2"),
    ("q1", "Q1"),
    ("q2", "Q2"),
    ("q3", "Q3"),
    ("q4", "Q4"),
)


def _load_json_data(data_path: Path, description: str) -> dict:
    try:
        with data_path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        logger.exception("Unable to load the bundled %s", description)
        return {}
    return payload if isinstance(payload, dict) else {}


def _crop_data_directory() -> Path:
    """Return the bundled data directory for the active renderer."""

    if getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
        return Path(settings.BASE_DIR) / "data" / "crop"
    return Path(settings.BASE_DIR) / "static" / "data"


def _load_crop_production_data() -> dict:
    """Load national quarterly production and area-harvested PSA releases."""

    data_dir = _crop_data_directory()
    production = _load_json_data(data_dir / "crop-production.json", "crop-production release")
    area_harvested = _load_json_data(data_dir / "crop-area-harvested.json", "crop-area-harvested release")
    production.setdefault("years", [])
    production.setdefault("crop_options", [])
    production.setdefault("series", {})
    production.setdefault("source", {})
    production["area_years"] = area_harvested.get("years", [])
    production["area_series"] = area_harvested.get("series", {})
    production["area_source"] = area_harvested.get("source", {})
    return production


def _load_crop_location_data() -> dict:
    """Load the bundled regional and provincial production release."""

    data_dir = _crop_data_directory()
    payload = _load_json_data(data_dir / "crop-location.json", "crop-location release")
    payload.setdefault("years", [])
    payload.setdefault("locations", [])
    payload.setdefault("series", {})
    payload.setdefault("area_series", {})
    return payload


def _load_roni_snapshot() -> dict:
    if not getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
        return {}
    return _load_json_data(
        _crop_data_directory() / "roni.json",
        "RONI snapshot",
    )


def _load_roni_phase_by_year_month() -> dict:
    """Return the derived RONI phase for each available calendar month."""

    if getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
        snapshot = _load_roni_snapshot()
        phases = snapshot.get("phase_by_year_month", {})
        return phases if isinstance(phases, dict) else {}

    try:
        observations = list(
            ClimateIndexObservation.objects.filter(
                climate_index_id=RONI_INDEX_KEY,
            )
            .only("period_start_date", "period_center_date", "period_end_date", "value")
            .order_by("period_center_date")
        )
    except DatabaseError:
        logger.exception("Unable to load RONI phases for Crop Production")
        return {}

    phases = classify_roni_episode_phases(observations)
    phase_candidates = {}
    for observation in observations:
        phase = phases.get(observation.period_center_date, "neutral")
        month_start = observation.period_start_date.replace(day=1)
        while month_start <= observation.period_end_date:
            year_month = (str(month_start.year), str(month_start.month))
            phase_candidates.setdefault(year_month, []).append(
                (phase, abs(observation.value))
            )
            month_start = (
                month_start.replace(day=28) + timedelta(days=4)
            ).replace(day=1)

    phase_by_year_month = {}
    for (year, month), candidates in phase_candidates.items():
        extreme_candidates = [
            candidate for candidate in candidates
            if candidate[0] in {"warm", "cold"}
        ]
        phase = max(
            extreme_candidates or [("neutral", 0)],
            key=lambda candidate: candidate[1],
        )[0]
        phase_by_year_month.setdefault(year, {})[month] = phase
    return phase_by_year_month


def crop_production(request):
    """Show national palay and corn production by selectable period."""

    payload = _load_crop_production_data()
    location_payload = _load_crop_location_data()
    roni_snapshot = _load_roni_snapshot()
    payload["roni_source"] = roni_snapshot.get("source", {})
    payload["roni_phase_by_year_month"] = _load_roni_phase_by_year_month()
    return render(
        request,
        "reports/crop_production.html",
        {
            "crop_production_data": payload,
            "crop_location_data": location_payload,
            "summary_range_modes": SUMMARY_RANGE_MODES,
        },
    )
