"""Tropical-cyclone occurrence frequency views."""

from __future__ import annotations

import calendar
import math
from collections import Counter

from django.db.models import Prefetch
from django.shortcuts import render
from django.utils import timezone

from reports.hazards.tropical_cyclones import (
    MIN_TROPICAL_CYCLONE_YEAR,
    TROPICAL_CYCLONE_HAZARD_KEY,
)
from reports.location_ordering import region_sort_key
from reports.models import (
    DamageReport,
    DisasterIncidentTropicalCyclone,
    TropicalCyclone,
    TropicalCycloneTrackPoint,
)


FREQUENCY_MODES = {
    "annual": {
        "label": "Annual",
        "axis_label": "Year",
        "title": "Annual Tropical Cyclone Frequency",
    },
    "monthly": {
        "label": "Monthly",
        "axis_label": "Month",
        "title": "Monthly Average Tropical Cyclone Frequency",
    },
    "quarterly": {
        "label": "Quarterly",
        "axis_label": "Quarter",
        "title": "Quarterly Average Tropical Cyclone Frequency",
    },
}

FREQUENCY_DAMAGE_CATEGORIES = (
    ("with_damage", "With Damage Report"),
    ("without_damage", "Without Damage Report"),
)

HEATMAP_PERIOD_OPTIONS = (
    ("5", "5 years"),
    ("10", "10 years"),
    ("15", "15 years"),
    ("all", "All years"),
)

def _occurrence_month(cyclone, points) -> int | None:
    """Resolve a calendar month from the catalogue or earliest track point."""

    if cyclone.start_date:
        return cyclone.start_date.month
    if cyclone.first_tracked_within_par_at:
        return cyclone.first_tracked_within_par_at.month
    if points:
        return min(points, key=lambda point: point.valid_at).valid_at.month
    return None


def _selected_mode(value: str) -> str:
    mode = str(value or "").strip().lower()
    return mode if mode in FREQUENCY_MODES else "annual"


def _selected_heatmap_period(value: str) -> str:
    period = str(value or "").strip().lower()
    return period if period in {key for key, _label in HEATMAP_PERIOD_OPTIONS} else "all"


def tropical_cyclone_frequency(request):
    """Show tropical-cyclone counts by year, month, or quarter.

    Annual counts are grouped by the catalogue occurrence year. Monthly and
    quarterly views aggregate the occurrence month across the reporting
    catalogue (2001 onward), which keeps the x-axis compact while showing the
    seasonal distribution.
    """

    mode_key = _selected_mode(request.GET.get("frequency_period", "annual"))
    mode = FREQUENCY_MODES[mode_key]
    point_queryset = TropicalCycloneTrackPoint.objects.only(
        "cyclone_key",
        "valid_at",
        "track_point_key",
    ).order_by("valid_at", "track_point_key")
    damage_link_queryset = (
        DisasterIncidentTropicalCyclone.objects.filter(
            incident_key__hazard_key_id=TROPICAL_CYCLONE_HAZARD_KEY,
            incident_key__damagereport__is_active=True,
        )
        .only("cyclone_key", "attribution_method")
        .distinct()
    )
    cyclones = list(
        TropicalCyclone.objects.only(
            "cyclone_key",
            "occurrence_year",
            "start_date",
            "first_tracked_within_par_at",
        )
        .prefetch_related(
            Prefetch(
                "track_points",
                queryset=point_queryset,
                to_attr="frequency_track_points",
            ),
            Prefetch(
                "incident_links",
                queryset=damage_link_queryset,
                to_attr="frequency_damage_links",
            ),
        )
        .filter(occurrence_year__gte=MIN_TROPICAL_CYCLONE_YEAR)
        .order_by("occurrence_year", "cyclone_key")
    )

    current_year = timezone.localdate().year
    annual_counts_by_metric = {"all": Counter(), "damage": Counter()}
    monthly_counts_by_metric = {"all": Counter(), "damage": Counter()}
    quarterly_counts_by_metric = {"all": Counter(), "damage": Counter()}
    historical_monthly_counts_by_metric = {"all": Counter(), "damage": Counter()}
    historical_quarterly_counts_by_metric = {"all": Counter(), "damage": Counter()}
    unknown_month_count_by_metric = {"all": 0, "damage": 0}
    occurrence_month_by_cyclone = {}
    occurrence_year_by_cyclone = {}
    for cyclone in cyclones:
        is_historical = cyclone.occurrence_year < current_year
        damage_links = getattr(cyclone, "frequency_damage_links", ())
        has_damage_report = bool(damage_links)
        metrics = ("all", "damage") if has_damage_report else ("all",)
        for metric in metrics:
            annual_counts_by_metric[metric][cyclone.occurrence_year] += 1
        month = _occurrence_month(
            cyclone,
            getattr(cyclone, "frequency_track_points", ()),
        )
        occurrence_month_by_cyclone[cyclone.cyclone_key] = month
        occurrence_year_by_cyclone[cyclone.cyclone_key] = cyclone.occurrence_year
        if month is None:
            for metric in metrics:
                unknown_month_count_by_metric[metric] += 1
            continue
        quarter = ((month - 1) // 3) + 1
        for metric in metrics:
            monthly_counts_by_metric[metric][month] += 1
            quarterly_counts_by_metric[metric][quarter] += 1
            if is_historical:
                historical_monthly_counts_by_metric[metric][month] += 1
                historical_quarterly_counts_by_metric[metric][quarter] += 1

    damage_region_rows = (
        DamageReport.objects.filter(
            is_active=True,
            incident_key__hazard_key_id=TROPICAL_CYCLONE_HAZARD_KEY,
            incident_key__tropical_cyclone_links__cyclone_key__in=[
                cyclone.cyclone_key for cyclone in cyclones
            ],
        )
        .exclude(location_psgc_key__region_name__isnull=True)
        .exclude(location_psgc_key__region_name="")
        .values_list(
            "incident_key__tropical_cyclone_links__cyclone_key",
            "location_psgc_key__region_name",
        )
        .distinct()
    )
    years = sorted(
        year
        for year in annual_counts_by_metric["all"]
        if year >= MIN_TROPICAL_CYCLONE_YEAR
    )
    annual_periods = list(range(years[0], years[-1] + 1)) if years else []
    monthly_periods = list(range(1, 13))
    quarterly_periods = list(range(1, 5))
    historical_years = [year for year in annual_periods if year < current_year]
    average_period_label = (
        f"{historical_years[0]}–{historical_years[-1]}"
        if historical_years
        else ""
    )
    heatmap_period_key = _selected_heatmap_period(request.GET.get("heatmap_period", "all"))
    heatmap_years_by_period = {}
    for period_key, _label in HEATMAP_PERIOD_OPTIONS:
        requested_heatmap_years = (
            len(historical_years)
            if period_key == "all"
            else int(period_key)
        )
        heatmap_years_by_period[period_key] = (
            historical_years[-requested_heatmap_years:] if historical_years else []
        )
    heatmap_period_options = [
        {
            "value": key,
            "label": label,
            "selected": key == heatmap_period_key,
        }
        for key, label in HEATMAP_PERIOD_OPTIONS
    ]

    damage_region_year_counts = {}
    for cyclone_key, region_name in damage_region_rows:
        month = occurrence_month_by_cyclone.get(cyclone_key)
        year = occurrence_year_by_cyclone.get(cyclone_key)
        region_name = str(region_name or "").strip()
        if month is None or year not in historical_years or not region_name:
            continue
        damage_region_year_counts.setdefault(region_name, {}).setdefault(
            month,
            Counter(),
        )[year] += 1

    damage_heatmap_months = [
        {"number": month, "label": calendar.month_abbr[month]}
        for month in range(1, 13)
    ]

    def build_damage_heatmap(period_years):
        damage_heatmap_averages = {}
        for region_name, month_counts in damage_region_year_counts.items():
            damage_heatmap_averages[region_name] = {
                month: (
                    sum(year_counts[year] for year in period_years)
                    / len(period_years)
                    if period_years
                    else 0
                )
                for month, year_counts in month_counts.items()
            }
        damage_heatmap_max = max(
            (
                max(month_averages.values(), default=0)
                for month_averages in damage_heatmap_averages.values()
            ),
            default=0,
        )
        damage_heatmap_rows = []
        for region_name in sorted(damage_heatmap_averages, key=region_sort_key):
            month_averages = damage_heatmap_averages[region_name]
            cells = []
            for month in damage_heatmap_months:
                value = month_averages.get(month["number"], 0)
                level = (
                    min(5, max(1, math.ceil(value / damage_heatmap_max * 5)))
                    if value and damage_heatmap_max
                    else 0
                )
                cells.append({"value": value, "level": level})
            damage_heatmap_rows.append(
                {
                    "region_name": region_name,
                    "cells": cells,
                    "annual_average": sum(cell["value"] for cell in cells),
                }
            )
        # Zero-valued cells render as a dash in the table, so they do not need
        # a separate legend swatch. Keep the legend focused on positive ranges.
        legend_levels = []
        if damage_heatmap_max:
            for level in range(1, 6):
                lower = damage_heatmap_max * (level - 1) / 5
                upper = damage_heatmap_max * level / 5
                if level == 1:
                    # Zero has its own swatch; avoid repeating it as a lower
                    # bound for the first positive interval.
                    label = f"≤{upper:.1f}"
                else:
                    label = f">{lower:.1f}–{upper:.1f}"
                legend_levels.append(
                    {"level": level, "label": label}
                )
        else:
            legend_levels.extend(
                {"level": level, "label": "—"}
                for level in range(1, 6)
            )
        return {
            "rows": damage_heatmap_rows,
            "max_value": damage_heatmap_max,
            "legend_levels": legend_levels,
        }

    damage_heatmap_periods = {
        period_key: {
            **build_damage_heatmap(period_years),
            "period_label": (
                f"{period_years[0]}–{period_years[-1]}"
                if period_years
                else ""
            ),
        }
        for period_key, period_years in heatmap_years_by_period.items()
    }
    selected_damage_heatmap = damage_heatmap_periods[heatmap_period_key]

    metric_chart_data_by_mode = {}
    for metric in ("all", "damage"):
        annual_counts = annual_counts_by_metric[metric]
        monthly_counts = monthly_counts_by_metric[metric]
        quarterly_counts = quarterly_counts_by_metric[metric]
        historical_total = sum(annual_counts[year] for year in historical_years)
        annual_average = (
            historical_total / len(historical_years)
            if historical_years
            else None
        )
        if metric == "damage":
            category_counters = {
                "without_damage": Counter(
                    {
                        year: annual_counts_by_metric["all"][year]
                        - annual_counts_by_metric["damage"][year]
                        for year in annual_periods
                    }
                ),
                "with_damage": annual_counts_by_metric["damage"],
            }
            monthly_category_counters = {
                "without_damage": Counter(
                    {
                        month: monthly_counts_by_metric["all"][month]
                        - monthly_counts_by_metric["damage"][month]
                        for month in monthly_periods
                    }
                ),
                "with_damage": monthly_counts_by_metric["damage"],
            }
            quarterly_category_counters = {
                "without_damage": Counter(
                    {
                        quarter: quarterly_counts_by_metric["all"][quarter]
                        - quarterly_counts_by_metric["damage"][quarter]
                        for quarter in quarterly_periods
                    }
                ),
                "with_damage": quarterly_counts_by_metric["damage"],
            }
            historical_monthly_category_counters = {
                "without_damage": Counter(
                    {
                        month: historical_monthly_counts_by_metric["all"][month]
                        - historical_monthly_counts_by_metric["damage"][month]
                        for month in monthly_periods
                    }
                ),
                "with_damage": historical_monthly_counts_by_metric["damage"],
            }
            historical_quarterly_category_counters = {
                "without_damage": Counter(
                    {
                        quarter: historical_quarterly_counts_by_metric["all"][quarter]
                        - historical_quarterly_counts_by_metric["damage"][quarter]
                        for quarter in quarterly_periods
                    }
                ),
                "with_damage": historical_quarterly_counts_by_metric["damage"],
            }
            category_definitions = FREQUENCY_DAMAGE_CATEGORIES
        else:
            category_counters = {"all": annual_counts}
            monthly_category_counters = {"all": monthly_counts}
            quarterly_category_counters = {"all": quarterly_counts}
            historical_monthly_category_counters = {
                "all": historical_monthly_counts_by_metric[metric]
            }
            historical_quarterly_category_counters = {
                "all": historical_quarterly_counts_by_metric[metric]
            }
            category_definitions = (("all", "Tropical cyclones"),)

        annual_series = []
        monthly_series = []
        quarterly_series = []
        for category in category_definitions:
            category_key, category_label = category
            annual_series.append(
                {
                    "key": category_key,
                    "label": category_label,
                    "values": [
                        category_counters[category_key][year]
                        for year in annual_periods
                    ],
                }
            )
            monthly_series.append(
                {
                    "key": category_key,
                    "label": category_label,
                    "values": [
                        monthly_category_counters[category_key][month]
                        for month in monthly_periods
                    ],
                    "average_values": [
                        historical_monthly_category_counters[category_key][month]
                        / len(historical_years)
                        if historical_years
                        else None
                        for month in monthly_periods
                    ],
                }
            )
            quarterly_series.append(
                {
                    "key": category_key,
                    "label": category_label,
                    "values": [
                        quarterly_category_counters[category_key][quarter]
                        for quarter in quarterly_periods
                    ],
                    "average_values": [
                        historical_quarterly_category_counters[category_key][quarter]
                        / len(historical_years)
                        if historical_years
                        else None
                        for quarter in quarterly_periods
                    ],
                }
            )
        metric_chart_data_by_mode[metric] = {
            "annual": {
                "labels": [str(year) for year in annual_periods],
                "values": [annual_counts[year] for year in annual_periods],
                "average": annual_average,
                "average_period_label": average_period_label,
                "x_axis_label": FREQUENCY_MODES["annual"]["axis_label"],
                "y_axis_label": "Frequency",
                "title": FREQUENCY_MODES["annual"]["title"],
                "series": annual_series,
            },
            "monthly": {
                "labels": [calendar.month_abbr[month] for month in monthly_periods],
                "values": [monthly_counts[month] for month in monthly_periods],
                "total_values": [monthly_counts[month] for month in monthly_periods],
                "average_values": [
                    historical_monthly_counts_by_metric[metric][month] / len(historical_years)
                    if historical_years
                    else None
                    for month in monthly_periods
                ],
                "average_period_label": average_period_label,
                "x_axis_label": FREQUENCY_MODES["monthly"]["axis_label"],
                "y_axis_label": "Frequency",
                "title": FREQUENCY_MODES["monthly"]["title"],
                "series": monthly_series,
            },
            "quarterly": {
                "labels": [f"Q{quarter}" for quarter in quarterly_periods],
                "values": [quarterly_counts[quarter] for quarter in quarterly_periods],
                "total_values": [quarterly_counts[quarter] for quarter in quarterly_periods],
                "average_values": [
                    historical_quarterly_counts_by_metric[metric][quarter] / len(historical_years)
                    if historical_years
                    else None
                    for quarter in quarterly_periods
                ],
                "average_period_label": average_period_label,
                "x_axis_label": FREQUENCY_MODES["quarterly"]["axis_label"],
                "y_axis_label": "Frequency",
                "title": FREQUENCY_MODES["quarterly"]["title"],
                "series": quarterly_series,
            },
        }

    chart_data_by_mode = metric_chart_data_by_mode["all"]
    chart_data = chart_data_by_mode[mode_key]
    return render(
        request,
        "reports/tropical_cyclone_frequency.html",
        {
            "frequency_mode": mode_key,
            "frequency_modes": FREQUENCY_MODES,
            "frequency_period_label": mode["label"],
            "frequency_title": mode["title"],
            "frequency_chart_data": chart_data,
            "frequency_charts": chart_data_by_mode,
            "frequency_metric_charts": metric_chart_data_by_mode,
            "damage_heatmap": {
                "months": damage_heatmap_months,
                "rows": selected_damage_heatmap["rows"],
                "max_value": selected_damage_heatmap["max_value"],
                "period_key": heatmap_period_key,
                "period_label": selected_damage_heatmap["period_label"],
                "period_options": heatmap_period_options,
                "periods": damage_heatmap_periods,
                "legend_levels": selected_damage_heatmap["legend_levels"],
            },
            "cyclone_count": len(cyclones),
            "unknown_month_count": unknown_month_count_by_metric["all"],
        },
    )
