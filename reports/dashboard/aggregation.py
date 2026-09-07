"""Reported observations and period alignment shared by Analytics displays."""

import calendar
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Count, Sum

from reports.incident_attribution import damage_report_analysis_date_expression

METRIC_FIELDS = {
    "affected_farmers": "affected_farmers_fisherfolk_count",
    "area_affected": "area_affected_ha",
    "volume_loss": "production_loss_mt",
    "value_loss": "value_loss_php",
}
CHART_METRICS = {
    "farmers": "affected_farmers",
    "area": "area_affected",
    "volume": "volume_loss",
    "value": "value_loss",
}
DIMENSIONS = (
    "analysis_date",
    "incident_key_id",
    "location_psgc_key__region_name",
    "location_psgc_key__province_huc_name",
    "commodity_key_id",
    "commodity_key__main_sector",
    "commodity_key__level_2_group",
    "commodity_key__level_3_group",
    "incident_key__hazard_key_id",
    "incident_key__hazard_key__hazard_category",
    "incident_key__hazard_key__hazard_type",
)


def report_observations(queryset):
    """Fetch aggregates at date/dimension grain, retaining field availability."""
    aggregates = {"record_count": Count("pk")}
    for metric, field in METRIC_FIELDS.items():
        aggregates[metric] = Sum(field)
        aggregates[f"{metric}_reported"] = Count(field)
    return list(
        queryset.annotate(analysis_date=damage_report_analysis_date_expression())
        .exclude(analysis_date__isnull=True)
        .values(*DIMENSIONS)
        .annotate(**aggregates)
        .order_by()
    )


def period_windows(filters, today):
    """Exact selected month/date intervals, including an elapsed-year cutoff."""
    start = filters["effective_date_from"]
    end = min(filters["effective_date_to"], today)
    years = filters.get("exact_period_years") or range(start.year, end.year + 1)
    months = filters.get("exact_period_months") or range(1, 13)
    windows = {}
    for year in sorted(set(years)):
        intervals = []
        for month in sorted(set(months)):
            left = max(start, date(year, month, 1))
            right = min(end, date(year, month, calendar.monthrange(year, month)[1]))
            if left <= right:
                intervals.append((left, right))
        if intervals:
            windows[year] = intervals
    return windows


def annual_selection(filters):
    """Retain exact selected years while ignoring month/day restrictions."""
    years = sorted(set(filters.get("exact_period_years") or range(
        filters["effective_date_from"].year, filters["effective_date_to"].year + 1,
    )))
    return {**filters, "effective_date_from": date(min(years), 1, 1),
            "effective_date_to": date(max(years), 12, 31),
            "exact_period_years": years, "exact_period_months": list(range(1, 13)),
            "period_label": year_label(years)}


def annual_reference(rows, excluded_years, starts, expected_years=None):
    """Return full-year averages with an optional calendar-year denominator."""
    stats = summarize_observations(rows, excluded_years, starts)
    expected_years = set(expected_years or [])
    result = {}
    for metric, stat in stats.items():
        eligible_rows = [
            row
            for row in rows
            if row["analysis_date"].year not in excluded_years
            and row["analysis_date"].year >= starts.get(metric, 1)
            and row[metric] is not None
        ]
        observed_year_count = len({row["analysis_date"].year for row in eligible_rows})
        expected_year_count = len(
            [
                year for year in expected_years
                if year not in excluded_years
                and year >= starts.get(metric, 1)
            ]
        )
        denominator = expected_year_count or observed_year_count
        total = nullable_sum(row[metric] for row in eligible_rows)
        result[metric] = {
            "average": total / denominator if total is not None and denominator else None,
            "year_count": expected_year_count or stat["year_count"],
            "years": stat["years"],
            "label": year_label(stat["years"]),
        }
    return result


def in_windows(day, windows):
    return any(left <= day <= right for left, right in windows.get(day.year, []))


def select_observations(rows, windows):
    return [row for row in rows if in_windows(row["analysis_date"], windows)]


def metric_start_years(filters):
    # These are documented changes in category definitions, not a claim that
    # every report after the cutoff is complete.
    group = (filters.get("commodity_group") or "").casefold()
    subgroup = filters.get("commodity_subgroup")
    start = 1
    if group in {"high value crops", "cassava", "fiber crops", "coconut", "sugarcane", "tobacco"}:
        start = 2022
    if subgroup and group in {"amef", "fisheries"}:
        start = 2022
    if subgroup and group == "corn":
        start = 2023
    return {metric: max(start, 2021 if metric == "affected_farmers" else 1) for metric in METRIC_FIELDS}


def nullable_sum(values):
    present = [Decimal(value) for value in values if value is not None]
    return sum(present, Decimal("0")) if present else None


def summarize_observations(rows, excluded_years=(), start_years=None):
    """Average only observed metric years; absence is never a zero year."""
    start_years = start_years or {}
    records = sum(row["record_count"] for row in rows)
    result = {}
    for metric in METRIC_FIELDS:
        yearly = defaultdict(list)
        for row in rows:
            year = row["analysis_date"].year
            if year not in excluded_years and year >= start_years.get(metric, 1):
                if row[metric] is not None:
                    yearly[year].append(row[metric])
        total = nullable_sum(row[metric] for row in rows)
        average = (
            nullable_sum(value for values in yearly.values() for value in values) / len(yearly)
            if yearly else None
        )
        reported = sum(row.get(f"{metric}_reported", int(row[metric] is not None)) for row in rows)
        result[metric] = {
            "total": total,
            "average": average,
            "years": sorted(yearly),
            "year_count": len(yearly),
            "reported": reported,
            "records": records,
            "missing": records - reported,
        }
    return result


def year_label(years):
    years = sorted(set(years))
    if not years:
        return "No reported years"
    if len(years) == 1:
        return str(years[0])
    if years == list(range(years[0], years[-1] + 1)):
        return f"{years[0]}–{years[-1]}"
    return ", ".join(map(str, years))


def align_interval(interval, year):
    def aligned(day):
        return date(year, day.month, min(day.day, calendar.monthrange(year, day.month)[1]))
    return tuple(aligned(day) for day in interval)


def matched_comparison(rows, windows, selected_summary, excluded_years, start_years, *, multi_year,
                       require_each_month=True):
    """Match each selected year's elapsed dates to prior reported years.

    A missing month is unavailable, so a pattern spanning several months needs
    an observation for each of those months by default. Period-total KPIs can
    instead compare reported sums without asserting complete monthly coverage.
    """
    baseline_years = sorted({row["analysis_date"].year for row in rows} - set(excluded_years))
    rows_by_year = defaultdict(list)
    for row in rows:
        rows_by_year[row["analysis_date"].year].append(row)
    result = {}
    for metric in METRIC_FIELDS:
        selected_years = selected_summary[metric]["years"] if multi_year else sorted(windows)
        selected_years = [year for year in selected_years if year >= start_years.get(metric, 1)]
        samples_by_year = defaultdict(list)
        for selected_year in selected_years:
            pattern = windows.get(selected_year, [])
            samples = []
            sample_years = []
            for year in baseline_years:
                if year < start_years.get(metric, 1):
                    continue
                aligned = [align_interval(interval, year) for interval in pattern]
                # Full-year records can describe a year's reported total even
                # when no incident occurred in some months. Partial patterns
                # do not assume absent monthly observations were zero.
                full_year = len(aligned) == 12 and aligned[0][0] == date(year, 1, 1) and aligned[-1][1] == date(year, 12, 31)
                values = []
                observed_months = set()
                for row in rows_by_year[year]:
                    day = row["analysis_date"]
                    if day.year == year and row[metric] is not None and any(left <= day <= right for left, right in aligned):
                        values.append(row[metric])
                        observed_months.add(day.month)
                if values and (not require_each_month or full_year or observed_months == {left.month for left, _ in aligned}):
                    samples.append(nullable_sum(values))
                    sample_years.append(year)
            for year, value in zip(sample_years, samples):
                samples_by_year[year].append(value)
        complete = {year: nullable_sum(values) / len(values)
                    for year, values in samples_by_year.items()
                    if selected_years and len(values) == len(selected_years)}
        result[metric] = {
            "average": nullable_sum(complete.values()) / len(complete) if complete else None,
            "years": sorted(complete),
            "year_count": len(complete),
            "label": year_label(complete),
            "samples": list(complete.values()),
        }
    return result
