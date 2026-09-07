from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from reports.analytics.formatting import format_percent_delta, zero
from reports.analytics.periods import annual_analysis_excluded_years
from reports.dashboard.aggregation import nullable_sum, year_label

COMPARISON_WINDOW_OPTIONS = (
    ("none", "None"),
    ("5", "5 Years"),
    ("10", "10 Years"),
    ("15", "15 Years"),
    ("20", "20 Years"),
    ("all", "All"),
)
COMPARISON_WINDOW_KEYS = {value for value, _label in COMPARISON_WINDOW_OPTIONS}
DEFAULT_COMPARISON_WINDOW = "5"
# KPI cards use a stable recent-year baseline instead of the full historical
# range used by the dashboard-wide comparison views.
KPI_COMPARISON_WINDOW = "10"
FARMERS_AVERAGE_START_YEAR = 2021


def metric_average_year_count(
    metric_key: str,
    years,
    excluded_years: frozenset[int] | None = None,
) -> int:
    """Return the eligible calendar-year divisor for one metric average."""

    excluded = (
        annual_analysis_excluded_years()
        if excluded_years is None
        else frozenset(excluded_years)
    )
    normalized_years = {
        int(year)
        for year in years
        if year is not None
    }
    if metric_key == "affected_farmers":
        normalized_years = {
            year
            for year in normalized_years
            if year >= FARMERS_AVERAGE_START_YEAR
        }
    return len(normalized_years - excluded)


def comparison_period(
    raw_window: str | None,
    available_years: list[int],
    selected_end_year: int,
    excluded_years: frozenset[int] | None = None,
) -> dict[str, Any]:
    excluded_years = (
        annual_analysis_excluded_years()
        if excluded_years is None
        else frozenset(excluded_years)
    )
    eligible_years = [
        year for year in available_years
        if year not in excluded_years and year <= selected_end_year
    ]
    window = (
        raw_window
        if raw_window in COMPARISON_WINDOW_KEYS
        else DEFAULT_COMPARISON_WINDOW
    )
    if window == "none" or not eligible_years:
        return {
            "window": window,
            "enabled": False,
            "label": "None",
            "date_from": None,
            "date_to": None,
            "year_count": 0,
            "years": [],
        }

    first_available_year = min(eligible_years)
    last_available_year = max(eligible_years)
    if window == "all":
        start_year = first_available_year
        end_year = last_available_year
    else:
        end_year = selected_end_year
        start_year = max(first_available_year, end_year - int(window) + 1)

    label = (
        str(start_year)
        if start_year == end_year
        else f"{start_year}–{end_year}"
    )
    years = sorted({year for year in eligible_years if start_year <= year <= end_year})
    return {
        "window": window,
        "enabled": True,
        "label": label,
        "date_from": date(start_year, 1, 1),
        "date_to": date(end_year, 12, 31),
        "year_count": len(years),
        "years": years,
    }


def metric_averages(
    totals: dict[str, Any],
    year_count: int,
    metric_year_counts: dict[str, int] | None = None,
) -> dict[str, Decimal]:
    metric_year_counts = metric_year_counts or {}
    return {
        key: value / Decimal(metric_year_counts.get(key, year_count))
        if value is not None and metric_year_counts.get(key, year_count) else None
        for key, value in totals.items()
        if key != "record_count"
    }


def attach_kpi_comparison(
    context: dict[str, Any],
    selected_total: Any,
    selected_year_count: int,
    comparison_average: Any,
    comparison_label: str,
    enabled: bool,
) -> dict[str, Any]:
    selected_average = (
        selected_total / Decimal(selected_year_count)
        if selected_total is not None and selected_year_count else None
    )
    context.update(
        {
            "selected_annual_average_value": selected_average,
            "comparison_average_value": comparison_average,
            "comparison_delta": (
                format_percent_delta(selected_average, comparison_average)
                if enabled and selected_average is not None and comparison_average is not None
                else {"label": "", "direction": "flat"}
            ),
            "comparison_label": comparison_label if enabled else "",
        }
    )
    return context


def attach_chart_comparison(
    selected_rows: list[dict[str, Any]],
    comparison_rows: list[dict[str, Any]],
    metric_keys: tuple[str, ...] = ("value", "volume", "area"),
) -> list[dict[str, Any]]:
    comparison_by_label = {row["label"]: row for row in comparison_rows}
    for row in selected_rows:
        comparison_row = comparison_by_label.get(row["label"], {})
        for metric_key in metric_keys:
            selected_value = zero(row.get(metric_key))
            comparison_value = zero(comparison_row.get(metric_key))
            row[f"comparison_{metric_key}"] = comparison_value
            row[f"comparison_{metric_key}_delta"] = format_percent_delta(
                selected_value,
                comparison_value,
            )
    return selected_rows


def attach_pie_comparison(
    selected_data: dict[str, list[dict[str, Any]]],
    comparison_data: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    def decimal_value(value: Any) -> Decimal:
        return Decimal(str(value or 0))

    for metric, rows in selected_data.items():
        comparison_rows = comparison_data.get(metric, [])
        comparison_by_label = {row["label"]: row for row in comparison_rows}
        selected_total = sum(
            (decimal_value(row.get("metric_value")) for row in rows),
            Decimal("0"),
        )
        comparison_total = sum(
            (decimal_value(row.get("metric_value")) for row in comparison_rows),
            Decimal("0"),
        )
        named_comparison_total = Decimal("0")

        for row in rows:
            if row["label"] in {"Others", "Other hazards"}:
                continue
            comparison_value = decimal_value(
                comparison_by_label.get(row["label"], {}).get("metric_value")
            )
            row["comparison_metric_value"] = comparison_value
            named_comparison_total += comparison_value

        for row in rows:
            if row["label"] in {"Others", "Other hazards"}:
                row["comparison_metric_value"] = max(
                    Decimal("0"),
                    comparison_total - named_comparison_total,
                )

            selected_share = (
                decimal_value(row.get("metric_value"))
                / selected_total
                * Decimal("100")
                if selected_total
                else Decimal("0")
            )
            comparison_share = (
                decimal_value(row.get("comparison_metric_value"))
                / comparison_total
                * Decimal("100")
                if comparison_total
                else Decimal("0")
            )
            row["selected_share"] = selected_share
            row["comparison_share"] = comparison_share
            row["share_delta"] = selected_share - comparison_share

    return selected_data


def annual_metric_statistics(rows, metric, excluded_years, start_years):
    eligible = [row for row in rows if row["year"] not in excluded_years
                and row["year"] >= start_years.get(metric, 1)
                and row.get(metric) is not None]
    total = nullable_sum(row[metric] for row in eligible)
    return {"total": total, "average": total / len(eligible) if eligible else None,
            "year_count": len(eligible), "years_label": year_label(row["year"] for row in eligible)}


def rolling_window_metric_cards(annual_rows, available_years, selected_end_year,
                                excluded_years=None, start_years=None):
    excluded = annual_analysis_excluded_years() if excluded_years is None else excluded_years
    starts = start_years or {"affected_farmers": FARMERS_AVERAGE_START_YEAR}
    cards = []
    for window, title in (("5", "5 Years"), ("10", "10 Years"), ("15", "15 Years"), ("all", "All History")):
        period = comparison_period(window, available_years, selected_end_year, excluded)
        if not period["enabled"]:
            continue
        rows = [row for row in annual_rows if row["year"] in period["years"]]
        metrics = [{"key": metric, **annual_metric_statistics(rows, metric, excluded, starts)}
                   for metric in ("affected_farmers", "area_affected", "volume_loss", "value_loss")]
        cards.append({"window": window, "title": title, "label": period["label"],
                      "year_count": period["year_count"], "metrics": metrics})
    return cards


def five_year_periods(annual_rows, excluded_years=None, start_years=None):
    excluded = annual_analysis_excluded_years() if excluded_years is None else excluded_years
    starts = start_years or {}
    years = [row["year"] for row in annual_rows if row["year"] not in excluded]
    if not years:
        return []
    first_year, end_year = min(years), max(years)
    result = []
    while end_year >= first_year:
        start_year = max(first_year, end_year - 4)
        rows = [row for row in annual_rows if start_year <= row["year"] <= end_year and row["year"] not in excluded]
        if rows:
            period = {"label": str(start_year) if start_year == end_year else f"{start_year}–{end_year}",
                      "year_count": len(rows), "reports_per_year": sum(row["record_count"] for row in rows) / len(rows)}
            for short, metric in (("farmers", "affected_farmers"), ("area", "area_affected"), ("volume", "volume_loss"), ("value", "value_loss")):
                stat = annual_metric_statistics(rows, metric, excluded, starts)
                period.update({f"{short}_{key}": value for key, value in stat.items()})
            result.append(period)
        end_year = start_year - 1
    return result
