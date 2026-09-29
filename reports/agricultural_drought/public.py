"""Read-only Agricultural Drought context for the public renderer."""

from __future__ import annotations

import calendar
import json
import re
from datetime import date
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace

from django.conf import settings

from reports.agricultural_drought.styles import PAGASA_CONDITION_LEGEND, legend_for
from reports.location_ordering import region_sort_key, sort_region_names
from reports.services.public_data import load_public_json

PRODUCT_OPTIONS = (
    ("cdi", "Agricultural Drought Assessment"),
    ("outlook", "Agricultural Drought Outlook"),
    ("svtr", "Monthly Agricultural Drought Forecast"),
)
PRODUCT_MENU_OPTIONS = (
    ("cdi", "Assessment"),
    ("outlook", "Outlook"),
    ("svtr", "Monthly Forecast"),
)


def _parse_date(value):
    try:
        return date.fromisoformat(str(value)) if value else None
    except (TypeError, ValueError):
        return None


def _month_from_field(field):
    match = re.fullmatch(r"m(\d{4})(\d{2})", str(field), re.IGNORECASE)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), 1)
    except ValueError:
        return None


def _format_period(months):
    available = sorted({month for month in months if month})
    if not available:
        return ""
    first, last = available[0], available[-1]
    if first == last:
        return f"{calendar.month_name[first.month]} {first.year}"
    if first.year == last.year:
        return f"{calendar.month_name[first.month]}–{calendar.month_name[last.month]} {first.year}"
    return f"{calendar.month_name[first.month]} {first.year}–{calendar.month_name[last.month]} {last.year}"


def _previous_month(month):
    if not month:
        return None
    return date(month.year - (month.month == 1), 12 if month.month == 1 else month.month - 1, 1)


def _scope_options(source):
    scopes = source.get("administrative_scopes") if isinstance(source, dict) else None
    if isinstance(scopes, list):
        pairs = {
            (str(scope.get("region") or "").strip(), str(province or "").strip())
            for scope in scopes
            if isinstance(scope, dict)
            for province in (scope.get("provinces") or [""])
        }
    else:
        pairs = {
            (
                str(feature.get("properties", {}).get("region") or "").strip(),
                str(feature.get("properties", {}).get("province") or "").strip(),
            )
            for feature in (source.get("features") or [])
            if isinstance(feature, dict)
        }
    regions = sort_region_names({region for region, _province in pairs if region})
    provinces = [
        {"value": province, "label": province, "region": region}
        for region, province in sorted(
            pairs,
            key=lambda pair: (region_sort_key(pair[0]), pair[1].casefold()),
        )
        if region and province
    ]
    return regions, provinces


@lru_cache(maxsize=1)
def load_public_drought_snapshot():
    """Load the immutable drought release generated from the local database."""

    configured = getattr(settings, "PUBLIC_DROUGHT_DATA_FILE", "")
    path = Path(configured) if configured else Path(settings.BASE_DIR) / "data/drought/current.json"
    try:
        payload = load_public_json("modules/drought-current.json", path)
    except (OSError, TypeError, ValueError):
        return {"schema_version": "1.0.0", "releases": []}
    if not isinstance(payload, dict) or not isinstance(payload.get("releases"), list):
        return {"schema_version": "1.0.0", "releases": []}
    return payload


def _release_namespace(raw):
    return SimpleNamespace(
        pk=raw.get("id"),
        issue_date=_parse_date(raw.get("issue_date")),
        reference_date=_parse_date(raw.get("reference_date")),
        source_agency=str(raw.get("source_agency") or ""),
        methodology_version=str(raw.get("methodology_version") or ""),
        mask_version=str(raw.get("mask_version") or ""),
        reporting_month=_parse_date(raw.get("reporting_month")),
    )


def _requested_release(parameters, releases):
    requested = _parse_date(parameters.get("issue_date") or "")
    if requested:
        for release, raw in releases:
            if release.issue_date == requested or release.reporting_month == requested:
                return release, raw
    return releases[0] if releases else (None, {})


def build_public_agricultural_drought_context(parameters):
    """Compose the existing drought template from public snapshot data only."""

    snapshot = load_public_drought_snapshot()
    releases = [
        (_release_namespace(raw), raw)
        for raw in snapshot.get("releases", [])
        if isinstance(raw, dict) and _parse_date(raw.get("issue_date"))
    ]
    selected_release, selected_raw = _requested_release(parameters, releases)
    requested_product = parameters.get("product") or "outlook"
    valid_products = dict(PRODUCT_OPTIONS)
    selected_product = requested_product if requested_product in valid_products else "outlook"
    products = selected_raw.get("products") if isinstance(selected_raw, dict) else {}
    products = products if isinstance(products, dict) else {}
    selected_product_raw = products.get(selected_product) or {}
    selected_metadata = selected_product_raw.get("metadata") or {}
    svtr_metadata = (products.get("svtr") or {}).get("metadata") or {}
    forecast_months = [_month_from_field(item.get("field")) for item in svtr_metadata.get("months", []) if isinstance(item, dict)]
    forecast_period = _format_period(forecast_months)
    first_forecast_month = min((month for month in forecast_months if month), default=None)
    assessment_month = _previous_month(first_forecast_month) or (selected_release.reference_date if selected_release else None)
    product_periods = {"svtr": forecast_period, "outlook": forecast_period, "cdi": _format_period([assessment_month])}
    region_options, province_options = _scope_options(svtr_metadata)
    requested_region = parameters.get("region") or ""
    selected_region = requested_region if requested_region in region_options else ""
    valid_provinces = {item["value"] for item in province_options if item["region"] == selected_region}
    requested_province = parameters.get("province") or ""
    selected_province = requested_province if selected_region and requested_province in valid_provinces else ""
    selected_period_label = product_periods[selected_product]
    months = selected_metadata.get("months") or []
    requested_month = parameters.get("active_month") or ""
    month_fields = {item.get("field") for item in months if isinstance(item, dict)}
    active_month = requested_month if requested_month in month_fields else (months[0].get("field") if months else "")
    severity_options = [
        {"value": str(item.get("code", item["key"])), "label": item["label"]}
        for item in legend_for(selected_product)
    ]
    selected_severity = parameters.get("severity") or ""
    if selected_severity not in {item["value"] for item in severity_options}:
        selected_severity = ""

    mask_raw = snapshot.get("mask") or {}
    mask_metadata = mask_raw.get("metadata") or {}
    upper_left = mask_metadata.get("upper_left") or [0, 0]
    resolution = mask_metadata.get("resolution") or [0]
    mask_data = {
        "width": mask_metadata.get("width", 0),
        "height": mask_metadata.get("height", 0),
        "west": upper_left[0] if upper_left else 0,
        "north": upper_left[1] if len(upper_left) > 1 else 0,
        "resolution": resolution[0] if resolution else 0,
        "overlay_codes": mask_metadata.get("overlay_codes") or [0],
        "values": mask_raw.get("category_values") or [],
        "version": mask_raw.get("version") or "",
    }
    pagasa_overlay = snapshot.get("pagasa_overlay") or {}
    if pagasa_overlay:
        pagasa_overlay = {**pagasa_overlay, "condition_legend": list(PAGASA_CONDITION_LEGEND)}
    # Keep the initial HTML small.  The approved public snapshot is served as
    # a static JSON asset and the map script loads its selected release after
    # boot.  Inline only the lightweight mask/overlay data above.
    public_map_data_by_product = {}
    public_tooltip_data_by_product = {}
    drought_tooltip_data = {}
    scope_label = selected_province or selected_region or "National"
    valid_product_legends = {product: legend_for(product) for product in ("cdi", "outlook")}
    map_config = {
        "region_order": region_options,
        "release_id": selected_release.pk if selected_release else None,
        "product": selected_product,
        "product_label": valid_products[selected_product],
        "map_data_url": "", "tooltip_data_url": "", "mask_data_url": "",
        "public_data_url": "/data/drought/current.json",
        "period_label": selected_period_label,
        "issue_date": selected_release.issue_date.isoformat() if selected_release and selected_release.issue_date else "",
        "reference_date": selected_release.reference_date.isoformat() if selected_release and selected_release.reference_date else "",
        "source_agency": selected_release.source_agency if selected_release else "",
        "methodology_version": selected_release.methodology_version if selected_release else "",
        "months": months, "active_month": active_month,
        "region": selected_region, "province": selected_province, "severity": selected_severity,
        "product_labels": dict(PRODUCT_OPTIONS), "product_menu_labels": dict(PRODUCT_MENU_OPTIONS),
        "period_labels": product_periods, "legends": valid_product_legends,
        "scope_label": f"{scope_label} · {valid_products[selected_product]}",
        "nearest_neighbor": selected_product in {"cdi", "outlook"},
        "mask_version": selected_release.mask_version if selected_release else "",
    }
    return {
        "releases": [release for release, _raw in releases],
        "release_filter_options": [{"release": release, "reporting_month": release.reporting_month or release.issue_date} for release, _raw in releases],
        "selected_release_reporting_month": selected_release.reporting_month if selected_release else None,
        "selected_release": selected_release,
        "product_options": PRODUCT_MENU_OPTIONS,
        "selected_product": selected_product, "selected_product_label": valid_products[selected_product],
        "selected_product_menu_label": dict(PRODUCT_MENU_OPTIONS)[selected_product],
        "selected_period_label": selected_period_label, "product_periods": product_periods,
        "forecast_period_label": forecast_period, "assessment_period_label": product_periods["cdi"],
        "region_options": region_options, "province_options": province_options,
        "severity_options": severity_options,
        "selected_filters": {"issue_date": selected_release.reporting_month if selected_release else None, "product": selected_product, "region": selected_region, "province": selected_province, "severity": selected_severity, "active_month": active_month},
        "map_data": {}, "mask_data": mask_data, "mask_available": bool(mask_data["values"]),
        "pagasa_overlay": pagasa_overlay, "pagasa_overlay_available": bool(pagasa_overlay),
        "pagasa_overlay_option_available": bool(pagasa_overlay) and selected_product == "svtr",
        "pagasa_condition_option_available": bool(pagasa_overlay.get("conditions")) and selected_product == "svtr",
        "pagasa_overlay_legend": legend_for("percent_normal"), "pagasa_condition_legend": list(PAGASA_CONDITION_LEGEND),
        "map_config": map_config, "outlook_shapefile_download_available": False, "outlook_shapefile_download_url": "",
        "legend": legend_for(selected_product), "drought_tooltip_data": drought_tooltip_data,
        "public_static_export": True, "public_map_data_by_product": public_map_data_by_product,
        "public_tooltip_data_by_product": public_tooltip_data_by_product,
        "affected_area_basis": "Agricultural pixels" if selected_release and selected_release.mask_version else "Valid drought pixels",
        "filter_panel_title": "Published snapshot", "filter_panel_chips": [], "active_filter_chips": [],
    }
