from __future__ import annotations

from decimal import Decimal
from typing import Any

from reports.analytics.formatting import (
    format_compact_value,
    format_exact_value,
    format_percent_delta,
    zero,
)
from reports.dashboard.aggregation import annual_reference


def previous_period_references(
    rows,
    windows,
    selected_stats,
    excluded_years,
    starts,
    *,
    multi_year,
    comparison_window=5,
):
    """Compare with the prior year and a configurable prior-year window."""
    previous_year = min(windows) - 1 if windows else None
    def reference(length):
        expected_years = (
            range(previous_year - length + 1, previous_year + 1)
            if previous_year is not None
            else ()
        )
        history = [
            row
            for row in rows
            if previous_year is not None
            and previous_year - length < row["analysis_date"].year <= previous_year
        ]
        return annual_reference(history, excluded_years, starts, expected_years)
    return previous_year, reference(1), reference(comparison_window)


def comparison_delta(value, reference, minimum_years=1):
    if value is None or reference["average"] in (None, 0) or reference["year_count"] < minimum_years:
        return {"label": "N/A", "direction": "flat"}
    return format_percent_delta(value, reference["average"])


def build_kpi_card(
    key: str,
    label: str,
    value: Any,
    prefix: str = "",
    suffix: str = "",
    description: str = "",
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "value": value,
        "display_value": format_compact_value(value, prefix=prefix, suffix=suffix) if value is not None else "Not available",
        "exact_value": format_exact_value(value, prefix=prefix, suffix=suffix) if value is not None else "Not available",
        "description": description,
    }


def kpi_context(
    value: Any,
    metric_key: str,
    annual_summary_rows: list[dict[str, Any]],
    selected_start_year: int | None,
    average_start_year: int | None = None,
) -> dict[str, Any]:
    metric_to_row_key = {
        "affected_farmers": "affected_farmers",
        "area_affected": "area_affected",
        "volume_loss": "volume_loss",
        "value_loss": "value_loss",
    }
    row_key = metric_to_row_key[metric_key]
    yearly_values = [
        zero(row[row_key])
        for row in annual_summary_rows
        if (
            average_start_year is None
            or row.get("year") is None
            or row["year"] >= average_start_year
        )
    ]
    annual_average = sum(yearly_values) / len(yearly_values) if yearly_values else Decimal("0")

    previous_rows = [
        row
        for row in annual_summary_rows
        if selected_start_year and row["year"] and row["year"] < selected_start_year
    ]
    previous_row = previous_rows[0] if previous_rows else None

    context = {
        "annual_average_delta": format_percent_delta(value, annual_average),
        "annual_average_value": annual_average,
        "previous_year_delta": {"label": "", "direction": "flat"},
        "previous_year": None,
    }

    if previous_row:
        context["previous_year"] = previous_row["year"]
        context["previous_year_delta"] = format_percent_delta(value, previous_row[row_key])

    return context


# Backwards compatibility aliases
_build_kpi_card = build_kpi_card
_kpi_context = kpi_context
