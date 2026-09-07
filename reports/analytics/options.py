from __future__ import annotations

from typing import Any

from django.db.models import Q

HAZARD_DISPLAY_LABEL_OVERRIDES = {
    "HZD_GEOLOGIC_OTHERS": "Geologic - Others",
}

HAZARD_PRIORITY_KEYS = (
    "HZD_TROPICAL_CYCLONE",
    "HZD_OTHER_WEATHER_SYSTEM",
    "HZD_EL_NINO",
    "HZD_DROUGHT",
    "HZD_VOLCANIC_ACTIVITY",
    "HZD_EARTHQUAKE",
    "HZD_PLANT_PEST_DISEASE",
    "HZD_ANIMAL_PEST_DISEASE",
)

HAZARD_PRIORITY_INDEX = {
    hazard_key: index for index, hazard_key in enumerate(HAZARD_PRIORITY_KEYS)
}

# Kept as an empty compatibility export; generic terminal catch-all hazards
# are no longer part of the approved reference vocabulary.
HAZARD_TERMINAL_INDEX: dict[str, int] = {}

def commodity_group_from_row(row: dict[str, Any]) -> str:
    main_sector = row.get("commodity_key__main_sector") or ""
    level_2 = row.get("commodity_key__level_2_group") or ""
    level_3 = row.get("commodity_key__level_3_group") or ""
    commodity_key = row.get("commodity_key_id") or ""

    if main_sector.strip().lower() == "crops":
        return level_2 or level_3 or main_sector or commodity_key or "Unspecified Commodity"

    return main_sector or level_2 or level_3 or commodity_key or "Unspecified Commodity"


def commodity_group_filter(group: str) -> Q:
    return (
        Q(commodity_key__main_sector__iexact="Crops", commodity_key__level_2_group=group)
        | ~Q(commodity_key__main_sector__iexact="Crops")
        & Q(commodity_key__main_sector=group)
    )


def build_commodity_group_options(active_reports: Any) -> list[dict[str, str]]:
    rows = (
        active_reports.values(
            "commodity_key_id",
            "commodity_key__main_sector",
            "commodity_key__level_2_group",
            "commodity_key__level_3_group",
        )
        .distinct()
        .order_by(
            "commodity_key__main_sector",
            "commodity_key__level_2_group",
            "commodity_key__level_3_group",
        )
    )

    labels = sorted({commodity_group_from_row(row) for row in rows})

    return [{"value": label, "label": label} for label in labels if label]


def build_commodity_subgroup_options(active_reports: Any, commodity_group: str) -> list[dict[str, str]]:
    queryset = active_reports

    if commodity_group:
        queryset = queryset.filter(commodity_group_filter(commodity_group))

    subgroups = (
        queryset.exclude(commodity_key__level_3_group__isnull=True)
        .exclude(commodity_key__level_3_group="")
        .values_list("commodity_key__level_3_group", flat=True)
        .distinct()
        .order_by("commodity_key__level_3_group")
    )

    return [{"value": subgroup, "label": subgroup} for subgroup in subgroups if subgroup]


def build_commodity_subgroup_cascade_options(active_reports: Any) -> list[dict[str, str]]:
    rows = (
        active_reports.exclude(commodity_key__level_3_group__isnull=True)
        .exclude(commodity_key__level_3_group="")
        .values(
            "commodity_key_id",
            "commodity_key__main_sector",
            "commodity_key__level_2_group",
            "commodity_key__level_3_group",
        )
        .distinct()
        .order_by("commodity_key__level_3_group")
    )

    options = {}
    for row in rows:
        subgroup = row["commodity_key__level_3_group"]
        group = commodity_group_from_row(row)
        if subgroup and group:
            options[(group, subgroup)] = {
                "parent": group,
                "value": subgroup,
                "label": subgroup,
            }

    return sorted(options.values(), key=lambda option: (option["parent"], option["label"]))


def hazard_display_label(hazard_key: str, hazard_type: str, hazard_category: str = "") -> str:
    return (
        HAZARD_DISPLAY_LABEL_OVERRIDES.get(hazard_key)
        or hazard_type
        or hazard_category
        or hazard_key
        or "Unclassified"
    )


def hazard_sort_key(hazard: Any) -> tuple[int, int, str, str]:
    if isinstance(hazard, dict):
        hazard_key = hazard.get(
            "hazard_key",
            hazard.get("value", ""),
        )
        display_label = hazard.get(
            "display_label",
            hazard.get("label", ""),
        )
        hazard_type = hazard.get(
            "hazard_type",
            "",
        )
    else:
        hazard_key = hazard.hazard_key
        display_label = getattr(
            hazard,
            "display_label",
            "",
        )
        hazard_type = getattr(
            hazard,
            "hazard_type",
            "",
        )

    if hazard_key in HAZARD_PRIORITY_INDEX:
        return (
            0,
            HAZARD_PRIORITY_INDEX[hazard_key],
            "",
            hazard_key,
        )

    return (
        1,
        0,
        (
            display_label
            or hazard_type
            or hazard_key
        ).lower(),
        hazard_key,
    )


# Backwards compatibility aliases
_commodity_group_from_row = commodity_group_from_row
_commodity_group_filter = commodity_group_filter
_build_commodity_group_options = build_commodity_group_options
_build_commodity_subgroup_options = build_commodity_subgroup_options
_build_commodity_subgroup_cascade_options = build_commodity_subgroup_cascade_options
_hazard_display_label = hazard_display_label
_hazard_sort_key = hazard_sort_key
_HAZARD_DISPLAY_LABEL_OVERRIDES = HAZARD_DISPLAY_LABEL_OVERRIDES
_HAZARD_PRIORITY_KEYS = HAZARD_PRIORITY_KEYS
_HAZARD_PRIORITY_INDEX = HAZARD_PRIORITY_INDEX
_HAZARD_TERMINAL_INDEX = HAZARD_TERMINAL_INDEX
