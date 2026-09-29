"""Crop-production analytics views."""

from __future__ import annotations

import logging
from pathlib import Path

from django.conf import settings
from django.db import DatabaseError
from django.shortcuts import render

from reports.services.public_data import load_public_json

from reports.climate.roni import RONI_INDEX_KEY, build_roni_calendar_maps
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
        module_name = {
            "crop-production release": "modules/crop-production.json",
            "crop-area-harvested release": "modules/crop-area-harvested.json",
            "crop-location release": "modules/crop-location.json",
            "RONI snapshot": "modules/roni.json",
        }.get(description)
        payload = load_public_json(module_name, data_path) if module_name else None
        if payload is None:
            raise OSError("Unknown public data module.")
    except OSError:
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


def _load_roni_calendar_maps() -> tuple[dict, dict]:
    """Return RONI phase and anomaly values for each available month."""

    if getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
        snapshot = _load_roni_snapshot()
        observations = snapshot.get("observations", [])
        if isinstance(observations, list) and observations:
            return build_roni_calendar_maps(observations)
        phases = snapshot.get("phase_by_year_month", {})
        return (phases if isinstance(phases, dict) else {}), {}

    try:
        observations = list(
            ClimateIndexObservation.objects.filter(
                climate_index_id=RONI_INDEX_KEY,
            )
            .only("period_start_date", "period_center_date", "period_end_date", "value")
            .order_by("period_center_date")
        )
    except DatabaseError:
        logger.exception("Unable to load RONI data for Crop Production")
        return {}, {}

    return build_roni_calendar_maps(observations)


def crop_production(request):
    """Show national palay and corn production by selectable period."""

    payload = _load_crop_production_data()
    location_payload = _load_crop_location_data()
    roni_snapshot = _load_roni_snapshot()
    payload["roni_source"] = roni_snapshot.get("source", {})
    (
        payload["roni_phase_by_year_month"],
        payload["roni_anomaly_by_year_month"],
    ) = _load_roni_calendar_maps()
    return render(
        request,
        "reports/crop_production.html",
        {
            "crop_production_data": payload,
            "crop_location_data": location_payload,
            "summary_range_modes": SUMMARY_RANGE_MODES,
        },
    )
