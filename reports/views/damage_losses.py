import calendar

from django.db.models import Count, Max, Sum
from django.db.models.functions import ExtractYear
from django.http import JsonResponse
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone

from reports.analytics import (
    DATE_MODES,
    METRIC_CONFIG,
    discrete_period_selection,
)
from reports.analytics import (
    apply_dashboard_filters as _apply_dashboard_filters,
)
from reports.analytics import (
    build_active_filter_chips as _build_active_filter_chips,
)
from reports.analytics import (
    build_commodity_group_options as _build_commodity_group_options,
)
from reports.analytics import (
    build_commodity_subgroup_cascade_options as _build_commodity_subgroup_cascade_options,
)
from reports.analytics import (
    build_commodity_subgroup_options as _build_commodity_subgroup_options,
)
from reports.analytics import (
    commodity_group_from_row as _commodity_group_from_row,
)
from reports.analytics import (
    hazard_display_label as _hazard_display_label,
)
from reports.analytics import (
    hazard_sort_key as _hazard_sort_key,
)
from reports.analytics import (
    normalize_period as _normalize_period,
)
from reports.analytics import (
    normalize_scope_filter_values as _normalize_scope_filter_values,
)
from reports.analytics import (
    number as _number,
)
from reports.analytics import (
    preserved_url as _preserved_url,
)
from reports.analytics import (
    selected_period_options as _selected_period_options,
)
from reports.analytics import (
    url_with_query as _url_with_query,
)
from reports.analytics import (
    zero as _zero,
)
from reports.analytics.province_map import build_province_reporting_area_totals
from reports.hazards.tropical_cyclone_tracks import (
    HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE,
    build_operational_tc_tracks,
    build_selected_incident_tc_tracks,
    historical_tc_track_for_cyclone,
    serialize_historical_tc_tracks,
)
from reports.incident_attribution import damage_report_analysis_date_expression
from reports.location_ordering import (
    region_sort_key,
    short_region_label,
    sort_region_names,
)
from reports.map_reporting_areas import (
    NCR_REGION_NAME,
    reporting_area_filter_label,
)

from ..models import (
    DamageReport,
    RefHazard,
)

# Compatibility aliases for existing tests and imports while track payload
# construction lives in the reusable hazard module.
_HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE = HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE
_historical_tc_track_for_cyclone = historical_tc_track_for_cyclone
_serialize_historical_tc_tracks = serialize_historical_tc_tracks
_build_selected_incident_tc_tracks = build_selected_incident_tc_tracks
_build_operational_tc_tracks = build_operational_tc_tracks

MAP_CANVAS_METRIC_KEYS = (
    "value",
    "volume",
    "area",
    "farmers",
)

MAP_CANVAS_PROVINCE_FIELDS = {
    "value": "value_loss",
    "volume": "volume_loss",
    "area": "area_affected",
    "farmers": "affected_farmers",
}


def _build_hazard_chart_data(filtered_reports):
    """Return explicit hazard totals for the dashboard doughnut chart."""

    rows = (
        filtered_reports
        .values(
            "incident_key__hazard_key__hazard_key",
            "incident_key__hazard_key__hazard_category",
            "incident_key__hazard_key__hazard_type",
        )
        .annotate(
            affected_farmers=Sum(
                METRIC_CONFIG["farmers"]["field"],
            ),
            area_affected=Sum(
                METRIC_CONFIG["area"]["field"],
            ),
            volume_loss=Sum(
                METRIC_CONFIG["volume"]["field"],
            ),
            value_loss=Sum(
                METRIC_CONFIG["value"]["field"],
            ),
        )
        .order_by(
            "incident_key__hazard_key__hazard_key",
        )
    )

    chart_rows = []
    for row in rows:
        hazard_key = row[
            "incident_key__hazard_key__hazard_key"
        ]
        if not hazard_key:
            continue
        chart_rows.append(
            {
                "label": _hazard_display_label(
                    hazard_key,
                    row["incident_key__hazard_key__hazard_type"],
                    row["incident_key__hazard_key__hazard_category"],
                ),
                "hazard_key": hazard_key,
                "affected_farmers": _number(row["affected_farmers"]),
                "area_affected": _number(row["area_affected"]),
                "volume_loss": _number(row["volume_loss"]),
                "value_loss": _number(row["value_loss"]),
            }
        )

    return chart_rows


def _default_period_year_for_incident(request, active_reports, current_year):
    """Use a selected incident's own latest report year for an implicit period."""

    incident_key = request.GET.get("incident") or ""
    has_explicit_period = any(
        request.GET.getlist(key)
        for key in (
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
        )
    )
    if not incident_key or has_explicit_period:
        return current_year

    result = (
        active_reports.filter(incident_key_id=incident_key)
        .annotate(
            map_analysis_year=ExtractYear(
                damage_report_analysis_date_expression()
            )
        )
        .aggregate(year=Max("map_analysis_year"))
    )
    return result["year"] or current_year


def _build_province_map_data(filtered_reports, metric_field, selected_years=None):
    base_map_data = build_province_reporting_area_totals(
        filtered_reports,
        metric_field,
    )
    provinces = base_map_data["provinces"]

    # Keep commodity breakdowns and scoped hazard totals in the same
    # reporting-area query so chart drill-downs stay client-side and do not
    # issue a second request.
    commodity_rows = (
        filtered_reports.annotate(
            dashboard_analysis_year=ExtractYear(
                damage_report_analysis_date_expression()
            )
        ).values(
            "location_psgc_key__province_huc_key__psgc_code",
            "location_psgc_key__province_huc_key__correspondence_code",
            "location_psgc_key__province_huc_name",
            "location_psgc_key__region_name",
            "commodity_key__main_sector",
            "commodity_key__level_2_group",
            "commodity_key__level_3_group",
            "incident_key__hazard_key__hazard_key",
            "incident_key__hazard_key__hazard_category",
            "incident_key__hazard_key__hazard_type",
            "dashboard_analysis_year",
        )
        .annotate(
            dashboard_value_loss_reported=Count("value_loss_php"),
            dashboard_volume_loss_reported=Count("production_loss_mt"),
            dashboard_area_affected_reported=Count("area_affected_ha"),
            dashboard_affected_farmers_reported=Count(
                "affected_farmers_fisherfolk_count"
            ),
            dashboard_value_loss=Sum("value_loss_php"),
            dashboard_volume_loss=Sum("production_loss_mt"),
            dashboard_area_affected=Sum("area_affected_ha"),
            dashboard_affected_farmers=Sum(
                "affected_farmers_fisherfolk_count"
            ),
        )
        .order_by()
    )
    commodity_by_area = {}
    hazards_by_area = {}
    # Some legacy/imported reports have an explicit commodity and hazard but
    # no province/HUC mapping. Keep those rows available to the commodity
    # chart instead of silently dropping their value from the distribution.
    unmapped_commodities = {}
    commodity_years = {}
    metric_reported_aliases = {
        "value": "dashboard_value_loss_reported",
        "volume": "dashboard_volume_loss_reported",
        "area": "dashboard_area_affected_reported",
        "farmers": "dashboard_affected_farmers_reported",
    }
    commodity_metric_years = {
        metric: {}
        for metric in metric_reported_aliases
    }
    commodity_metric_unallocated_years = {
        metric: {}
        for metric in metric_reported_aliases
    }
    expected_years = {
        int(year)
        for year in (selected_years or [])
        if str(year).strip().lstrip("-").isdigit()
    }

    def empty_metrics():
        return {
            "value_loss": 0.0,
            "volume_loss": 0.0,
            "area_affected": 0.0,
            "affected_farmers": 0.0,
        }

    def add_metrics(target, row):
        target["value_loss"] += float(
            _number(row.get("dashboard_value_loss"))
        )
        target["volume_loss"] += float(
            _number(row.get("dashboard_volume_loss"))
        )
        target["area_affected"] += float(
            _number(row.get("dashboard_area_affected"))
        )
        target["affected_farmers"] += float(
            _number(row.get("dashboard_affected_farmers"))
        )

    def serialize_commodity(label, metrics):
        return {
            "label": label,
            "value_loss": metrics["value_loss"],
            "volume_loss": metrics["volume_loss"],
            "area_affected": metrics["area_affected"],
            "affected_farmers": metrics["affected_farmers"],
            "subgroups_complete": commodity_subgroups_complete.get(
                label,
                bool(
                    metrics.get("subgroups")
                    and not metrics.get("has_unallocated_subgroup")
                ),
            ),
            "subgroups": [
                {
                    "label": subgroup_label,
                    **subgroup_metrics,
                }
                for subgroup_label, subgroup_metrics in sorted(
                    metrics.get("subgroups", {}).items(),
                    key=lambda item: (
                        -float(item[1]["value_loss"]),
                        item[0].casefold(),
                    ),
                )
            ],
        }

    def add_hazard_total(
        target,
        row,
        hazard_key,
        hazard_label,
        subgroup_label="",
    ):
        storage_key = (
            (hazard_key, subgroup_label)
            if subgroup_label
            else hazard_key
        )
        hazard_totals = target.setdefault(
            storage_key,
            {
                "label": hazard_label,
                "hazard_key": hazard_key,
                "subgroup": subgroup_label,
                "affected_farmers": 0.0,
                "area_affected": 0.0,
                "volume_loss": 0.0,
                "value_loss": 0.0,
            },
        )
        hazard_totals["affected_farmers"] += float(
            _number(row.get("dashboard_affected_farmers"))
        )
        hazard_totals["area_affected"] += float(
            _number(row.get("dashboard_area_affected"))
        )
        hazard_totals["volume_loss"] += float(
            _number(row.get("dashboard_volume_loss"))
        )
        hazard_totals["value_loss"] += float(
            _number(row.get("dashboard_value_loss"))
        )

    for row in commodity_rows:
        region_name = str(
            row.get("location_psgc_key__region_name")
            or ""
        ).strip()
        raw_area_code = (
            row.get(
                "location_psgc_key__province_huc_key__psgc_code"
            )
            or row.get(
                "location_psgc_key__province_huc_key__correspondence_code"
            )
            or row.get(
                "location_psgc_key__province_huc_name"
            )
            or ""
        )
        area_key = str(raw_area_code).strip().upper()

        if (
            region_name == "National Capital Region (NCR)"
            or area_key.startswith("13")
        ):
            area_key = "1300000000"

        commodity_label = str(
            _commodity_group_from_row(row)
            or ""
        ).strip()
        if not commodity_label:
            continue

        analysis_year = row.get("dashboard_analysis_year")
        if analysis_year is not None:
            analysis_year = int(analysis_year)
            commodity_years.setdefault(commodity_label, set()).add(
                analysis_year
            )
            for metric, reported_alias in metric_reported_aliases.items():
                if row.get(reported_alias):
                    commodity_metric_years[metric].setdefault(
                        commodity_label,
                        set(),
                    ).add(analysis_year)

        hazard_key = str(
            row.get("incident_key__hazard_key__hazard_key") or ""
        ).strip()
        hazard_label = ""
        if hazard_key:
            hazard_label = _hazard_display_label(
                hazard_key,
                row.get("incident_key__hazard_key__hazard_type"),
                row.get("incident_key__hazard_key__hazard_category"),
            )

        if not area_key:
            fallback_key = (
                region_name,
                commodity_label,
                hazard_key,
            )
            fallback_totals = unmapped_commodities.setdefault(
                fallback_key,
                {
                    "label": commodity_label,
                    "region_name": region_name,
                    "hazard_key": hazard_key,
                    "hazard_label": hazard_label,
                    "value_loss": 0.0,
                    "volume_loss": 0.0,
                    "area_affected": 0.0,
                    "affected_farmers": 0.0,
                    "subgroups": {},
                    "has_unallocated_subgroup": False,
                },
            )
            add_metrics(fallback_totals, row)
            subgroup_label = str(
                row.get("commodity_key__level_3_group") or ""
            ).strip()
            if subgroup_label:
                subgroup_totals = fallback_totals["subgroups"].setdefault(
                    subgroup_label,
                    empty_metrics(),
                )
                add_metrics(subgroup_totals, row)
            else:
                fallback_totals["has_unallocated_subgroup"] = True
                if analysis_year is not None:
                    for metric, reported_alias in metric_reported_aliases.items():
                        if row.get(reported_alias):
                            commodity_metric_unallocated_years[metric].setdefault(
                                commodity_label,
                                set(),
                            ).add(analysis_year)
            continue

        area_commodities = commodity_by_area.setdefault(
            area_key,
            {},
        )
        commodity_totals = area_commodities.setdefault(
            commodity_label,
            {
                "value_loss": 0.0,
                "volume_loss": 0.0,
                "area_affected": 0.0,
                "affected_farmers": 0.0,
                "subgroups": {},
                "has_unallocated_subgroup": False,
            },
        )
        add_metrics(commodity_totals, row)
        subgroup_label = str(
            row.get("commodity_key__level_3_group") or ""
        ).strip()
        if subgroup_label:
            subgroup_totals = commodity_totals["subgroups"].setdefault(
                subgroup_label,
                empty_metrics(),
            )
            add_metrics(subgroup_totals, row)
        else:
            commodity_totals["has_unallocated_subgroup"] = True
            if analysis_year is not None:
                for metric, reported_alias in metric_reported_aliases.items():
                    if row.get(reported_alias):
                        commodity_metric_unallocated_years[metric].setdefault(
                            commodity_label,
                            set(),
                        ).add(analysis_year)

        if hazard_key:
            area_hazards = hazards_by_area.setdefault(
                area_key,
                {"all": {}, "commodities": {}},
            )
            add_hazard_total(
                area_hazards["all"],
                row,
                hazard_key,
                hazard_label,
            )
            commodity_hazards = area_hazards["commodities"].setdefault(
                commodity_label,
                {},
            )
            add_hazard_total(
                commodity_hazards,
                row,
                hazard_key,
                hazard_label,
                subgroup_label,
            )

    if not expected_years:
        expected_years = set().union(*commodity_years.values()) if commodity_years else set()
    commodity_subgroups_complete_by_metric = {
        metric: {
            label: bool(years) and expected_years.issubset(years)
            and not commodity_metric_unallocated_years[metric].get(label)
            for label, years in commodity_metric_years[metric].items()
        }
        for metric in metric_reported_aliases
    }
    # Keep the original field as the default Value chart completeness flag.
    commodity_subgroups_complete = commodity_subgroups_complete_by_metric["value"]

    for province in provinces:
        province_region = str(
            province.get("region_name") or ""
        ).strip()
        province_area_key = str(
            province.get("psgc_code")
            or province.get("correspondence_code")
            or province.get("province_name")
            or ""
        ).strip().upper()

        if (
            province_region == "National Capital Region (NCR)"
            or province_area_key.startswith("13")
        ):
            province_area_key = "1300000000"

        province["commodities"] = [
            serialize_commodity(label, metrics)
            for label, metrics in sorted(
                commodity_by_area.get(
                    province_area_key,
                    {},
                ).items(),
                key=lambda item: (
                    -item[1]["value_loss"],
                    item[0].casefold(),
                ),
            )
        ]

    def sort_hazard_totals(rows):
        return sorted(
            rows.values(),
            key=lambda item: (
                -float(item["value_loss"]),
                str(item["hazard_key"]).casefold(),
            ),
        )

    serialized_hazards_by_area = {}
    for area_key, area_hazards in hazards_by_area.items():
        serialized_hazards_by_area[area_key] = {
            "all": sort_hazard_totals(area_hazards["all"]),
            "commodities": {
                commodity_label: sort_hazard_totals(hazard_rows)
                for commodity_label, hazard_rows in area_hazards[
                    "commodities"
                ].items()
            },
        }

    return {
        "provinces": provinces,
        "max_metric_value": base_map_data["max_metric_value"],
        "commodity_subgroups_complete": commodity_subgroups_complete,
        "commodity_subgroups_complete_by_metric": commodity_subgroups_complete_by_metric,
        "unmapped_commodities": sorted(
            (
                {
                    **item,
                    "subgroups_complete": commodity_subgroups_complete.get(
                        item["label"],
                        bool(
                            item.get("subgroups")
                            and not item.get("has_unallocated_subgroup")
                        ),
                    ),
                    "subgroups": [
                        {
                            "label": subgroup_label,
                            **subgroup_metrics,
                        }
                        for subgroup_label, subgroup_metrics in sorted(
                            item.get("subgroups", {}).items(),
                            key=lambda entry: (
                                -float(entry[1]["value_loss"]),
                                entry[0].casefold(),
                            ),
                        )
                    ],
                }
                for item in unmapped_commodities.values()
            ),
            key=lambda item: (
                -float(item["value_loss"]),
                str(item["label"]).casefold(),
                str(item["region_name"]).casefold(),
                str(item["hazard_key"]).casefold(),
            ),
        ),
        "hazards_by_area": serialized_hazards_by_area,
    }


def _is_tropical_cyclone_hazard(hazard):
    """Return whether a selected hazard represents tropical cyclone."""

    if hazard is None:
        return False

    values = (
        getattr(hazard, "display_label", ""),
        getattr(hazard, "hazard_key", ""),
        getattr(hazard, "hazard_type", ""),
        getattr(hazard, "hazard_category", ""),
    )

    normalized_values = {
        " ".join(
            str(value or "")
            .replace("_", " ")
            .replace("-", " ")
            .split()
        ).casefold()
        for value in values
    }

    return bool(
        {
            "tropical cyclone",
            "tc",
        }
        & normalized_values
    )


def _dynamic_incident_options(request):
    """Return incidents matching the pending Damage & Losses filters."""

    current_year = timezone.now().year

    active_reports = DamageReport.objects.filter(
        is_active=True
    )

    hazard_key = (
        request.GET.get("hazard")
        or ""
    )

    if not hazard_key:
        return []

    hazard_exists = (
        RefHazard.objects
        .filter(
            hazard_key=hazard_key,
            is_active=True,
            archived_at__isnull=True,
        )
        .exists()
    )

    if not hazard_exists:
        return []

    available_years = list(
        active_reports
        .annotate(
            map_analysis_year=ExtractYear(
                damage_report_analysis_date_expression()
            )
        )
        .exclude(
            map_analysis_year__isnull=True
        )
        .values_list(
            "map_analysis_year",
            flat=True,
        )
        .distinct()
        .order_by(
            "-map_analysis_year"
        )
    )

    period = _normalize_period(
        request,
        active_reports,
        current_year,
        _default_period_year_for_incident(
            request,
            active_reports,
            current_year,
        ),
    )

    period.update(
        _selected_period_options(
            period,
            available_years,
        )
    )

    period.update(
        discrete_period_selection(
            request,
            period,
            available_years,
        )
    )

    filters = {
        **period,
        "region": "",
        "province": "",
        "commodity_group": (
            request.GET.get(
                "commodity_group"
            )
            or ""
        ),
        "commodity_subgroup": (
            request.GET.get(
                "commodity_subgroup"
            )
            or ""
        ),
        "hazard": hazard_key,
        "incident": "",
        "metric": "value",
    }

    filters = _normalize_scope_filter_values(
        active_reports,
        filters,
    )

    matching_reports = (
        _apply_dashboard_filters(
            active_reports,
            filters,
        )
    )

    rows = (
        matching_reports
        .exclude(
            incident_key__isnull=True
        )
        .filter(
            incident_key__hazard_key_id=(
                hazard_key
            )
        )
        .values(
            "incident_key_id",
            "incident_key__incident_name",
            "incident_key__hazard_key_id",
        )
        .distinct()
        .order_by(
            "incident_key__incident_name",
            "incident_key_id",
        )
    )

    return [
        {
            "value": row[
                "incident_key_id"
            ],
            "label": (
                row[
                    "incident_key__incident_name"
                ]
                or row[
                    "incident_key_id"
                ]
            ),
            "parent": row[
                "incident_key__hazard_key_id"
            ],
        }
        for row in rows
    ]


def damage_losses_incident_options(
    request,
):
    """Return live Incident choices for pending filter selections."""

    return JsonResponse(
        {
            "options": (
                _dynamic_incident_options(
                    request
                )
            )
        }
    )

def dashboard(request):
    """Show Province/HUC-level spatial analytics with one consolidated NCR."""
    current_year = timezone.now().year
    active_reports = DamageReport.objects.filter(is_active=True)

    active_hazards = list(
        RefHazard.objects.filter(
            is_active=True,
            archived_at__isnull=True,
        ).order_by("hazard_key")
    )
    for hazard in active_hazards:
        hazard.display_label = _hazard_display_label(
            hazard.hazard_key,
            hazard.hazard_type,
            hazard.hazard_category,
        )
    active_hazards.sort(key=_hazard_sort_key)
    active_hazards_by_key = {hazard.hazard_key: hazard for hazard in active_hazards}
    selected_hazard = active_hazards_by_key.get(request.GET.get("hazard") or "")
    show_tropical_cyclone_track_layer = (
        _is_tropical_cyclone_hazard(
            selected_hazard
        )
    )

    available_years = list(
        active_reports.annotate(
            map_analysis_year=ExtractYear(damage_report_analysis_date_expression())
        )
        .exclude(map_analysis_year__isnull=True)
        .values_list("map_analysis_year", flat=True)
        .distinct()
        .order_by("-map_analysis_year")
    )

    # Prefer the current release year when it is present so the Dashboard opens
    # on the latest available data. Fall back to the newest prior year when
    # there is no current-year dataset to display.
    default_period_year = (
        current_year
        if current_year in available_years
        else next(
            (
                year
                for year in available_years
                if year < current_year
            ),
            current_year,
        )
    )

    selected_metric = "value"

    period = _normalize_period(
        request,
        active_reports,
        current_year,
        _default_period_year_for_incident(
            request,
            active_reports,
            default_period_year,
        ),
    )
    period.update(_selected_period_options(period, available_years))
    period.update(
        discrete_period_selection(
            request,
            period,
            available_years,
        )
    )

    filters = {
        **period,
        "region": request.GET.get("region") or "",
        "province": request.GET.get("province") or "",
        "commodity_group": request.GET.get("commodity_group") or "",
        "commodity_subgroup": request.GET.get("commodity_subgroup") or "",
        "hazard": selected_hazard.hazard_key if selected_hazard else "",
        "metric": selected_metric,
    }
    filters = _normalize_scope_filter_values(
        active_reports,
        filters,
    )
    filters["incident"] = ""
    if filters["region"] == NCR_REGION_NAME:
        filters["province"] = ""

    region_options = sort_region_names(
        active_reports.exclude(location_psgc_key__region_name__isnull=True)
        .exclude(location_psgc_key__region_name="")
        .values_list("location_psgc_key__region_name", flat=True)
        .distinct()
    )

    province_source = active_reports
    if filters["region"]:
        province_source = province_source.filter(
            location_psgc_key__region_name=filters["region"]
        )

    province_options = []
    if filters["region"] != NCR_REGION_NAME:
        province_names = list(
            province_source.exclude(location_psgc_key__province_huc_name__isnull=True)
            .exclude(location_psgc_key__province_huc_name="")
            .values_list("location_psgc_key__province_huc_name", flat=True)
            .distinct()
            .order_by("location_psgc_key__province_huc_name")
        )
        province_options = [
            {
                "value": province_name,
                "label": reporting_area_filter_label(province_name),
            }
            for province_name in province_names
        ]

    province_cascade_options = []
    for option in sorted(
        active_reports.exclude(location_psgc_key__province_huc_name__isnull=True)
        .exclude(location_psgc_key__province_huc_name="")
        .exclude(location_psgc_key__region_name__isnull=True)
        .exclude(location_psgc_key__region_name="")
        .values(
            "location_psgc_key__region_name",
            "location_psgc_key__province_huc_name",
        )
        .distinct(),
        key=lambda item: (
            region_sort_key(item["location_psgc_key__region_name"]),
            str(item["location_psgc_key__province_huc_name"]).casefold(),
        ),
    ):
        region_name = option["location_psgc_key__region_name"]
        if region_name == NCR_REGION_NAME:
            continue
        province_name = option["location_psgc_key__province_huc_name"]
        province_cascade_options.append(
            {
                "value": province_name,
                "label": reporting_area_filter_label(province_name),
                "parent": region_name,
            }
        )

    commodity_group_options = _build_commodity_group_options(active_reports)
    commodity_subgroup_options = _build_commodity_subgroup_options(
        active_reports,
        filters["commodity_group"],
    )
    commodity_subgroup_cascade_options = _build_commodity_subgroup_cascade_options(
        active_reports
    )

    incident_option_filters = {
        **filters,
        "hazard": "",
        "incident": "",
    }
    incident_option_reports = _apply_dashboard_filters(
        active_reports,
        incident_option_filters,
    )

    incident_rows = list(
        incident_option_reports.filter(
            incident_key__hazard_key_id__in=tuple(
                active_hazards_by_key
            ),
        )
        .exclude(
            incident_key__isnull=True,
        )
        .values(
            "incident_key_id",
            "incident_key__incident_name",
            "incident_key__hazard_key_id",
        )
        .distinct()
        .order_by(
            "incident_key__hazard_key_id",
            "incident_key__incident_name",
            "incident_key_id",
        )
    )

    incident_cascade_options = [
        {
            "value": row["incident_key_id"],
            "label": (
                row["incident_key__incident_name"]
                or row["incident_key_id"]
            ),
            "parent": (
                row[
                    "incident_key__hazard_key_id"
                ]
            ),
        }
        for row in incident_rows
    ]

    requested_incident = (
        request.GET.get("incident") or ""
    )
    selected_incident = None

    if filters["hazard"]:
        selected_incident = next(
            (
                option
                for option in incident_cascade_options
                if (
                    option["value"]
                    == requested_incident
                    and option["parent"]
                    == filters["hazard"]
                )
            ),
            None,
        )

    filtered_reports = incident_option_reports

    if filters["hazard"]:
        filtered_reports = filtered_reports.filter(
            incident_key__hazard_key_id=filters["hazard"]
        )

    if selected_incident:
        filters["incident"] = (
            selected_incident["value"]
        )
        filtered_reports = filtered_reports.filter(
            incident_key_id=(
                selected_incident["value"]
            )
        )

    metric_config = METRIC_CONFIG[selected_metric]
    metric_field = metric_config["field"]

    totals = filtered_reports.aggregate(
        record_count=Count("damage_report_key"),
        **{
            f"{metric_key}_total": Sum(
                METRIC_CONFIG[metric_key]["field"]
            )
            for metric_key in MAP_CANVAS_METRIC_KEYS
        },
    )
    map_reports = filtered_reports
    if filters["province"]:
        comparison_filters = {
            **filters,
            "province": "",
        }
        map_reports = _apply_dashboard_filters(
            active_reports,
            comparison_filters,
        )

    map_data = _build_province_map_data(
        map_reports,
        metric_field,
        selected_years=filters.get("selected_years"),
    )
    map_data["hazards"] = _build_hazard_chart_data(filtered_reports)

    selected_incident_key = (
        selected_incident["value"]
        if selected_incident
        else ""
    )

    map_data["tropical_cyclone_tracks"] = (
        _build_selected_incident_tc_tracks(
            selected_incident_key
        )
        if (
            show_tropical_cyclone_track_layer
            and selected_incident_key
        )
        else []
    )
    # Operational tracks are live catalog data, but the Dashboard layer is
    # intentionally scoped to the selected incident's explicit TC links.
    # Without an incident filter, no operational track options are exposed.
    map_data["tropical_cyclone_operational_tracks"] = (
        _build_operational_tc_tracks(selected_incident_key)
    )

    map_config = {
        "metric_key": selected_metric,
        "metric_label": metric_config["label"],
        "metric_prefix": metric_config["prefix"],
        "metric_suffix": metric_config["suffix"],
        "metric_format": metric_config["format"],
        "metrics": {
            metric_key: {
                "label": (
                    METRIC_CONFIG[metric_key]["label"]
                ),
                "prefix": (
                    METRIC_CONFIG[metric_key]["prefix"]
                ),
                "suffix": (
                    METRIC_CONFIG[metric_key]["suffix"]
                ),
                "format": (
                    METRIC_CONFIG[metric_key]["format"]
                ),
                "province_field": (
                    MAP_CANVAS_PROVINCE_FIELDS[
                        metric_key
                    ]
                ),
                "total": _number(
                    totals[f"{metric_key}_total"]
                ),
            }
            for metric_key in MAP_CANVAS_METRIC_KEYS
        },
        "period_label": filters["period_label"],
        "commodity_label": (
            filters["commodity_subgroup"]
            or filters["commodity_group"]
            or "All Commodities"
        ),
        "hazard_label": (
            selected_hazard.display_label
            if selected_hazard
            else ""
        ),
        "hazard_key": filters["hazard"],
        "incident_label": (
            selected_incident["label"]
            if selected_incident
            else ""
        ),
        "show_tropical_cyclone_track_layer": (
            show_tropical_cyclone_track_layer
        ),
        "show_operational_tropical_cyclone_track_layer": bool(
            map_data["tropical_cyclone_operational_tracks"]
        ),
        "tropical_cyclone_incident_selected": (
            bool(selected_incident_key)
        ),
        "reset_extent_on_width_change": True,
        "location_label": (
            reporting_area_filter_label(
                filters["province"]
            )
            if filters["province"]
            else filters["region"] or "National"
        ),
        "region_options": [
            {
                "value": region_name,
                "label": short_region_label(region_name),
            }
            for region_name in region_options
        ],
        "base_region_name": filters["region"],
        "base_province_code": (
            next(
                (
                    province["psgc_code"]
                    for province in map_data["provinces"]
                    if reporting_area_filter_label(
                        province["province_name"]
                    )
                    == reporting_area_filter_label(
                        filters["province"]
                    )
                ),
                "",
            )
            if filters["province"]
            else ""
        ),
        "metric_total": _number(
            totals[f"{selected_metric}_total"]
        ),
        "record_count": int(_zero(totals["record_count"])),
        "province_count": len(map_data["provinces"]),
    }

    scope_filter_chips = _build_active_filter_chips(
        request,
        {
            **filters,
            "province": reporting_area_filter_label(
                filters["province"]
            ),
            "metric": "",
        },
        metric_config,
        metric_label="Map metric",
        include_defaults=True,
        include_period=False,
        default_labels={
            "region": "All Regions",
            "province": "All Provinces",
            "commodity_group": "All Commodity",
            "commodity_subgroup": "All Subgroups",
        },
    )
    period_remove_keys = [
        "period_mode",
        "years",
        "year",
        "year_all",
        "start_year",
        "end_year",
        "months",
        "month",
        "month_all",
        "start_month",
        "end_month",
    ]
    period_clear_url = _url_with_query(
        request,
        remove=period_remove_keys,
    )
    active_filter_chips = [
        {
            "label": filters["selected_year_label"],
            "clear_url": (
                ""
                if filters.get("period_mode") == "latest_year"
                else period_clear_url
            ),
        },
        {
            "label": filters["selected_month_label"],
            "clear_url": (
                ""
                if filters.get("period_mode") == "latest_year"
                and filters["selected_month_label"] == "All Months"
                else period_clear_url
            ),
        },
    ]

    if selected_hazard:
        active_filter_chips.append(
            {
                "label": selected_hazard.display_label,
                "clear_url": _url_with_query(
                    request,
                    remove=["hazard", "incident"],
                ),
            }
        )
    else:
        active_filter_chips.append({"label": "All Hazards", "clear_url": ""})
    if selected_incident:
        active_filter_chips.append(
            {
                "label": selected_incident["label"],
                "clear_url": _url_with_query(
                    request,
                    remove=["incident"],
                ),
            }
        )
    active_filter_chips.extend(scope_filter_chips)

    dashboard_reset_url = reverse("reports:dashboard")
    if request.GET.get("embed") == "1":
        dashboard_reset_url = f"{dashboard_reset_url}?embed=1"

    response = render(
        request,
        "reports/damage_losses.html",
        {
            "available_years": available_years,
            "month_options": [
                {
                    "value": month_number,
                    "label": calendar.month_name[month_number],
                    "short_label": calendar.month_abbr[month_number],
                }
                for month_number in range(1, 13)
            ],
            "date_modes": DATE_MODES,
            "active_hazards": active_hazards,
            "selected_hazard": selected_hazard,
            "selected_incident": selected_incident,
            "incident_cascade_options": (
                incident_cascade_options
            ),
            "region_options": region_options,
            "province_options": province_options,
            "province_cascade_options": province_cascade_options,
            "commodity_group_options": commodity_group_options,
            "commodity_subgroup_options": commodity_subgroup_options,
            "commodity_subgroup_cascade_options": commodity_subgroup_cascade_options,
            "selected_filters": {
                **filters,
                "province_label": reporting_area_filter_label(filters["province"]),
            },
            "selected_metric": metric_config,
            "record_count": _zero(totals["record_count"]),
            "metric_total": _zero(
                totals[f"{selected_metric}_total"]
            ),
            "map_data": map_data,
            "map_config": map_config,
            "active_filter_chips": active_filter_chips,
            "is_embedded": request.GET.get("embed") == "1",
            "dashboard_reset_url": dashboard_reset_url,
            "dashboard_navigation_url": _preserved_url(
                request,
                reverse("reports:analytics"),
            ),
        },
    )
    if request.GET.get("embed") == "1":
        response["X-Frame-Options"] = "SAMEORIGIN"
    return response


damage_losses = dashboard
