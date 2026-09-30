from __future__ import annotations

from datetime import date
from decimal import Decimal

from reports.climate.roni import classify_roni_episode_phases
from reports.models import ClimateIndexObservation

RONI_TABLE_START_YEAR = 1996

RONI_SEASON_HEADERS = (
    {"code": "DJF", "months": "Dec-Jan-Feb"},
    {"code": "JFM", "months": "Jan-Feb-Mar"},
    {"code": "FMA", "months": "Feb-Mar-Apr"},
    {"code": "MAM", "months": "Mar-Apr-May"},
    {"code": "AMJ", "months": "Apr-May-Jun"},
    {"code": "MJJ", "months": "May-Jun-Jul"},
    {"code": "JJA", "months": "Jun-Jul-Aug"},
    {"code": "JAS", "months": "Jul-Aug-Sep"},
    {"code": "ASO", "months": "Aug-Sep-Oct"},
    {"code": "SON", "months": "Sep-Oct-Nov"},
    {"code": "OND", "months": "Oct-Nov-Dec"},
    {"code": "NDJ", "months": "Nov-Dec-Jan"},
)


def _observation_value(observation, field):
    if isinstance(observation, dict):
        return observation[field]
    return getattr(observation, field)


def _observation_date(observation, field):
    value = _observation_value(observation, field)
    return date.fromisoformat(value) if isinstance(value, str) else value


def _build_roni_table(observations, *, snapshot=False):
    if not observations:
        return {
            "headers": RONI_SEASON_HEADERS,
            "rows": [],
            "start_year": RONI_TABLE_START_YEAR,
            "latest_year": None,
            "observation_count": 0,
        }

    if snapshot:
        phases = {
            _observation_date(observation, "period_center_date"):
            observation.get("phase", "neutral")
            for observation in observations
        }
    else:
        phases = classify_roni_episode_phases(observations)
    displayed = [
        observation
        for observation in observations
        if _observation_value(observation, "season_year") >= RONI_TABLE_START_YEAR
    ]

    if not displayed:
        return {
            "headers": RONI_SEASON_HEADERS,
            "rows": [],
            "start_year": RONI_TABLE_START_YEAR,
            "latest_year": None,
            "observation_count": 0,
        }

    by_season = {
        (
            _observation_value(observation, "season_year"),
            _observation_value(observation, "season_code"),
        ): observation
        for observation in displayed
    }
    latest_year = max(
        _observation_value(observation, "season_year")
        for observation in displayed
    )

    rows = []

    for year in range(
        latest_year,
        RONI_TABLE_START_YEAR - 1,
        -1,
    ):
        cells = []

        for header in RONI_SEASON_HEADERS:
            season_code = header["code"]
            observation = by_season.get(
                (year, season_code)
            )

            if observation is None:
                cells.append(
                    {
                        "season_code": season_code,
                        "value": None,
                        "display_value": "—",
                        "phase": "missing",
                        "is_provisional": False,
                    }
                )
                continue

            cells.append(
                {
                    "season_code": season_code,
                    "value": _observation_value(observation, "value"),
                    "display_value": (
                        f"{Decimal(str(_observation_value(observation, 'value'))):.2f}"
                    ),
                    "phase": phases[_observation_date(observation, "period_center_date")],
                    "is_provisional": (
                        _observation_value(observation, "is_provisional")
                        if not isinstance(observation, dict)
                        else bool(observation.get("is_provisional", False))
                    ),
                }
            )

        rows.append(
            {
                "year": year,
                "cells": cells,
            }
        )

    return {
        "headers": RONI_SEASON_HEADERS,
        "rows": rows,
        "start_year": RONI_TABLE_START_YEAR,
        "latest_year": latest_year,
        "observation_count": len(displayed),
    }


def build_roni_table():
    observations = list(
        ClimateIndexObservation.objects.filter(
            climate_index_id="RONI",
        ).order_by("period_center_date")
    )
    return _build_roni_table(observations)


def build_roni_table_from_snapshot(snapshot: dict):
    """Build the same read-only table from the approved public snapshot."""

    observations = snapshot.get("observations", [])
    if not isinstance(observations, list):
        observations = []
    return _build_roni_table(observations, snapshot=True)
