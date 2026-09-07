from __future__ import annotations

from typing import Any

from reports.analytics.options import commodity_group_filter
from reports.incident_attribution import damage_report_analysis_date_expression

METRIC_CONFIG = {
    "farmers": {
        "field": "affected_farmers_fisherfolk_count",
        "label": "Affected Farmers/Fisherfolk",
        "short_label": "Affected Farmers",
        "prefix": "",
        "suffix": "",
        "format": "integer",
    },
    "area": {
        "field": "area_affected_ha",
        "label": "Area Affected",
        "short_label": "Area Affected",
        "prefix": "",
        "suffix": " ha",
        "format": "decimal",
    },
    "volume": {
        "field": "production_loss_mt",
        "label": "Volume Loss",
        "short_label": "Volume Loss",
        "prefix": "",
        "suffix": " MT",
        "format": "decimal",
    },
    "value": {
        "field": "value_loss_php",
        "label": "Value Loss",
        "short_label": "Value Loss",
        "prefix": "PHP ",
        "suffix": "",
        "format": "money",
    },
}


def normalize_scope_filter_values(active_reports: Any, filters: dict[str, Any]) -> dict[str, Any]:
    filters = filters.copy()

    if not filters["region"]:
        filters["province"] = ""
    elif filters["province"]:
        province_matches_region = active_reports.filter(
            location_psgc_key__region_name=filters["region"],
            location_psgc_key__province_huc_name=filters["province"],
        ).exists()
        if not province_matches_region:
            filters["province"] = ""

    if not filters["commodity_group"]:
        filters["commodity_subgroup"] = ""
    elif filters["commodity_subgroup"]:
        subgroup_matches_group = active_reports.filter(
            commodity_group_filter(filters["commodity_group"]),
            commodity_key__level_3_group=filters["commodity_subgroup"],
        ).exists()
        if not subgroup_matches_group:
            filters["commodity_subgroup"] = ""

    return filters


def apply_dashboard_filters(queryset: Any, filters: dict[str, Any]) -> Any:
    queryset = queryset.alias(
        dashboard_analysis_date=(damage_report_analysis_date_expression())
    )

    if filters.get("effective_date_from"):
        queryset = queryset.filter(
            dashboard_analysis_date__gte=filters["effective_date_from"]
        )
    if filters.get("effective_date_to"):
        queryset = queryset.filter(
            dashboard_analysis_date__lte=filters["effective_date_to"]
        )

    exact_period_years = filters.get("exact_period_years") or []
    if exact_period_years:
        queryset = queryset.filter(
            dashboard_analysis_date__year__in=exact_period_years
        )

    exact_period_months = filters.get("exact_period_months") or []
    if exact_period_months:
        queryset = queryset.filter(
            dashboard_analysis_date__month__in=exact_period_months
        )

    if filters["region"]:
        queryset = queryset.filter(location_psgc_key__region_name=filters["region"])

    if filters["province"]:
        queryset = queryset.filter(
            location_psgc_key__province_huc_name=filters["province"]
        )

    if filters["commodity_group"]:
        queryset = queryset.filter(commodity_group_filter(filters["commodity_group"]))

    if filters["commodity_subgroup"]:
        queryset = queryset.filter(
            commodity_key__level_3_group=filters["commodity_subgroup"]
        )

    hazard_keys = filters.get("hazard") or []
    if isinstance(hazard_keys, str):
        hazard_keys = [hazard_keys]
    if hazard_keys:
        queryset = queryset.filter(incident_key__hazard_key__in=hazard_keys)

    return queryset


def apply_scope_filters(queryset: Any, filters: dict[str, Any]) -> Any:
    """Apply non-date dashboard filters for historical trend comparison."""
    if filters["region"]:
        queryset = queryset.filter(location_psgc_key__region_name=filters["region"])

    if filters["province"]:
        queryset = queryset.filter(
            location_psgc_key__province_huc_name=filters["province"]
        )

    if filters["commodity_group"]:
        queryset = queryset.filter(commodity_group_filter(filters["commodity_group"]))

    if filters["commodity_subgroup"]:
        queryset = queryset.filter(
            commodity_key__level_3_group=filters["commodity_subgroup"]
        )

    hazard_keys = filters.get("hazard") or []
    if isinstance(hazard_keys, str):
        hazard_keys = [hazard_keys]
    if hazard_keys:
        queryset = queryset.filter(incident_key__hazard_key__in=hazard_keys)

    return queryset


# Backwards compatibility aliases
_normalize_scope_filter_values = normalize_scope_filter_values
_apply_dashboard_filters = apply_dashboard_filters
_apply_scope_filters = apply_scope_filters
