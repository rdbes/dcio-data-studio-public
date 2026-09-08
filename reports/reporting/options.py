"""Metric definitions, scope options, filter normalization, and context builders for Report Generation."""

from __future__ import annotations

from calendar import month_abbr
from collections import defaultdict
from typing import Any

from django.conf import settings
from django.db.models import Q, Sum

from ..analytics.options import (
    hazard_display_label,
    hazard_sort_key,
)
from ..incident_attribution import (
    damage_report_analysis_date_expression,
)
from ..location_ordering import region_sort_key
from ..models import DamageReport, RefCommodity

METRIC_OPTIONS = (
    {
        "key": "farmers",
        "field": "affected_farmers_fisherfolk_count",
        "label": "Farmers/Fisherfolk Affected",
        "unit": "people",
        "sectors": (),
        "is_count": True,
    },
    {
        "key": "area_totally_damaged",
        "field": "area_totally_damaged_ha",
        "label": "Area Totally Damaged",
        "unit": "ha",
        "sectors": ("Crops",),
        "is_count": False,
    },
    {
        "key": "area_partially_damaged",
        "field": "area_partially_damaged_ha",
        "label": "Area Partially Damaged",
        "unit": "ha",
        "sectors": ("Crops",),
        "is_count": False,
    },
    {
        "key": "area_affected",
        "field": "area_affected_ha",
        "label": "Total Area Affected",
        "unit": "ha",
        "sectors": ("Crops",),
        "is_count": False,
    },
    {
        "key": "volume_loss",
        "field": "production_loss_mt",
        "label": "Production Volume Loss",
        "unit": "MT",
        "sectors": ("Crops", "Fisheries"),
        "is_count": False,
    },
    {
        "key": "value_loss",
        "field": "value_loss_php",
        "label": "Production Value Loss",
        "unit": "PHP",
        "sectors": (),
        "is_count": False,
    },
    {
        "key": "livestock_heads",
        "field": "affected_livestock_poultry_heads_count",
        "label": "Livestock/Poultry Heads",
        "unit": "heads",
        "sectors": ("Livestock and Poultry",),
        "is_count": True,
    },
)


CONSOLIDATION_OPTIONS = (
    {
        "value": "detailed",
        "label": "Detailed records",
        "description": (
            "Keep the current detailed "
            "canonical report rows."
        ),
    },
    {
        "value": "region",
        "label": "Region",
        "description": (
            "Produce one summary row "
            "for each region."
        ),
    },
    {
        "value": "province",
        "label": "Province",
        "description": (
            "Produce one summary row for "
            "each province within its region."
        ),
    },
    {
        "value": "incident",
        "label": "Incident",
        "description": (
            "Produce one summary row for "
            "each stable incident key."
        ),
    },
)

CONSOLIDATION_LABELS = {
    option["value"]: option["label"]
    for option in CONSOLIDATION_OPTIONS
}


GROUP_LABELS = {
    "AMEF": (
        "Agricultural Infrastructure, "
        "Machinery and Equipment"
    ),
    "Fisheries": "Fisheries",
    "Livestock and Poultry": (
        "Livestock and Poultry"
    ),
}


GROUP_ORDER = {
    "Rice": 10,
    "Corn": 20,
    "Cassava": 30,
    "High Value Crops": 40,
    "Fiber Crops": 50,
    "Coconut": 60,
    "Sugarcane": 70,
    "Tobacco": 80,
    "Fisheries": 100,
    "Livestock and Poultry": 110,
    "AMEF": 120,
}


COMMODITY_ORDER = {
    "CMD_CROPS_RICE": 10,
    "CMD_CROPS_CORN": 20,
    "CMD_CROPS_CORN_YELLOW": 21,
    "CMD_CROPS_CORN_WHITE": 22,
    "CMD_CROPS_CASSAVA": 30,
    "CMD_CROPS_HVC": 40,
    "CMD_CROPS_HVC_VEGETABLES": 41,
    "CMD_CROPS_HVC_FRUITS": 42,
    "CMD_CROPS_HVC_MANGO": 43,
    "CMD_CROPS_HVC_BANANA": 44,
    "CMD_CROPS_HVC_PLANTATION": 45,
    "CMD_CROPS_HVC_ROOT": 46,
    "CMD_CROPS_HVC_ORNAMENTAL": 47,
    "CMD_CROPS_FIBER": 50,
    "CMD_CROPS_COCONUT": 60,
    "CMD_CROPS_SUGARCANE": 70,
    "CMD_CROPS_TOBACCO": 80,
    # Keep detailed Fisheries categories in their requested export order.
    "CMD_FISHERIES_PRODUCE": 101,
    "CMD_FISHERIES_GEAR_FACILITY_EQUIPMENT": 102,
    # Historical lumped records remain available after the detailed groups.
    "CMD_FISHERIES": 103,
    "CMD_LIVESTOCK_POULTRY": 110,
    # AMEF follows the AMEF classification order requested for exports.
    "CMD_AMEF_IRRIGATION_NIS": 121,
    "CMD_AMEF_IRRIGATION_SSIS": 122,
    "CMD_AMEF_FACILITIES": 123,
    "CMD_AMEF_MACHINERIES_EQUIPMENT": 124,
    # Aggregate/legacy irrigation and AMEF records follow detailed groups.
    "CMD_AMEF_IRRIGATION": 125,
    "CMD_AMEF": 126,
}


def _commodity_sort_key(
    option: dict[str, Any],
) -> tuple[Any, ...]:
    return (
        GROUP_ORDER.get(
            option["parent"],
            999,
        ),
        COMMODITY_ORDER.get(
            option["value"],
            999,
        ),
        0 if not option["level_3"] else 1,
        option["label"].casefold(),
    )


def _base_queryset():
    return DamageReport.objects.filter(
        is_active=True,
    )


def _public_release_renderer() -> bool:
    return bool(
        getattr(settings, "PUBLIC_RELEASE_RENDERER", False)
    )


def _group_label(value: str) -> str:
    return GROUP_LABELS.get(value, value)


def _reporting_group(
    commodity: RefCommodity,
) -> str:
    if commodity.main_sector == "Crops":
        return (
            commodity.level_2_group
            or commodity.main_sector
        )

    return commodity.main_sector


def _commodity_label(
    commodity: RefCommodity,
    *,
    has_children: bool,
) -> str:
    if commodity.level_3_group:
        return commodity.level_3_group

    if (
        commodity.main_sector
        in {"Fisheries", "AMEF"}
        and commodity.level_2_group
    ):
        return commodity.level_2_group

    group = _reporting_group(commodity)
    label = _group_label(group)

    if has_children:
        return f"{label} Total"

    return label


def _build_commodity_catalog() -> dict[str, Any]:
    commodities = list(
        RefCommodity.objects.filter(
            is_active=True,
            archived_at__isnull=True,
        ).order_by(
            "main_sector",
            "level_2_group",
            "level_3_group",
            "commodity_key",
        )
    )

    grouped: dict[
        str,
        list[RefCommodity],
    ] = defaultdict(list)

    for commodity in commodities:
        grouped[
            _reporting_group(commodity)
        ].append(commodity)

    groups = []
    options = []
    member_keys = {}

    for group_value, rows in grouped.items():
        sector = rows[0].main_sector

        has_children = any(
            row.level_3_group
            or (
                row.main_sector
                in {"Fisheries", "AMEF"}
                and row.level_2_group
            )
            for row in rows
        )

        groups.append(
            {
                "value": group_value,
                "label": _group_label(
                    group_value
                ),
                "sector": sector,
            }
        )

        member_keys[group_value] = {
            row.commodity_key
            for row in rows
        }

        for row in rows:
            options.append(
                {
                    "value": row.commodity_key,
                    "label": _commodity_label(
                        row,
                        has_children=has_children,
                    ),
                    "parent": group_value,
                    "sector": row.main_sector,
                    "level_2": (
                        row.level_2_group or ""
                    ),
                    "level_3": (
                        row.level_3_group or ""
                    ),
                    "is_parent": (
                        not row.level_3_group
                        and not (
                            row.main_sector
                            in {"Fisheries", "AMEF"}
                            and row.level_2_group
                        )
                    ),
                }
            )

    groups.sort(
        key=lambda option: (
            GROUP_ORDER.get(
                option["value"],
                999,
            ),
            option["label"].casefold(),
        )
    )

    options.sort(key=_commodity_sort_key)

    return {
        "groups": groups,
        "commodities": options,
        "member_keys": member_keys,
    }


def _build_scope_options(queryset):
    fields = [
        "incident_key_id",
        "incident_key__incident_name",
        "incident_key__incident_start_date",
        "incident_key__hazard_key_id",
        "incident_key__hazard_key__hazard_category",
        "incident_key__hazard_key__hazard_type",
        "location_psgc_key__region_name",
        "location_psgc_key__province_huc_name",
        "report_analysis_date",
    ]
    if not _public_release_renderer():
        fields.insert(-1, "import_batch_key__source_year")
    rows = list(
        queryset.annotate(
            report_analysis_date=(
                damage_report_analysis_date_expression()
            )
        ).values(*fields).distinct()
    )

    years = set()
    month_years = defaultdict(set)
    region_provinces = defaultdict(set)
    hazard_labels = {}
    incidents = {}

    for row in rows:
        incident_key = row["incident_key_id"]

        if not incident_key:
            continue

        incident = incidents.setdefault(
            incident_key,
            {
                "value": incident_key,
                "label": (
                    row[
                        "incident_key__incident_name"
                    ]
                    or incident_key
                ),
                "hazard": (
                    row[
                        "incident_key__hazard_key_id"
                    ]
                    or ""
                ),
                "years": set(),
                "months": set(),
                "regions": set(),
                "provinces": set(),
            },
        )

        incident_date = row[
            "report_analysis_date"
        ]
        source_year = row.get(
            "import_batch_key__source_year"
        )

        if incident_date:
            years.add(incident_date.year)
            incident["years"].add(
                incident_date.year
            )
            incident["months"].add(
                incident_date.month
            )
            month_years[
                incident_date.month
            ].add(incident_date.year)
        elif source_year:
            years.add(source_year)
            incident["years"].add(source_year)

        region = (
            row[
                "location_psgc_key__region_name"
            ]
            or ""
        )
        province = (
            row[
                "location_psgc_key__province_huc_name"
            ]
            or ""
        )

        if region:
            incident["regions"].add(region)

            if province:
                region_provinces[region].add(
                    province
                )

        if province:
            incident["provinces"].add(
                province
            )

        hazard_key = (
            row[
                "incident_key__hazard_key_id"
            ]
            or ""
        )

        if hazard_key:
            hazard_type = (
                row[
                    "incident_key__hazard_key__hazard_type"
                ]
                or ""
            )

            category = (
                row[
                    "incident_key__hazard_key__hazard_category"
                ]
                or ""
            )
            label = hazard_display_label(
                hazard_key,
                hazard_type,
                category,
            )

            hazard_labels[hazard_key] = label

    province_options = []

    for region in sorted(
        region_provinces,
        key=region_sort_key,
    ):
        for province in sorted(
            region_provinces[region],
            key=str.casefold,
        ):
            province_options.append(
                {
                    "value": province,
                    "label": province,
                    "parent": region,
                }
            )

    incident_options = []

    for incident in incidents.values():
        incident_options.append(
            {
                "value": incident["value"],
                "label": incident["label"],
                "hazard": incident["hazard"],
                "years": sorted(
                    incident["years"]
                ),
                "months": sorted(
                    incident["months"]
                ),
                "regions": sorted(
                    incident["regions"],
                    key=region_sort_key,
                ),
                "provinces": sorted(
                    incident["provinces"],
                    key=str.casefold,
                ),
            }
        )

    incident_options.sort(
        key=lambda option: (
            option["label"].casefold(),
            option["value"],
        )
    )

    # Incident names are reusable across years. Keep each incident key
    # selectable, but make repeated labels distinguishable with the year
    # instead of exposing internal sequence identifiers.
    incident_label_groups = defaultdict(list)
    for option in incident_options:
        incident_label_groups[
            option["label"].casefold()
        ].append(option)

    used_incident_labels = set()
    for option in incident_options:
        base_label = option["label"]
        label_key = base_label.casefold()
        if len(incident_label_groups[label_key]) > 1:
            incident_years = option["years"]
            year_label = "–".join(
                str(year)
                for year in incident_years
            )
            option["label"] = (
                f"{base_label} ({year_label})"
                if year_label
                else f"{base_label} ({option['value']})"
            )

        if option["label"].casefold() in used_incident_labels:
            option["label"] = (
                f"{option['label']} · {option['value']}"
            )
        used_incident_labels.add(
            option["label"].casefold()
        )

    hazards = [
        {
            "value": key,
            "label": label,
        }
        for key, label in hazard_labels.items()
    ]

    hazards.sort(key=hazard_sort_key)

    return {
        "years": sorted(years, reverse=True),
        "months": [
            {
                "value": month,
                "label": month_abbr[month],
                "years": sorted(
                    month_years.get(
                        month,
                        set(),
                    )
                ),
            }
            for month in range(1, 13)
        ],
        "month_years": month_years,
        "regions": sorted(
            region_provinces,
            key=region_sort_key,
        ),
        "provinces": province_options,
        "hazards": hazards,
        "incidents": incident_options,
    }


def _valid_integer(
    value,
    *,
    minimum,
    maximum,
):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None

    if minimum <= parsed <= maximum:
        return parsed

    return None


def _normalize_filters(
    request,
    *,
    options,
    catalog,
):
    warnings = []

    def request_values(plural_key, singular_key):
        return (
            request.GET.getlist(plural_key)
            or request.GET.getlist(singular_key)
        )

    def bounded_values(values, minimum, maximum):
        selected = []
        for value in values:
            parsed = _valid_integer(
                value,
                minimum=minimum,
                maximum=maximum,
            )
            if parsed is not None and parsed not in selected:
                selected.append(parsed)
        return sorted(selected)

    available_years = sorted(options["years"])
    requested_years = bounded_values(
        request_values("years", "year"),
        1900,
        2200,
    )
    selected_years = [
        year
        for year in requested_years
        if year in set(available_years)
    ]

    month_years = options["month_years"]
    requested_months = bounded_values(
        request_values("months", "month"),
        1,
        12,
    )
    selected_year_set = set(selected_years)
    available_months = {
        month
        for month, years in month_years.items()
        if not selected_year_set
        or selected_year_set.intersection(years)
    }
    selected_months = [
        month
        for month in requested_months
        if month in available_months
    ]

    if requested_months and not selected_months:
        warnings.append(
            "Month selection was cleared because "
            + (
                "it has no report data."
                if not selected_years
                else "it has no data in the selected period."
            )
        )

    year = (
        selected_years[0]
        if len(selected_years) == 1
        else None
    )
    month = (
        selected_months[0]
        if len(selected_months) == 1
        else None
    )

    if requested_years and not selected_years:
        warnings.append(
            "Year selection was cleared because "
            "it has no report data."
        )

    valid_regions = set(options["regions"])

    region = request.GET.get(
        "region",
        "",
    ).strip()

    if region not in valid_regions:
        region = ""

    province_to_region = {
        option["value"]: option["parent"]
        for option in options["provinces"]
    }

    province = request.GET.get(
        "province",
        "",
    ).strip()

    if province:
        province_region = (
            province_to_region.get(province)
        )

        if not province_region:
            province = ""
        elif region and region != province_region:
            province = ""
            warnings.append(
                "Province selection was cleared "
                "because it is outside the "
                "selected region."
            )
        elif not region:
            region = province_region

    valid_hazards = {
        option["value"]
        for option in options["hazards"]
    }

    selected_hazards = []
    for value in request.GET.getlist("hazard"):
        value = value.strip()
        if value in valid_hazards and value not in selected_hazards:
            selected_hazards.append(value)

    hazard = (
        selected_hazards[0]
        if len(selected_hazards) == 1
        else ""
    )

    group_map = {
        option["value"]: option
        for option in catalog["groups"]
    }

    group = request.GET.get(
        "commodity_group",
        "",
    ).strip()

    if group not in group_map:
        group = ""

    commodity_map = {
        option["value"]: option
        for option in catalog["commodities"]
    }

    commodity = request.GET.get(
        "commodity",
        "",
    ).strip()

    commodity_option = commodity_map.get(
        commodity
    )

    if commodity:
        if not commodity_option:
            commodity = ""
        elif (
            group
            and commodity_option["parent"] != group
        ):
            commodity = ""
            warnings.append(
                "Commodity selection was cleared "
                "because it is outside the "
                "selected commodity group."
            )
        elif not group:
            group = commodity_option["parent"]

    incident_map = {
        option["value"]: option
        for option in options["incidents"]
    }

    incident = request.GET.get(
        "incident",
        "",
    ).strip()

    incident_option = incident_map.get(
        incident
    )

    if incident_option:
        matches = (
            (
                not selected_years
                or set(selected_years).intersection(
                    incident_option["years"]
                )
            )
            and (
                not selected_months
                or set(selected_months).intersection(
                    incident_option["months"]
                )
            )
            and (
                not region
                or region
                in incident_option["regions"]
            )
            and (
                not province
                or province
                in incident_option["provinces"]
            )
            and (
                not selected_hazards
                or incident_option["hazard"]
                in selected_hazards
            )
        )

        if not matches:
            incident = ""
            warnings.append(
                "Incident selection was cleared "
                "because it is outside the "
                "selected period, location, or "
                "hazard scope."
            )
        elif not selected_hazards:
            selected_hazards = [incident_option["hazard"]]
            hazard = incident_option["hazard"]
    elif incident:
        incident = ""

    selected_sector = ""

    if commodity:
        selected_sector = (
            commodity_map[commodity]["sector"]
        )
    elif group:
        selected_sector = (
            group_map[group]["sector"]
        )

    compatible_metrics = [
        option
        for option in METRIC_OPTIONS
        if (
            not selected_sector
            or not option["sectors"]
            or selected_sector
            in option["sectors"]
        )
    ]

    compatible_keys = {
        option["key"]
        for option in compatible_metrics
    }

    requested_metrics = []

    for key in request.GET.getlist("metrics"):
        if (
            key in compatible_keys
            and key not in requested_metrics
        ):
            requested_metrics.append(key)

    if not requested_metrics:
        requested_metrics = [
            option["key"]
            for option in compatible_metrics
        ]

    layout = request.GET.get(
        "layout",
        "multi_sheet",
    )

    if layout not in {
        "multi_sheet",
        "consolidated",
    }:
        layout = "multi_sheet"

    # Consolidated output always contains the detailed report plus all
    # supported summary sheets. Keep this value for internal compatibility
    # with older bookmarked URLs and workbook metadata.
    consolidate_by = "detailed"

    return (
        {
            "year": year,
            "month": month,
            "years": selected_years,
            "months": selected_months,
            "region": region,
            "province": province,
            "hazard": hazard,
            "hazards": selected_hazards,
            "incident": incident,
            "commodity_group": group,
            "commodity": commodity,
            "metrics": requested_metrics,
            "layout": layout,
            "consolidate_by": (
                consolidate_by
            ),
            "sector": selected_sector,
        },
        warnings,
    )


def _apply_filters(
    queryset,
    *,
    selected,
    catalog,
):
    queryset = queryset.alias(
        report_analysis_date=(
            damage_report_analysis_date_expression()
        )
    )

    if selected["years"]:
        if _public_release_renderer():
            queryset = queryset.filter(
                report_analysis_date__year__in=selected[
                    "years"
                ]
            )
        else:
            queryset = queryset.filter(
                Q(
                    report_analysis_date__year__in=selected[
                        "years"
                    ]
                )
                | Q(
                    report_analysis_date__isnull=True,
                    import_batch_key__source_year__in=selected[
                        "years"
                    ],
                )
            )

    if selected["months"]:
        queryset = queryset.filter(
            report_analysis_date__month__in=selected[
                "months"
            ]
        )

    if selected["region"]:
        queryset = queryset.filter(
            location_psgc_key__region_name=selected[
                "region"
            ]
        )

    if selected["province"]:
        queryset = queryset.filter(
            location_psgc_key__province_huc_name=selected[
                "province"
            ]
        )

    if selected["hazards"]:
        queryset = queryset.filter(
            incident_key__hazard_key_id__in=selected[
                "hazards"
            ]
        )

    if selected["incident"]:
        queryset = queryset.filter(
            incident_key_id=selected[
                "incident"
            ]
        )

    if selected["commodity"]:
        queryset = queryset.filter(
            commodity_key_id=selected[
                "commodity"
            ]
        )
    elif selected["commodity_group"]:
        queryset = queryset.filter(
            commodity_key_id__in=catalog[
                "member_keys"
            ].get(
                selected["commodity_group"],
                set(),
            )
        )

    return queryset


def _label(options, value, fallback):
    for option in options:
        if option["value"] == value:
            return option["label"]

    return fallback


def _selection_option_label(options, values, fallback):
    selected_values = list(dict.fromkeys(values))
    if not selected_values or len(selected_values) == len(options):
        return fallback

    labels = [
        option["label"]
        for option in options
        if option["value"] in selected_values
    ]
    return ", ".join(labels) or fallback


def _selection_label(
    values,
    *,
    formatter,
    all_values,
    all_label,
):
    ordered = sorted(set(values))
    available = sorted(set(all_values))

    if not ordered or ordered == available:
        return all_label

    if len(ordered) == 1:
        return formatter(ordered[0])

    contiguous = all(
        current == previous + 1
        for previous, current in zip(
            ordered,
            ordered[1:],
        )
    )

    if contiguous:
        return (
            f"{formatter(ordered[0])}–"
            f"{formatter(ordered[-1])}"
        )

    return ", ".join(
        formatter(value)
        for value in ordered
    )


def build_report_generation_context(request):
    base_queryset = _base_queryset()
    catalog = _build_commodity_catalog()
    options = _build_scope_options(
        base_queryset
    )

    selected, warnings = _normalize_filters(
        request,
        options=options,
        catalog=catalog,
    )

    queryset = _apply_filters(
        base_queryset,
        selected=selected,
        catalog=catalog,
    )

    metric_map = {
        option["key"]: option
        for option in METRIC_OPTIONS
    }

    selected_metrics = [
        metric_map[key]
        for key in selected["metrics"]
    ]

    totals = queryset.aggregate(
        **{
            option["key"]: Sum(
                option["field"]
            )
            for option in selected_metrics
        }
    )

    metric_totals = [
        {
            **option,
            "value": (
                totals.get(option["key"]) or 0
            ),
        }
        for option in selected_metrics
    ]

    commodity_groups = []

    for group in catalog["groups"]:
        if (
            selected["commodity_group"]
            and group["value"]
            != selected["commodity_group"]
        ):
            continue

        commodities = [
            commodity
            for commodity
            in catalog["commodities"]
            if commodity["parent"]
            == group["value"]
        ]

        if selected["commodity"]:
            commodities = [
                commodity
                for commodity in commodities
                if commodity["value"]
                == selected["commodity"]
            ]

        metric_count = sum(
            1
            for metric in selected_metrics
            if (
                not metric["sectors"]
                or group["sector"]
                in metric["sectors"]
            )
        )

        commodity_groups.append(
            {
                **group,
                "commodities": commodities,
                "column_count": (
                    len(commodities)
                    * metric_count
                ),
            }
        )

    identity_column_count = (
        {
            "detailed": 6,
            "year": 1,
            "region": 1,
            "province": 2,
            "incident": 4,
        }.get(
            selected["consolidate_by"],
            6,
        )
        if selected["layout"]
        == "consolidated"
        else 6
    )

    column_count = (
        identity_column_count
        + sum(
            group["column_count"]
            for group in commodity_groups
        )
    )

    selected_labels = {
        "year": _selection_label(
            selected["years"],
            formatter=str,
            all_values=options["years"],
            all_label="All Years",
        ),
        "month": _selection_label(
            selected["months"],
            formatter=lambda value: month_abbr[value],
            all_values=options["month_years"],
            all_label="All Months",
        ),
        "region": (
            selected["region"]
            or "All Regions"
        ),
        "province": (
            selected["province"]
            or "All Provinces"
        ),
        "hazard": _selection_option_label(
            options["hazards"],
            selected["hazards"],
            "All Hazards",
        ),
        "incident": _label(
            options["incidents"],
            selected["incident"],
            "All Incidents",
        ),
        "commodity_group": _label(
            catalog["groups"],
            selected["commodity_group"],
            "All Commodity Groups",
        ),
        "commodity": _label(
            catalog["commodities"],
            selected["commodity"],
            "All Subgroups",
        ),
        "layout": (
            "Multi-sheet by commodity group"
            if selected["layout"]
            == "multi_sheet"
            else "Consolidated report with summary sheets"
        ),
        "consolidate_by": (
            "All summary sheets"
            if selected["layout"]
            == "consolidated"
            else "Not applicable"
        ),
    }

    return {
        "filter_options": options,
        "commodity_group_options": (
            catalog["groups"]
        ),
        "commodity_options": (
            catalog["commodities"]
        ),
        "metric_options": METRIC_OPTIONS,
        "consolidation_options": (
            CONSOLIDATION_OPTIONS
        ),
        "selected_filters": selected,
        "selected_labels": selected_labels,
        "selection_warnings": warnings,
        "column_groups": commodity_groups,
        "preview": {
            "row_count": queryset.count(),
            "incident_count": (
                queryset.values(
                    "incident_key_id"
                ).distinct().count()
            ),
            "region_count": (
                queryset.exclude(
                    location_psgc_key__region_name__isnull=True
                ).exclude(
                    location_psgc_key__region_name=""
                ).values(
                    "location_psgc_key__region_name"
                ).distinct().count()
            ),
            "province_count": (
                queryset.exclude(
                    location_psgc_key__province_huc_name__isnull=True
                ).exclude(
                    location_psgc_key__province_huc_name=""
                ).values(
                    "location_psgc_key__province_huc_name"
                ).distinct().count()
            ),
            "column_count": column_count,
            "sheet_count": (
                len(commodity_groups) + 2
                if selected["layout"]
                == "multi_sheet"
                else 2
            ),
            "estimated_file_size_kb": max(
                12,
                int(
                    (
                        queryset.count()
                        * max(column_count, 1)
                        * 6
                    )
                    / 1024
                    + (
                        (
                            len(commodity_groups) + 2
                            if selected["layout"]
                            == "multi_sheet"
                            else 2
                        )
                        * 8
                    )
                ),
            ),
            "metric_totals": metric_totals,
        },
    }
