from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Any

from reports.analytics.formatting import (
    short_region_label,
)
from reports.analytics.options import (
    commodity_group_from_row,
    hazard_display_label,
)
from reports.analytics.periods import annual_analysis_excluded_years
from reports.dashboard.aggregation import (
    CHART_METRICS,
    annual_reference,
    matched_comparison,
    metric_start_years,
    nullable_sum,
    report_observations,
    summarize_observations,
    year_label,
)
from reports.incident_attribution import (
    incident_analysis_date,
)

ANNUAL_SUMMARY_PAGE_SIZE = 15


def average(rows: list[dict[str, Any]], key: str):
    values = [row.get(key) for row in rows if row.get(key) is not None]
    return nullable_sum(values) / len(values) if values else None


def build_annual_summary(scope_reports, excluded_years=None):
    rows = scope_reports if isinstance(scope_reports, list) else report_observations(scope_reports)
    excluded = annual_analysis_excluded_years() if excluded_years is None else excluded_years
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["analysis_date"].year].append(row)
    summary = []
    for year, observations in sorted(grouped.items(), reverse=True):
        stats = summarize_observations(observations)
        incident_farmers = defaultdict(list)
        for row in observations:
            incident_farmers[row.get("incident_key_id", row["analysis_date"])].append(row["affected_farmers"])
        missing_incident_count = sum(
            nullable_sum(values) in (None, 0) for values in incident_farmers.values()
        )
        summary.append({
            "year": year,
            "record_count": sum(row["record_count"] for row in observations),
            **{metric: stat["total"] for metric, stat in stats.items()},
            "flagged": missing_incident_count > 0,
            "missing_farmer_incident_count": missing_incident_count,
            "average_excluded": year in excluded,
            "coverage": [{"key": metric, "label": {"affected_farmers": "Farmers", "area_affected": "Area", "volume_loss": "Volume", "value_loss": "Value"}[metric], **stat} for metric, stat in stats.items()],
        })
    trends = {
        chart_metric: [{"label": str(row["year"]), "metric_value": row[metric], "average_value": None}
                       for row in reversed(summary)]
        for chart_metric, metric in CHART_METRICS.items()
    }
    return summary, trends


def _dimension_key(row, dimension):
    if dimension == "region":
        name = row["location_psgc_key__region_name"]
        return name or "", short_region_label(name) if name else "Unspecified Region"
    if dimension == "province":
        name = row["location_psgc_key__province_huc_name"]
        return name or "", name or "Unspecified Province"
    if dimension == "commodity_group":
        name = commodity_group_from_row(row)
        return name, name
    if dimension == "commodity_subgroup":
        name = row["commodity_key__level_3_group"]
        return name or "", name or "Unspecified subgroup"
    key = row["incident_key__hazard_key_id"]
    return key, hazard_display_label(key, row["incident_key__hazard_key__hazard_type"], row["incident_key__hazard_key__hazard_category"])


def build_dimension_chart(selected_rows, historical_rows, dimension, *, windows, filters,
                          excluded_years, multi_year, comparison_enabled):
    selected_groups = defaultdict(list)
    historical_groups = defaultdict(list)
    for row in selected_rows:
        selected_groups[_dimension_key(row, dimension)].append(row)
    for row in historical_rows:
        historical_groups[_dimension_key(row, dimension)].append(row)
    chart = []
    for key, label in sorted(selected_groups.keys() | historical_groups.keys()):
        selected = selected_groups[(key, label)]
        historical = historical_groups[(key, label)]
        group_filters = dict(filters)
        if dimension.startswith("commodity") and key:
            group_filters[dimension] = key
        starts = metric_start_years(group_filters)
        if dimension == "commodity_subgroup" and key:
            # Parent totals cannot be assigned to one detailed subgroup.
            lumped_years = {row["analysis_date"].year for row in historical_rows
                            if not row["commodity_key__level_3_group"]}
            historical = [row for row in historical if row["analysis_date"].year not in lumped_years]
        stats = summarize_observations(selected, excluded_years, starts)
        is_composition = dimension in {"commodity_group", "commodity_subgroup", "hazard"}
        baseline = annual_reference(historical, excluded_years, starts)
        item = {"label": label, "full_label": key or label, "filter_key": dimension, "filter_value": key}
        for chart_metric, metric in CHART_METRICS.items():
            stat, reference = stats[metric], baseline[metric]
            # Composition charts show actual selected-period totals. Regional
            # bars share the KPI's total / reported-year-average convention.
            value = stat["total"] if is_composition or not multi_year else stat["average"]
            item[chart_metric] = value
            item[f"{chart_metric}_years"] = year_label(stat["years"])
            item[f"{chart_metric}_year_count"] = stat["year_count"]
            reference_value = reference["average"]
            item[f"comparison_{chart_metric}"] = reference_value if comparison_enabled else None
            item[f"comparison_{chart_metric}_years"] = reference["label"]
            item[f"comparison_{chart_metric}_year_count"] = reference["year_count"]
        chart.append(item)
    return chart


def composition_series(rows):
    result = {}
    for chart_metric in CHART_METRICS:
        metric_rows = [{
            "label": row["label"], "metric_value": row[chart_metric],
            "filter_key": row["filter_key"], "filter_value": row["filter_value"],
            "comparison_metric_value": row[f"comparison_{chart_metric}"],
            "comparison_years": row[f"comparison_{chart_metric}_years"],
            "comparison_year_count": row[f"comparison_{chart_metric}_year_count"],
        } for row in rows]
        metric_rows.sort(key=lambda row: row["metric_value"] if row["metric_value"] is not None else Decimal("-1"), reverse=True)
        selected_total = nullable_sum(row["metric_value"] for row in metric_rows)
        comparison_total = nullable_sum(row["comparison_metric_value"] for row in metric_rows)
        # Share deltas require the same observed years for every component.
        year_sets = {row["comparison_years"] for row in metric_rows}
        comparable = len(year_sets) == 1 and all(row["comparison_year_count"] >= 2 for row in metric_rows)
        for row in metric_rows:
            row["selected_share"] = row["metric_value"] / selected_total * 100 if row["metric_value"] is not None and selected_total else None
            row["comparison_share"] = row["comparison_metric_value"] / comparison_total * 100 if row["comparison_metric_value"] is not None and comparison_total and comparable else None
            row["share_delta"] = row["selected_share"] - row["comparison_share"] if row["selected_share"] is not None and row["comparison_share"] is not None else None
        result[chart_metric] = metric_rows
    return result


def build_chart_breakdowns(selected_rows, historical_rows, **context):
    return {
        "region_bar": build_dimension_chart(selected_rows, historical_rows, "region", **context),
        "province_bar": build_dimension_chart(selected_rows, historical_rows, "province", **context),
        "commodity_pie": composition_series(build_dimension_chart(selected_rows, historical_rows, "commodity_group", **context)),
        "subgroup_pie": composition_series(build_dimension_chart(selected_rows, historical_rows, "commodity_subgroup", **context)),
        "hazard_pie": composition_series(build_dimension_chart(selected_rows, historical_rows, "hazard", **context)),
    }


def _legacy_dimension_chart(filtered_reports, dimension, num_years=1):
    """Keep the pre-composition helper shape for callers outside Analytics."""
    rows = report_observations(filtered_reports)
    grouped = defaultdict(list)
    labels_by_key = {}
    for row in rows:
        key, label = _dimension_key(row, dimension)
        grouped[key].append(row)
        labels_by_key[key] = label
    result = []
    divisor = Decimal(str(num_years or 1))
    for key, items in grouped.items():
        values = {
            chart_metric: nullable_sum(item[metric] for item in items) / divisor
            if nullable_sum(item[metric] for item in items) is not None else None
            for chart_metric, metric in CHART_METRICS.items()
        }
        result.append({
            "label": labels_by_key[key],
            "full_label": key or labels_by_key[key],
            "value": values["value"],
            "volume": values["volume"],
            "area": values["area"],
            "filter_key": dimension,
            "filter_value": key,
        })
    return result


def build_region_chart(filtered_reports, num_years=1):
    return _legacy_dimension_chart(filtered_reports, "region", num_years)


def build_province_chart(filtered_reports, num_years=1):
    return _legacy_dimension_chart(filtered_reports, "province", num_years)


def _legacy_composition_chart(filtered_reports, dimension, num_years=1, max_items=None):
    rows = _legacy_dimension_chart(filtered_reports, dimension, num_years)
    result = {}
    for chart_metric in ("value", "volume", "area"):
        chart_rows = [
            {
                "label": row["label"],
                "metric_value": row[chart_metric],
                "filter_key": row["filter_key"],
                "filter_value": row["filter_value"],
            }
            for row in rows
            if dimension != "commodity_subgroup" or row["filter_value"]
        ]
        chart_rows.sort(key=lambda row: row["metric_value"] if row["metric_value"] is not None else Decimal("-1"), reverse=True)
        if max_items is not None and len(chart_rows) > max_items:
            remainder = nullable_sum(row["metric_value"] for row in chart_rows[max_items:])
            chart_rows = chart_rows[:max_items]
            if remainder is not None and remainder != 0:
                chart_rows.append({
                    "label": "Others" if dimension != "hazard" else "Other hazards",
                    "metric_value": remainder,
                    "filter_key": "",
                    "filter_value": "",
                })
        result[chart_metric] = chart_rows
    return result


def build_commodity_pie(filtered_reports, num_years=1, max_items=5):
    return _legacy_composition_chart(filtered_reports, "commodity_group", num_years, max_items)


def build_subgroup_pie(filtered_reports, num_years=1, max_items=7):
    return _legacy_composition_chart(filtered_reports, "commodity_subgroup", num_years, max_items)


def build_hazard_pie(filtered_reports, num_years=1, max_items=5):
    return _legacy_composition_chart(filtered_reports, "hazard", num_years, max_items)


def add_months(month_start: date, count: int) -> date:
    m = month_start.month - 1 + count
    y = month_start.year + m // 12
    m = m % 12 + 1
    return date(y, m, 1)


def analysis_month_slots(
    start_date: date | None,
    end_date: date | None,
    hazard_key: str | None = None,
) -> list[tuple[int, int]]:
    analysis_date = incident_analysis_date(
        start_date,
        end_date,
        hazard_key,
    )

    if not analysis_date:
        return []
    if start_date and analysis_date < start_date:
        analysis_date = start_date

    return [(analysis_date.year, analysis_date.month)]


def month_occurrence_counts(
    period_start: date,
    period_end: date,
    excluded_years: frozenset[int] = frozenset(),
) -> dict[int, int]:
    """Count how often each calendar month occurs in an inclusive period."""
    counts = {month: 0 for month in range(1, 13)}
    current = date(period_start.year, period_start.month, 1)
    final = date(period_end.year, period_end.month, 1)

    while current <= final:
        if current.year not in excluded_years:
            counts[current.month] += 1
        current = add_months(current, 1)

    return counts


def month_period_label(period_start: date, period_end: date) -> str:
    """Format an inclusive month period for chart series labels."""
    if period_start.year == period_end.year:
        if period_start.month == 1 and period_end.month == 12:
            return str(period_start.year)
        if period_start.month == period_end.month:
            return period_start.strftime("%b %Y")
        return (
            f"{period_start.strftime('%b')}–"
            f"{period_end.strftime('%b %Y')}"
        )
    if period_start.month == 1 and period_end.month == 12:
        return f"{period_start.year}–{period_end.year}"
    return (
        f"{period_start.strftime('%b %Y')}–"
        f"{period_end.strftime('%b %Y')}"
    )


def percentile(values: list[Decimal], percentile_value: Decimal) -> Decimal:
    """Return a linearly interpolated percentile for a small yearly series."""
    if not values:
        return Decimal("0")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]

    position = Decimal(len(ordered) - 1) * percentile_value
    lower_index = int(position)
    upper_index = min(lower_index + 1, len(ordered) - 1)
    fraction = position - Decimal(lower_index)
    return ordered[lower_index] + (
        ordered[upper_index] - ordered[lower_index]
    ) * fraction


def allocate_monthly_metric(
    rows: list[dict[str, Any]],
    metric_field: str,
    period_start: date | None = None,
    period_end: date | None = None,
) -> dict[tuple[int, int], Decimal]:
    monthly_totals: dict[tuple[int, int], Decimal] = {}
    first_month = (
        date(period_start.year, period_start.month, 1)
        if period_start
        else None
    )
    final_month = (
        date(period_end.year, period_end.month, 1)
        if period_end
        else None
    )

    for row in rows:
        slots = analysis_month_slots(
            row["incident_key__incident_start_date"],
            row["incident_key__incident_end_date"],
            row.get("incident_key__hazard_key_id"),
        )

        if not slots:
            continue

        attributed_value = Decimal(str(row[metric_field] or 0))

        for year, month in slots:
            attributed_month = date(year, month, 1)
            if first_month and attributed_month < first_month:
                continue
            if final_month and attributed_month > final_month:
                continue

            monthly_totals[(year, month)] = (
                monthly_totals.get((year, month), Decimal("0"))
                + attributed_value
            )

    return monthly_totals


def build_monthly_line(selected_rows, historical_rows, *, windows, filters,
                       excluded_years, multi_year, comparison_enabled):
    starts = metric_start_years(filters)
    result = {"meta": {
        "selected_period_label": filters["period_label"],
        "historical_period_label": year_label(row["analysis_date"].year for row in historical_rows),
        "has_historical_comparison": comparison_enabled and bool(historical_rows),
        "is_multi_year": multi_year,
    }, **{metric: [] for metric in CHART_METRICS}}
    for month in range(1, 13):
        month_windows = {year: [(left, right) for left, right in intervals if left.month == month]
                         for year, intervals in windows.items()}
        month_windows = {year: intervals for year, intervals in month_windows.items() if intervals}
        current = [row for row in selected_rows if row["analysis_date"].month == month]
        stats = summarize_observations(current, excluded_years if multi_year else (), starts if multi_year else {})
        baseline = matched_comparison(historical_rows, month_windows, stats, excluded_years, starts, multi_year=multi_year)
        for chart_metric, metric in CHART_METRICS.items():
            stat, reference = stats[metric], baseline[metric]
            result[chart_metric].append({
                "label": calendar.month_abbr[month],
                "metric_value": stat["average"] if multi_year else stat["total"],
                "selected_occurrences": stat["year_count"],
                "historical_average_value": reference["average"] if comparison_enabled else None,
                "historical_occurrences": reference["year_count"] if comparison_enabled else 0,
                "historical_q1_value": percentile(reference["samples"], Decimal("0.25")) if comparison_enabled and reference["year_count"] >= 2 else None,
                "historical_q3_value": percentile(reference["samples"], Decimal("0.75")) if comparison_enabled and reference["year_count"] >= 2 else None,
                "filter_key": "months", "filter_value": str(month),
            })
    return result


# Backwards compatibility aliases
_average = average
_build_annual_summary = build_annual_summary
_add_months = add_months
_analysis_month_slots = analysis_month_slots
_month_occurrence_counts = month_occurrence_counts
_month_period_label = month_period_label
_allocate_monthly_metric = allocate_monthly_metric
_build_monthly_line = build_monthly_line
