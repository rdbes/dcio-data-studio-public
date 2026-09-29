from __future__ import annotations

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


def build_roni_table():
    observations = list(
        ClimateIndexObservation.objects.filter(
            climate_index_id="RONI",
        ).order_by("period_center_date")
    )

    if not observations:
        return {
            "headers": RONI_SEASON_HEADERS,
            "rows": [],
            "start_year": RONI_TABLE_START_YEAR,
            "latest_year": None,
            "observation_count": 0,
        }

    phases = classify_roni_episode_phases(observations)
    displayed = [
        observation
        for observation in observations
        if observation.season_year >= RONI_TABLE_START_YEAR
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
            observation.season_year,
            observation.season_code,
        ): observation
        for observation in displayed
    }
    latest_year = max(
        observation.season_year
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
                    "value": observation.value,
                    "display_value": (
                        f"{observation.value:.2f}"
                    ),
                    "phase": phases[
                        observation.period_center_date
                    ],
                    "is_provisional": (
                        observation.is_provisional
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
