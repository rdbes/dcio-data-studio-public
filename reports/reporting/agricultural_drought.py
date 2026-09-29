"""Tabular Agricultural Drought report composition."""

from __future__ import annotations

import calendar
import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from itertools import groupby

from django.utils import timezone

from agri_drought.models import (
    AgriculturalDroughtProduct,
    PagasaRainfallContext,
)
from reports.agricultural_drought.analytics import drought_tooltip_breakdowns
from reports.agricultural_drought.styles import (
    REPORT_PERCENT_NORMAL_LEGEND,
    REPORT_STATUS_MISSING_TEXT,
    REPORT_STATUS_NORMAL_TEXT,
    REPORT_STATUS_YELLOW_TEXT,
    REPORT_SVTR_LEGEND,
    SVTR_LEGEND,
    percent_normal_category,
    report_status_fill_color,
)
from reports.location_ordering import canonical_region_order_key, region_sort_key

# Printable reports reserve the remaining page height for the header and
# two-source legend footer. Keep these capacities as the single page-size
# contract used by preview, PDF, and Excel report composition.
REPORT_LOCATION_ROWS_PER_PAGE = 9
REPORT_MUNICIPAL_ROWS_PER_PAGE = 18


def _month_start(value):
    """Normalize a date/datetime to the first day of its local month."""

    if not value:
        return None
    if isinstance(value, datetime):
        if timezone.is_aware(value):
            value = timezone.localtime(value)
        value = value.date()
    if not isinstance(value, date):
        return None
    return value.replace(day=1)


def _next_month(value):
    month = _month_start(value)
    if not month:
        return None
    index = month.year * 12 + month.month
    return date(index // 12, index % 12 + 1, 1)


def _previous_month(value):
    month = _month_start(value)
    if not month:
        return None
    index = month.year * 12 + month.month - 2
    return date(index // 12, index % 12 + 1, 1)


def _field_month(value):
    match = re.fullmatch(r"m(\d{4})(\d{2})", str(value or ""), re.IGNORECASE)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), 1)
    except ValueError:
        return None


def _month_column_label(month):
    """Return a visible month header from metadata or its mYYYYMM field."""

    if not isinstance(month, dict):
        return ""
    parsed = _field_month(month.get("field"))
    if not parsed:
        try:
            key = str(month.get("key") or "")
            parsed = date.fromisoformat(
                f"{key}-01" if len(key) == 7 else key
            )
        except ValueError:
            parsed = None
    if parsed:
        return calendar.month_abbr[parsed.month].upper()
    label = str(month.get("label") or "").strip()
    if label:
        return label.upper()
    return calendar.month_abbr[parsed.month].upper() if parsed else ""


def _month_key(month):
    if not isinstance(month, dict):
        return ""
    parsed = _field_month(month.get("field"))
    if parsed:
        return parsed.strftime("%Y-%m")
    return str(month.get("key") or "").strip()


def _aligned_report_months(forecast_months, rainfall_months):
    """Build one chronological header for the two offset month series."""

    sources = {}
    for month in (*forecast_months, *rainfall_months):
        key = _month_key(month)
        if key and key not in sources:
            sources[key] = month
    return [
        {
            "key": key,
            "label": _month_column_label(sources[key]),
            "year": _field_month(sources[key].get("field")).year
            if _field_month(sources[key].get("field"))
            else int(key[:4])
            if re.fullmatch(r"\d{4}-\d{2}", key)
            else "",
        }
        for key in sorted(sources)
    ]


def _month_range_label(months):
    """Format a compact inclusive month range for the report header."""

    parsed = []
    for month in months or []:
        key = _month_key(month)
        if re.fullmatch(r"\d{4}-\d{2}", key):
            try:
                parsed.append(date.fromisoformat(f"{key}-01"))
            except ValueError:
                continue
    if not parsed:
        return ""
    first, last = min(parsed), max(parsed)
    if first.year == last.year:
        return f"{calendar.month_abbr[first.month]}–{calendar.month_abbr[last.month]} {first.year}"
    return (
        f"{calendar.month_abbr[first.month]} {first.year}–"
        f"{calendar.month_abbr[last.month]} {last.year}"
    )


def _short_month_range_label(months):
    """Format a compact month-only span for tabular status headers."""

    parsed = []
    for month in months or []:
        key = _month_key(month)
        if re.fullmatch(r"\d{4}-\d{2}", key):
            try:
                parsed.append(date.fromisoformat(f"{key}-01"))
            except ValueError:
                continue
    if not parsed:
        return ""
    first, last = min(parsed), max(parsed)
    if first == last:
        return calendar.month_abbr[first.month].upper()
    if first.year == last.year:
        return f"{calendar.month_abbr[first.month].upper()}-{calendar.month_abbr[last.month].upper()}"
    return (
        f"{calendar.month_abbr[first.month].upper()} {first.year}-"
        f"{calendar.month_abbr[last.month].upper()} {last.year}"
    )


def _format_rainfall_mean(value):
    """Keep sub-unit rainfall values readable instead of rounding to zero."""

    if value is None:
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return str(value)
    if abs(number) < 1:
        return f"{number.quantize(Decimal('0.00'), rounding=ROUND_HALF_UP):.2f}"
    return f"{number.quantize(Decimal('1'), rounding=ROUND_HALF_UP):.0f}"


def _assessment_reference_month(release, forecast_months):
    """Return the month represented by the BSWM assessment product."""

    first_forecast = min(
        (_field_month(item.get("field") if isinstance(item, dict) else item) for item in forecast_months),
        default=None,
    )
    assessment_month = _previous_month(first_forecast)
    if not assessment_month:
        assessment_month = _month_start(getattr(release, "reference_date", None))
    if not assessment_month:
        assessment_month = _month_start(getattr(release, "issue_date", None))
    return calendar.month_abbr[assessment_month.month].upper() if assessment_month else ""


def _release_first_forecast_month(release):
    """Read the first represented SVTR month without loading map payloads."""

    if not release or not getattr(release, "pk", None):
        return None
    prefetched_products = getattr(
        release,
        "_drought_reporting_products",
        None,
    )
    if prefetched_products is not None:
        product = next(
            (
                item
                for item in prefetched_products
                if item.product == AgriculturalDroughtProduct.Product.SVTR
            ),
            None,
        )
    else:
        product = (
            AgriculturalDroughtProduct.objects.filter(
                release=release,
                product=AgriculturalDroughtProduct.Product.SVTR,
            )
            .only("metadata")
            .first()
        )
    months = (product.metadata or {}).get("months", []) if product else []
    values = [
        _field_month(item.get("field") if isinstance(item, dict) else item)
        for item in months
    ]
    return min((month for month in values if month), default=None)


def reporting_month_for_release(release):
    """Return the BSWM package's product reporting month.

    ``issue_date`` describes the assessment period (for example, June), while
    the first SVTR month is the month in which that report is issued (for
    example, July). The publication timestamp and one-month offset are legacy
    fallbacks for records without forecast metadata.
    """

    forecast_month = _release_first_forecast_month(release)
    published_month = _month_start(getattr(release, "published_at", None))
    return (
        forecast_month
        or published_month
        or _next_month(getattr(release, "issue_date", None))
    )


def reporting_month_for_pagasa_context(context):
    """Return the month before the first represented PAGASA forecast month."""

    release_month = _month_start(getattr(context, "release_month", None))
    updated_month = _month_start(getattr(context, "updated_at", None))
    return _previous_month(release_month) or updated_month


def _normalized(value):
    return " ".join(str(value or "").split()).casefold()


_NCR_LOCATION_ALIASES = frozenset(
    {
        "ncr",
        "metro manila",
        "national capital region",
        "national capital region (ncr)",
        "ncr (national capital region)",
    }
)


def _pagasa_province_key(value):
    """Match PAGASA's NCR province aliases to the canonical HUC label."""

    normalized = _normalized(value)
    return "ncr" if normalized in _NCR_LOCATION_ALIASES else normalized


def _short_region(value):
    """Keep report group labels compact while preserving region identity."""

    text = " ".join(str(value or "").split()).strip()
    aliases = {
        "Cordillera Administrative Region (CAR)": "CAR",
        "MIMAROPA Region": "MIMAROPA",
        "Negros Island Region (NIR)": "NIR",
        "National Capital Region": "NCR",
        "National Capital Region (NCR)": "NCR",
        "NCR (National Capital Region)": "NCR",
        "Bangsamoro Autonomous Region in Muslim Mindanao": "BARMM",
        "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)": "BARMM",
    }
    alias_by_key = {key.casefold(): value for key, value in aliases.items()}
    if text.casefold() in alias_by_key:
        return alias_by_key[text.casefold()]
    match = re.match(r"^(Region\s+[IVXL]+(?:-[AB])?)\b", text, re.IGNORECASE)
    return match.group(1) if match else text


def _dominant_status(row, legend):
    """Return the status using the affected-area classification rule.

    The first legend entry is the normal state.  A row is affected only when
    the combined non-normal share is greater than 50%; once affected, the
    largest non-normal category supplies the displayed status.
    """

    if row.get("status"):
        return {
            "label": row["status"],
            "color": _status_text_color(row["status"], row.get("status_color") or ""),
        }

    percentages = row.get("percentages") or []
    total = sum(float(value or 0) for value in percentages)
    if not percentages or not total:
        return {"label": "No data", "color": REPORT_STATUS_MISSING_TEXT}

    non_normal = list(range(1, len(percentages)))
    if "is_affected" in row:
        is_affected = bool(row.get("is_affected"))
    else:
        affected_percentage = sum(
            float(percentages[index] or 0) for index in non_normal
        )
        is_affected = affected_percentage > 50
    if not is_affected or not non_normal:
        index = 0
    else:
        index = max(
            non_normal,
            key=lambda item: float(percentages[item] or 0),
        )
    item = legend[index] if index < len(legend) else {}
    swatch = item.get("color") or ""
    return {
        "label": item.get("label") or "No data",
        "color": _status_text_color(item.get("label"), swatch),
    }


def _status_text_color(label, swatch):
    """Use established export-cell semantic colors for status text.

    Mild and Developing use the below-normal yellow, while Normal uses the
    green used by the None outlook state.
    """

    if str(label or "").strip().casefold() in {"developing", "mild"}:
        return REPORT_STATUS_YELLOW_TEXT
    if str(label or "").strip().casefold() == "normal":
        return REPORT_STATUS_NORMAL_TEXT
    if str(label or "").strip().casefold() == "no data":
        return REPORT_STATUS_MISSING_TEXT
    return str(swatch or "")


def _readable_swatch_color(value):
    """Darken a legend color only as much as needed for white-background text."""

    text = str(value or "").strip()
    match = re.fullmatch(r"#([0-9a-f]{6})", text, re.IGNORECASE)
    if not match:
        return text
    rgb = [int(match.group(1)[index : index + 2], 16) for index in (0, 2, 4)]

    def luminance(channels):
        linear = []
        for channel in channels:
            value = channel / 255
            linear.append(
                value / 12.92
                if value <= 0.04045
                else ((value + 0.055) / 1.055) ** 2.4
            )
        return (
            0.2126 * linear[0]
            + 0.7152 * linear[1]
            + 0.0722 * linear[2]
        )

    for _ in range(16):
        if 1.05 / (luminance(rgb) + 0.05) >= 4.5:
            break
        rgb = [round(channel * 0.85) for channel in rgb]
    return "#" + "".join(f"{channel:02x}" for channel in rgb)


def _readable_text_on_swatch(value):
    """Choose the higher-contrast text color for a filled swatch cell."""

    text = str(value or "").strip()
    match = re.fullmatch(r"#([0-9a-f]{6})", text, re.IGNORECASE)
    if not match:
        return "#1f2937"
    rgb = [int(match.group(1)[index : index + 2], 16) for index in (0, 2, 4)]
    if rgb[0] >= 180 and rgb[1] <= 120 and rgb[2] <= 130:
        return "#ffffff"
    linear = []
    for channel in rgb:
        value = channel / 255
        linear.append(
            value / 12.92
            if value <= 0.04045
            else ((value + 0.055) / 1.055) ** 2.4
        )
    luminance = (
        0.2126 * linear[0]
        + 0.7152 * linear[1]
        + 0.0722 * linear[2]
    )
    dark_contrast = (luminance + 0.05) / 0.05
    light_contrast = 1.05 / (luminance + 0.05)
    return "#1f2937" if dark_contrast >= light_contrast else "#ffffff"


def _legend_color(legend, key):
    return next(
        (item.get("color") or "" for item in legend if item.get("key") == key),
        "",
    )


def _forecast_label(category):
    if not category:
        return "No data"
    return next(
        (item["label"] for item in SVTR_LEGEND if item["key"] == category),
        str(category).replace("_", " ").title(),
    )


def _scope_matches(row, mode, name, parent, region):
    if not name:
        return True
    if _normalized(row.get("name")) != _normalized(name):
        return False
    if mode != "region" and parent and _normalized(row.get("parent")) != _normalized(parent):
        return False
    return not region or _normalized(row.get("region")) == _normalized(region)


def _scope_row_candidates(*sources, key):
    """Return the product rows representing one shared boundary key."""

    return tuple(
        row
        for source in sources
        if isinstance(source, dict)
        for row in (source.get(key),)
        if isinstance(row, dict)
    )


def _boundary_row_key(row):
    """Keep same-named boundaries distinct when they have different parents."""

    return (
        _normalized(row.get("region")),
        _normalized(row.get("parent")),
        _normalized(row.get("name")),
    )


def _pagasa_months(context):
    payload = context.rainfall_map_payload or {}
    raw_months = payload.get("months") or (context.rainfall_metadata or {}).get("months") or []
    release_month = context.release_month.replace(day=1)
    month_numbers = {name.upper(): number for number, name in enumerate(calendar.month_abbr) if name}
    year = release_month.year
    previous = None
    descriptors = []
    for raw in raw_months:
        field = str(raw or "").strip().upper()
        month_number = month_numbers.get(field)
        if month_number is None:
            continue
        if previous is not None and month_number <= previous:
            year += 1
        elif previous is None and month_number < release_month.month:
            year += 1
        previous = month_number
        descriptors.append({
            "field": field,
            "key": f"{year}-{month_number:02d}",
            "label": f"{calendar.month_abbr[month_number]} {year}",
        })
    return descriptors


def _condition_for_provinces(context, month_key, provinces):
    conditions = (context.drought_condition_payload or {}).get("conditions") or {}
    month_values = conditions.get(month_key) or {}
    province_keys = {
        _pagasa_province_key(province) for province in provinces if province
    }
    for condition in ("drought", "dry_spell", "dry_condition"):
        if any(
            _pagasa_province_key(province) in province_keys
            for province in month_values.get(condition) or []
        ):
            return condition.replace("_", " ").title()
    return "No data"


def _pagasa_values(context, mode, row, months):
    rainfall = (context.rainfall_map_payload or {}).get("rows") or []
    percent = (context.percent_normal_map_payload or {}).get("rows") or []
    if mode == "region":
        region_key = canonical_region_order_key(row.get("region"))
        province_names = [
            item.get("province")
            for item in rainfall
            if canonical_region_order_key(item.get("region")) == region_key
        ]
        rainfall_rows = [
            item for item in rainfall
            if canonical_region_order_key(item.get("region")) == region_key
        ]
        percent_rows = [
            item for item in percent
            if canonical_region_order_key(item.get("region")) == region_key
        ]
    else:
        province = row.get("parent") if mode == "municipality" else row.get("name")
        province_names = [province]
        province_key = _pagasa_province_key(province)
        rainfall_rows = [
            item
            for item in rainfall
            if _pagasa_province_key(item.get("province")) == province_key
        ]
        percent_rows = [
            item
            for item in percent
            if _pagasa_province_key(item.get("province")) == province_key
        ]
    values = []
    for month in months:
        rainfall_values = [item.get("values", {}).get(month["field"]) or {} for item in rainfall_rows]
        percent_values = [item.get("values", {}).get(month["field"]) for item in percent_rows]
        def finite(key):
            return [
                float(value[key])
                for value in rainfall_values
                if value.get(key) not in (None, "")
            ]
        means = finite("mean")
        normals = [float(value) for value in percent_values if value not in (None, "")]
        percent_normal = sum(normals) / len(normals) if normals else None
        percent_color = _legend_color(
            REPORT_PERCENT_NORMAL_LEGEND,
            percent_normal_category(percent_normal),
        )
        values.append({
            "label": month["label"],
            "minimum": min(finite("min"), default=None),
            "mean": sum(means) / len(means) if means else None,
            "mean_display": _format_rainfall_mean(sum(means) / len(means) if means else None),
            "maximum": max(finite("max"), default=None),
            "percent_normal": percent_normal,
            "percent_normal_color": percent_color,
            "percent_normal_text_color": _readable_text_on_swatch(percent_color),
            "condition": _condition_for_provinces(context, month["key"], province_names),
        })
    return values


def _chunk_report_groups(
    groups,
    max_rows=18,
    include_group_headers=True,
    one_group_per_page=False,
):
    """Split sorted groups into printable pages without changing their order."""

    pages = []
    if one_group_per_page:
        for group in groups:
            rows = group.get("rows") or []
            if not rows:
                continue
            for start in range(0, len(rows), max_rows):
                pages.append(
                    [
                        {
                            "label": group.get("label", ""),
                            "rows": rows[start : start + max_rows],
                        }
                    ]
                )
        return pages

    page = []
    used_rows = 0
    page_capacity = max_rows + (1 if include_group_headers else 0)
    for group in groups:
        rows = group.get("rows") or []
        if not rows:
            continue
        for start in range(0, len(rows), max_rows):
            chunk = rows[start : start + max_rows]
            group_chunk = {"label": group.get("label", ""), "rows": chunk}
            required_rows = len(chunk) + (1 if include_group_headers else 0)
            if page and used_rows + required_rows > page_capacity:
                pages.append(page)
                page = []
                used_rows = 0
            page.append(group_chunk)
            used_rows += required_rows
    if page:
        pages.append(page)
    return pages or [[]]


def _province_report_page_groups(groups, max_rows=REPORT_LOCATION_ROWS_PER_PAGE):
    """Pack province report groups while preserving region page boundaries."""

    pages = []
    group_index = 0
    shareable_region_labels = {"NCR", "BARMM"}
    while group_index < len(groups):
        group = groups[group_index]
        if group["label"] in shareable_region_labels:
            shareable_groups = []
            while (
                group_index < len(groups)
                and groups[group_index]["label"] in shareable_region_labels
            ):
                shareable_groups.append(groups[group_index])
                group_index += 1
            pages.extend(
                _chunk_report_groups(
                    shareable_groups,
                    max_rows=max_rows,
                    include_group_headers=True,
                )
            )
            continue
        pages.extend(
            _chunk_report_groups(
                [group],
                max_rows=max_rows,
                include_group_headers=True,
                one_group_per_page=True,
            )
        )
        group_index += 1
    return pages or [[]]


def _municipality_report_page_groups(
    groups,
    max_rows=REPORT_MUNICIPAL_ROWS_PER_PAGE,
):
    """Keep one province summary with each page of municipality rows."""

    pages = []
    for group in groups:
        rows = list(group.get("rows") or [])
        summary = next(
            (row for row in rows if row.get("is_province_summary")),
            None,
        )
        municipality_rows = [
            row for row in rows if not row.get("is_province_summary")
        ]
        if not municipality_rows:
            if summary:
                pages.append(
                    [{"label": group.get("label", ""), "rows": [summary]}]
                )
            continue
        for start in range(0, len(municipality_rows), max_rows):
            page_rows = municipality_rows[start : start + max_rows]
            if summary:
                page_rows = [summary] + page_rows
            pages.append(
                [{"label": group.get("label", ""), "rows": page_rows}]
            )
    return pages or [[]]


def _report_legend_groups():
    """Return the two source legends used by the printable report footer."""

    return [
        {
            "title": "DA-BSWM Monthly Agricultural Drought Forecast",
            "items": list(REPORT_SVTR_LEGEND),
            "shape": "rectangle",
        },
        {
            "title": "DOST-PAGASA Rainfall Monthly Rainfall Forecast and Percent Normal",
            "items": list(REPORT_PERCENT_NORMAL_LEGEND),
            "shape": "pill",
            "unit_label": "Mean rainfall (mm)",
        },
    ]


def build_agricultural_drought_report(
    *,
    release,
    boundary_mode,
    boundary_name="",
    boundary_parent="",
    boundary_region="",
    selected_region="",
    selected_province="",
    affected_only=False,
    affected_query="",
    selected_product="outlook",
):
    products = {
        product.product: product
        for product in AgriculturalDroughtProduct.objects.filter(release=release)
    }
    tooltip = drought_tooltip_breakdowns(
        release=release,
        products=products,
        selected_region=selected_region,
        selected_province=selected_province,
    )
    level = boundary_mode if boundary_mode in {"region", "province", "municipality"} else "province"
    assessment = {
        _boundary_row_key(row): row
        for row in tooltip.get("assessment", {}).get(level, [])
    }
    outlook = {
        _boundary_row_key(row): row
        for row in tooltip.get("outlook", {}).get(level, [])
    }
    forecast = {
        _boundary_row_key(row): row
        for row in tooltip.get("forecast", {}).get(level, [])
    }
    keys = set(assessment) | set(outlook) | set(forecast)
    source_rows = {
        **{key: row for key, row in assessment.items()},
        **{key: row for key, row in outlook.items()},
    }
    scope_sources = (assessment, outlook, forecast)

    def make_report_row(
        source,
        assessment_row,
        outlook_row,
        forecast_row,
        *,
        fallback_name="",
        fallback_parent="",
        fallback_region="",
        show_pagasa=False,
        is_province_summary=False,
    ):
        assessment_status = _dominant_status(
            assessment_row,
            tooltip.get("legends", {}).get("assessment", []),
        )
        outlook_status = _dominant_status(
            outlook_row,
            tooltip.get("legends", {}).get("outlook", []),
        )
        return {
            "name": source.get("name") or fallback_name,
            "parent": source.get("parent") or fallback_parent,
            "region": source.get("region") or fallback_region,
            "assessment": assessment_status["label"],
            "assessment_color": assessment_status["color"],
            "assessment_highlight_color": report_status_fill_color(
                assessment_status["label"], assessment_status["color"]
            ),
            "outlook": outlook_status["label"],
            "outlook_color": outlook_status["color"],
            "outlook_highlight_color": report_status_fill_color(
                outlook_status["label"], outlook_status["color"]
            ),
            "forecast": [
                _forecast_label(category)
                for category in forecast_row.get("categories", [])
            ],
            "forecast_colors": [
                _legend_color(REPORT_SVTR_LEGEND, category)
                for category in forecast_row.get("categories", [])
            ],
            "is_affected": bool(
                (assessment_row if selected_product == "cdi" else outlook_row).get(
                    "is_affected"
                )
            ),
            "show_pagasa": show_pagasa,
            "is_province_summary": is_province_summary,
        }

    def key_matches_scope(key):
        # An explicitly selected accordion row remains visible even when the
        # affected-only/search filters would otherwise exclude it. With no
        # selected row, this must be false; otherwise `_scope_matches` treats
        # the empty boundary name as a match for every row.
        if not boundary_name:
            return False
        return any(
            _scope_matches(
                row,
                level,
                boundary_name,
                boundary_parent,
                boundary_region,
            )
            for row in _scope_row_candidates(*scope_sources, key=key)
        )

    query = _normalized(affected_query)
    source = assessment if selected_product == "cdi" else outlook
    if affected_only or query:
        visible_keys = set()
        for key in keys:
            if key_matches_scope(key):
                visible_keys.add(key)
                continue
            source_row = source.get(key, {})
            if affected_only and (
                not source_row.get("is_affected")
                or source_row.get("has_data") is False
            ):
                continue
            if query and not any(
                query in _normalized(row.get(field))
                for row in _scope_row_candidates(*scope_sources, key=key)
                for field in ("name", "parent", "region")
            ):
                continue
            visible_keys.add(key)
        keys = visible_keys
    rows = []
    for key in keys:
        candidates = _scope_row_candidates(*scope_sources, key=key)
        source = next(
            (
                row
                for row in candidates
                if _scope_matches(
                    row,
                    level,
                    boundary_name,
                    boundary_parent,
                    boundary_region,
                )
            ),
            source_rows.get(key) or forecast.get(key) or {},
        )
        if boundary_name and not _scope_matches(
            source,
            level,
            boundary_name,
            boundary_parent,
            boundary_region,
        ):
            continue
        rows.append(
            make_report_row(
                source,
                assessment.get(key, {}),
                outlook.get(key, {}),
                forecast.get(key, {}),
                fallback_name=boundary_name,
                fallback_parent=boundary_parent,
                fallback_region=boundary_region,
                show_pagasa=level != "municipality",
            )
        )
    rows.sort(key=lambda row: (
        region_sort_key(row.get("region")),
        row.get("parent", "").casefold(),
        row.get("name", "").casefold(),
    ))

    render_rows = rows
    if level == "municipality":
        province_assessment = {
            _boundary_row_key(row): row
            for row in tooltip.get("assessment", {}).get("province", [])
        }
        province_outlook = {
            _boundary_row_key(row): row
            for row in tooltip.get("outlook", {}).get("province", [])
        }
        province_forecast = {
            _boundary_row_key(row): row
            for row in tooltip.get("forecast", {}).get("province", [])
        }

        def find_province_row(source_map, region_key, province_key):
            return next(
                (
                    item
                    for item in source_map.values()
                    if canonical_region_order_key(item.get("region"))
                    == region_key
                    and _pagasa_province_key(item.get("name")) == province_key
                ),
                {},
            )

        province_summaries = {}
        for municipality_row in rows:
            region_key = canonical_region_order_key(municipality_row.get("region"))
            province_key = _pagasa_province_key(municipality_row.get("parent"))
            summary_key = (region_key, province_key)
            if summary_key in province_summaries:
                continue
            assessment_row = find_province_row(
                province_assessment, region_key, province_key
            )
            outlook_row = find_province_row(
                province_outlook, region_key, province_key
            )
            forecast_row = find_province_row(
                province_forecast, region_key, province_key
            )
            source = next(
                (
                    item
                    for item in (assessment_row, outlook_row, forecast_row)
                    if item
                ),
                {
                    "name": municipality_row.get("parent"),
                    "region": municipality_row.get("region"),
                },
            )
            summary = make_report_row(
                source,
                assessment_row,
                outlook_row,
                forecast_row,
                fallback_name=municipality_row.get("parent"),
                fallback_region=municipality_row.get("region"),
                show_pagasa=True,
                is_province_summary=True,
            )
            # Municipality rows display their parent province; the summary
            # row is the province itself and must not repeat that label.
            summary["parent"] = ""
            province_summaries[summary_key] = summary

        render_rows = []
        for municipality_row in rows:
            summary_key = (
                canonical_region_order_key(municipality_row.get("region")),
                _pagasa_province_key(municipality_row.get("parent")),
            )
            if summary_key in province_summaries:
                render_rows.append(province_summaries.pop(summary_key))
            render_rows.append(municipality_row)

    context = PagasaRainfallContext.objects.first()
    reporting_months = [reporting_month_for_release(release)]
    if context:
        pagasa_reporting_month = reporting_month_for_pagasa_context(context)
        if pagasa_reporting_month:
            reporting_months.append(pagasa_reporting_month)
    reporting_month = max(
        (month for month in reporting_months if month),
        default=None,
    )
    forecast_months = tooltip.get("forecast", {}).get("meta", {}).get("months", [])
    months = _pagasa_months(context) if context else []
    report_months = _aligned_report_months(forecast_months, months)
    forecast_month_index = {
        _month_key(month): index
        for index, month in enumerate(forecast_months)
        if _month_key(month)
    }
    rainfall_month_index = {
        month.get("key"): index
        for index, month in enumerate(months)
        if month.get("key")
    }
    for row in render_rows:
        show_pagasa = bool(context and months and row.get("show_pagasa"))
        row["show_pagasa"] = show_pagasa
        row["rainfall"] = (
            _pagasa_values(
                context,
                "province" if row.get("is_province_summary") else level,
                row,
                months,
            )
            if show_pagasa
            else []
        )
        if level == "region":
            row["name"] = _short_region(row.get("name"))
        row["monthly_report"] = [
            {
                "forecast": (
                    row["forecast"][forecast_month_index[month["key"]]]
                    if month["key"] in forecast_month_index
                    and forecast_month_index[month["key"]] < len(row["forecast"])
                    else "—"
                ),
                "forecast_color": (
                    row["forecast_colors"][forecast_month_index[month["key"]]]
                    if month["key"] in forecast_month_index
                    and forecast_month_index[month["key"]] < len(row["forecast_colors"])
                    else ""
                ),
                "forecast_text_color": _readable_text_on_swatch(
                    row["forecast_colors"][forecast_month_index[month["key"]]]
                    if month["key"] in forecast_month_index
                    and forecast_month_index[month["key"]] < len(row["forecast_colors"])
                    else ""
                ),
                "rainfall": (
                    row["rainfall"][rainfall_month_index[month["key"]]]
                    if month["key"] in rainfall_month_index
                    and rainfall_month_index[month["key"]] < len(row["rainfall"])
                    else None
                ),
            }
            for month in report_months
        ]
    groups = []

    def report_group_key(item):
        region = item.get("region") or "Unassigned region"
        if level != "municipality":
            return region
        province = (
            item.get("name")
            if item.get("is_province_summary")
            else item.get("parent")
        ) or "Unassigned province"
        return region, province

    for group_key, group_rows in groupby(render_rows, key=report_group_key):
        if level == "municipality":
            _region, province = group_key
            label = province
        else:
            label = _short_region(group_key)
        groups.append({"label": label, "rows": list(group_rows)})

    if level == "province":
        # Keep each region isolated from the next one while allowing all
        # ordinary province rows that fit on the landscape page.
        page_groups = _province_report_page_groups(
            groups,
            max_rows=REPORT_LOCATION_ROWS_PER_PAGE,
        )
    elif level == "municipality":
        # Keep one orange province summary block with each page, then fit the
        # fixed municipality-row capacity below it.
        page_groups = _municipality_report_page_groups(
            groups,
            max_rows=REPORT_MUNICIPAL_ROWS_PER_PAGE,
        )
    else:
        page_groups = _chunk_report_groups(
            groups,
            max_rows=REPORT_LOCATION_ROWS_PER_PAGE,
            include_group_headers=False,
        )
    report_pages = [
        {"kind": "combined", "groups": page_group}
        for page_group in page_groups
    ]
    for page in report_pages:
        page["location_row_count"] = sum(
            len(group.get("rows") or [])
            for group in page.get("groups") or []
        )
        if level == "region":
            page["report_layout"] = "region"
        elif level == "province":
            page["report_layout"] = "province"
        elif level == "municipality":
            page["report_layout"] = "municipality"
            page["municipality_row_count"] = sum(
                1
                for group in page.get("groups") or []
                for row in group.get("rows") or []
                if not row.get("is_province_summary")
            )
    report_row_index = 0
    for page in report_pages:
        for group in page["groups"]:
            for row in group.get("rows", []):
                row["report_row_index"] = report_row_index
                report_row_index += 1
    return {
        "release": release,
        "reporting_month": reporting_month,
        "scope_label": boundary_name or selected_province or selected_region or "Selected boundary",
        "boundary_mode": level,
        "product_label": "Drought Outlook" if selected_product == "outlook" else "Drought Assessment",
        "forecast_months": forecast_months,
        "months": months,
        "has_rainfall": bool(months),
        "forecast_period_label": _month_range_label(forecast_months),
        "assessment_period_label": _assessment_reference_month(release, forecast_months),
        "outlook_period_label": _short_month_range_label(forecast_months),
        "rainfall_period_label": _month_range_label(months),
        "report_months": report_months,
        "report_colspan": 3 + len(report_months),
        "report_pages": report_pages,
        "report_legends": _report_legend_groups(),
        "groups": groups,
        "row_count": len(render_rows),
        "affected_only": affected_only,
        "data_available": bool(render_rows),
    }
