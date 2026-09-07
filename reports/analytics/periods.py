from __future__ import annotations

import calendar
from datetime import date
from typing import Any

from django.db.models import Max, Min
from django.utils import timezone

from reports.incident_attribution import damage_report_analysis_date_expression

DATE_MODES = {
    "latest_year": "Latest Year",
    "all_data": "All Data",
    "year_range": "Year Range",
    "month_range": "Month Range",
    "date_range": "Date Range",
}

# The general Analytics yearly averages are intended to describe complete,
# comparable historical years.  The retained 1998 report is El Niño-only and
# belongs in the dedicated El Niño analysis.  The current calendar year is
# incomplete until it ends, so resolve it at request time instead of freezing
# a year number in the process.
ANNUAL_ANALYSIS_FIXED_EXCLUDED_YEARS = frozenset({1998})


def annual_analysis_excluded_years(current_year: int | None = None) -> frozenset[int]:
    """Return years omitted from complete-year averages for this request."""
    resolved_year = (
        timezone.now().year if current_year is None else int(current_year)
    )
    return frozenset((*ANNUAL_ANALYSIS_FIXED_EXCLUDED_YEARS, resolved_year))


# Backwards-compatible snapshot for callers that still import the old name.
# Analytics request paths use ``annual_analysis_excluded_years`` so a long-lived
# process automatically rolls over when the calendar year changes.
ANNUAL_ANALYSIS_EXCLUDED_YEARS = annual_analysis_excluded_years()

MONTH_LABELS = {
    1: "Jan",
    2: "Feb",
    3: "Mar",
    4: "Apr",
    5: "May",
    6: "Jun",
    7: "Jul",
    8: "Aug",
    9: "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
}

LEGACY_PERIOD_KEYS = {
    "period_mode",
    "start_year",
    "end_year",
    "start_month",
    "end_month",
    "date_mode",
    "year",
    "years",
    "year_all",
    "month",
    "months",
    "month_all",
    "date_from",
    "date_to",
}


def int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def int_list(values: list[Any]) -> list[int]:
    selected = []
    for value in values:
        parsed = int_or_none(value)
        if parsed is not None and parsed not in selected:
            selected.append(parsed)
    return selected


def first_non_empty(values: list[Any]) -> str:
    for value in values:
        if value:
            return str(value)
    return ""


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def period_value(request: Any, key: str) -> str:
    return first_non_empty(request.GET.getlist(key))


def parse_month_value(value: str | None) -> date | None:
    if not value:
        return None
    try:
        parsed = date.fromisoformat(f"{value}-01")
    except (TypeError, ValueError):
        return None

    return parsed if len(value) == 7 and value == parsed.strftime("%Y-%m") else None


def period_bounds(active_reports: Any, current_year: int) -> tuple[date, date, date]:
    dates = active_reports.aggregate(
        earliest=Min(damage_report_analysis_date_expression()),
        latest=Max(damage_report_analysis_date_expression()),
    )
    earliest = dates["earliest"] or date(current_year, 1, 1)
    latest = dates["latest"] or date(current_year, 12, 31)
    return earliest, latest, latest


def period_label(mode: str, start: date, end: date) -> str:
    if mode == "latest_year":
        return f"Latest Year · {start.year}"
    if mode == "all_data":
        return f"All Data · {start.year}–{end.year}"
    if mode == "year_range":
        return str(start.year) if start.year == end.year else f"{start.year}–{end.year}"
    if mode == "month_range":
        covers_full_years = start.month == 1 and end.month == 12
        if covers_full_years:
            return str(start.year) if start.year == end.year else f"{start.year}–{end.year}"
        return f"{start.strftime('%b %Y')}–{end.strftime('%b %Y')}"
    if start == end:
        return start.strftime("%-d %b %Y")
    return f"{start.strftime('%-d %b %Y')}–{end.strftime('%-d %b %Y')}"


def period_error_fallback(
    earliest: date,
    latest_start: date,
    current_year: int,
    message: str,
    values: dict[str, Any],
) -> dict[str, Any]:
    start = date(latest_start.year, 1, 1)
    end = date(latest_start.year, 12, 31)
    values.update(
        {
            "period_mode": "latest_year",
            "effective_date_from": start,
            "effective_date_to": end,
            "period_label": period_label("latest_year", start, end),
            "period_error": message,
        }
    )
    return values


def normalize_period(
    request: Any,
    active_reports: Any,
    current_year: int | None = None,
    default_latest_year: int | None = None,
) -> dict[str, Any]:
    """Normalize new and legacy period query parameters to one inclusive range.

    ``default_latest_year`` only changes the implicit ``latest_year`` choice;
    explicit period selections and the all-data end date remain data-driven.
    """
    current_year = (
        timezone.now().year if current_year is None else int(current_year)
    )
    earliest, latest_start, latest = period_bounds(active_reports, current_year)
    if default_latest_year is not None:
        latest_start = date(int(default_latest_year), 1, 1)
    raw_mode = period_value(request, "period_mode")
    legacy_mode = period_value(request, "date_mode")
    values = {
        "start_year_value": period_value(request, "start_year"),
        "end_year_value": period_value(request, "end_year"),
        "start_month_value": period_value(request, "start_month"),
        "end_month_value": period_value(request, "end_month"),
        "date_from_value": period_value(request, "date_from"),
        "date_to_value": period_value(request, "date_to"),
        "period_error": "",
    }

    if raw_mode:
        mode = raw_mode
    elif legacy_mode == "single":
        mode = "date_range"
        values["date_to_value"] = values["date_from_value"]
    elif legacy_mode == "range":
        mode = "date_range"
    elif legacy_mode == "month":
        legacy_years = int_list(request.GET.getlist("years") or request.GET.getlist("year"))
        legacy_months = int_list(request.GET.getlist("months") or request.GET.getlist("month"))
        if request.GET.get("year_all") == "1" and request.GET.get("month_all") == "1":
            mode = "all_data"
        elif legacy_years and legacy_months:
            start_year, end_year = min(legacy_years), max(legacy_years)
            start_month, end_month = min(legacy_months), max(legacy_months)
            values["start_month_value"] = f"{start_year:04d}-{start_month:02d}"
            values["end_month_value"] = f"{end_year:04d}-{end_month:02d}"
            mode = "month_range"
        elif legacy_years:
            values["start_year_value"] = str(min(legacy_years))
            values["end_year_value"] = str(max(legacy_years))
            mode = "year_range"
        else:
            mode = "all_data"
    elif legacy_mode == "year" or request.GET.get("year") or request.GET.getlist("years"):
        legacy_years = int_list(request.GET.getlist("years") or request.GET.getlist("year"))
        if request.GET.get("year_all") == "1":
            mode = "all_data"
        else:
            values["start_year_value"] = str(min(legacy_years)) if legacy_years else str(latest_start.year)
            values["end_year_value"] = str(max(legacy_years)) if legacy_years else str(latest_start.year)
            mode = "year_range"
    else:
        mode = "latest_year"

    if mode not in DATE_MODES:
        return period_error_fallback(
            earliest,
            latest_start,
            current_year,
            "Select a valid incident period.",
            values,
        )

    if mode == "latest_year":
        start = date(latest_start.year, 1, 1)
        end = date(latest_start.year, 12, 31)
    elif mode == "all_data":
        start, end = earliest, latest
    elif mode == "year_range":
        start_year = int_or_none(values["start_year_value"])
        end_year = int_or_none(values["end_year_value"])
        if (
            start_year is None
            or end_year is None
            or not 1 <= start_year <= 9999
            or not 1 <= end_year <= 9999
        ):
            return period_error_fallback(
                earliest,
                latest_start,
                current_year,
                "Start year and end year are required.",
                values,
            )
        start, end = date(start_year, 1, 1), date(end_year, 12, 31)
    elif mode == "month_range":
        start_month = parse_month_value(values["start_month_value"])
        end_month = parse_month_value(values["end_month_value"])
        if start_month is None or end_month is None:
            return period_error_fallback(
                earliest,
                latest_start,
                current_year,
                "Start month and end month are required in YYYY-MM format.",
                values,
            )
        start = start_month
        end = date(end_month.year, end_month.month, calendar.monthrange(end_month.year, end_month.month)[1])
    else:
        start = parse_date(values["date_from_value"])
        end = parse_date(values["date_to_value"])
        if start is None or end is None:
            return period_error_fallback(
                earliest,
                latest_start,
                current_year,
                "Start date and end date are required in YYYY-MM-DD format.",
                values,
            )

    if start > end:
        return period_error_fallback(
            earliest,
            latest_start,
            current_year,
            "The incident period start must not be after the end.",
            values,
        )

    values.update(
        {
            "period_mode": mode,
            "effective_date_from": start,
            "effective_date_to": end,
            "period_label": period_label(mode, start, end),
        }
    )
    if mode == "year_range":
        values["start_year_value"] = str(start.year)
        values["end_year_value"] = str(end.year)
    elif mode == "month_range":
        values["start_month_value"] = start.strftime("%Y-%m")
        values["end_month_value"] = end.strftime("%Y-%m")
    elif mode == "date_range":
        values["date_from_value"] = start.strftime("%Y-%m-%d")
        values["date_to_value"] = end.strftime("%Y-%m-%d")

    return values


def selected_period_options(filters: dict[str, Any], available_years: list[int]) -> dict[str, Any]:
    start = filters["effective_date_from"]
    end = filters["effective_date_to"]

    if filters["period_mode"] == "latest_year":
        years = [start.year]
        months = list(range(1, 13))
    elif filters["period_mode"] == "all_data":
        years = available_years
        months = list(range(1, 13))
    else:
        years = list(range(start.year, end.year + 1))
        if filters["period_mode"] == "month_range":
            months = sorted(calendar_month_occurrences(start, end))
        else:
            months = list(range(1, 13))

    available_year_set = set(available_years)
    selected_available_years = [year for year in years if year in available_year_set]
    year_label = (
        "All Years"
        if filters["period_mode"] == "all_data"
        else str(years[0])
        if len(years) == 1
        else f"{min(years)}-{max(years)}"
    )
    month_label = (
        "All Months"
        if len(months) == 12
        else MONTH_LABELS[months[0]]
        if len(months) == 1
        else f"{MONTH_LABELS[min(months)]}-{MONTH_LABELS[max(months)]}"
    )

    return {
        "selected_years": selected_available_years or years,
        "selected_months": months,
        "selected_year_label": year_label,
        "selected_month_label": month_label,
    }


def discrete_period_selection(
    request: Any,
    period: dict[str, Any],
    available_years: list[int],
) -> dict[str, Any]:
    """Preserve exact checkbox year/month selections across analytics views.

    The filter forms use repeated ``years`` and ``months`` parameters.  The
    normalized period remains an inclusive range for charts that need a
    continuous axis, while these optional exact filters keep Dashboard and
    Analytics totals identical when a user selects a sparse set of years or
    months.
    """
    raw_year_values = request.GET.getlist("years") or request.GET.getlist("year")
    raw_month_values = request.GET.getlist("months") or request.GET.getlist("month")
    if not raw_year_values and not raw_month_values:
        return {}

    def bounded_ints(values: list[Any], minimum: int, maximum: int) -> list[int]:
        selected: list[int] = []
        for raw_value in values:
            parsed = int_or_none(raw_value)
            if parsed is None or parsed < minimum or parsed > maximum:
                continue
            if parsed not in selected:
                selected.append(parsed)
        return sorted(selected)

    def is_contiguous(values: list[int]) -> bool:
        return len(values) < 2 or all(
            current == previous + 1
            for previous, current in zip(values, values[1:])
        )

    def selection_label(
        values: list[int],
        *,
        formatter,
        all_values=None,
        all_label="",
    ) -> str:
        values = sorted(set(values))
        if not values:
            return ""
        normalized_all = sorted(set(all_values)) if all_values is not None else []
        if all_label and normalized_all and values == normalized_all:
            return all_label
        if len(values) == 1:
            return formatter(values[0])
        if is_contiguous(values):
            return f"{formatter(values[0])}–{formatter(values[-1])}"
        return ", ".join(formatter(value) for value in values)

    requested_years = bounded_ints(raw_year_values, 1, 9999)
    requested_months = bounded_ints(raw_month_values, 1, 12)
    available_year_set = set(available_years)
    selected_years = [
        year
        for year in requested_years
        if not available_year_set or year in available_year_set
    ]
    if not selected_years:
        selected_years = list(period.get("selected_years") or [])
    selected_months = requested_months or list(period.get("selected_months") or [])

    year_label = selection_label(
        selected_years,
        formatter=str,
        all_values=available_years,
        all_label="All Years",
    )
    month_label = selection_label(
        selected_months,
        formatter=lambda month: MONTH_LABELS[month],
        all_values=range(1, 13),
        all_label="All Months",
    )
    period_display_label = (
        year_label
        if month_label == "All Months"
        else f"{year_label} · {month_label}" if year_label else month_label
    )

    result = {
        "selected_years": selected_years,
        "selected_months": selected_months,
        "selected_year_label": year_label,
        "selected_month_label": month_label,
        "period_label": period_display_label,
    }
    if requested_years:
        result["exact_period_years"] = selected_years
    if requested_months:
        result["exact_period_months"] = selected_months
    return result


def calendar_month_occurrences(start: date, end: date) -> dict[int, int]:
    occurrences = {}
    current = date(start.year, start.month, 1)
    final = date(end.year, end.month, 1)
    while current <= final:
        occurrences[current.month] = occurrences.get(current.month, 0) + 1
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return occurrences


# Backwards compatibility aliases
_int_or_none = int_or_none
_int_list = int_list
_first_non_empty = first_non_empty
_parse_date = parse_date
_period_value = period_value
_parse_month_value = parse_month_value
_period_bounds = period_bounds
_period_label = period_label
_period_error_fallback = period_error_fallback
_normalize_period = normalize_period
_selected_period_options = selected_period_options
