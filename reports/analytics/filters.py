from __future__ import annotations

from typing import Any

from reports.analytics.formatting import short_region_label
from reports.analytics.periods import LEGACY_PERIOD_KEYS


def build_filter_context(filters: dict[str, Any], available_years: list[int]) -> dict[str, Any]:
    """Build human-readable filter context strings for chart sub-labels."""
    region = filters.get("region") or ""
    province = filters.get("province") or ""
    commodity_group = filters.get("commodity_group") or ""
    commodity_subgroup = filters.get("commodity_subgroup") or ""
    hazard = filters.get("hazard") or []
    if isinstance(hazard, str):
        hazard = [hazard] if hazard else []
    hazard_label = filters.get("hazard_label") or "All Hazards"
    if filters.get("period_mode") == "latest_year" and filters.get("effective_date_from"):
        time_label = str(filters["effective_date_from"].year)
    else:
        time_label = filters.get("period_label") or "All Years"

    # --- Location label & mode ---
    if province:
        location_label = province
        location_mode = "province"
    elif region:
        location_label = short_region_label(region)
        location_mode = "region"
    else:
        location_label = "National"
        location_mode = "national"

    # --- Commodity label & mode ---
    if commodity_subgroup:
        commodity_label = f"{commodity_subgroup} ({commodity_group})" if commodity_group else commodity_subgroup
        commodity_mode = "subgroup"
    elif commodity_group:
        commodity_label = commodity_group
        commodity_mode = "group"
    else:
        commodity_label = "All Commodities"
        commodity_mode = "all"

    has_hazard = bool(hazard) and hazard_label != "All Hazards"

    return {
        "time_label": time_label,
        "location_label": location_label,
        "location_mode": location_mode,
        "commodity_label": commodity_label,
        "commodity_mode": commodity_mode,
        "hazard_label": hazard_label,
        "hazard_mode": "selected" if has_hazard else "all",
        "has_region": bool(region),
        "has_province": bool(province),
        "has_commodity_group": bool(commodity_group),
        "has_commodity_subgroup": bool(commodity_subgroup),
        "has_hazard": has_hazard,
    }


def url_with_query(
    request: Any,
    remove: list[str] | None = None,
    updates: dict[str, Any] | None = None,
) -> str:
    params = request.GET.copy()

    for key in remove or []:
        params.pop(key, None)

    for key, value in (updates or {}).items():
        if value in (None, ""):
            params.pop(key, None)
        else:
            params[key] = str(value)

    query_string = params.urlencode()
    if query_string:
        return f"{request.path}?{query_string}"

    return request.path


def preserved_url(request: Any, path: str) -> str:
    query_string = request.GET.urlencode()
    return f"{path}?{query_string}" if query_string else path


def build_active_filter_chips(
    request: Any,
    filters: dict[str, Any],
    metric_config: dict[str, Any] | None = None,
    metric_label: str = "Chart metric",
    *,
    include_defaults: bool = False,
    include_period: bool = True,
    include_period_default: bool = False,
    default_labels: dict[str, str] | None = None,
) -> list[dict[str, str]]:
    chips = []
    defaults = default_labels or {}

    def add_chip(label: str, clear_url: str = "") -> None:
        if not label:
            return
        chips.append({"label": str(label), "clear_url": clear_url})

    if (
        include_period
        and filters.get("period_mode") != "latest_year"
    ):
        add_chip(
            filters["period_label"],
            url_with_query(
                request,
                remove=list(LEGACY_PERIOD_KEYS),
                updates={"period_mode": "latest_year"},
            ),
        )
    elif (
        include_defaults
        and include_period
        and include_period_default
    ):
        add_chip(filters.get("period_label", ""))

    if filters["province"]:
        add_chip(
            filters["province"],
            url_with_query(request, remove=["province"]),
        )
    elif filters["region"]:
        add_chip(
            filters["region"],
            url_with_query(request, remove=["region", "province"]),
        )
    elif include_defaults:
        add_chip(defaults.get("region", "All Regions"))

    if filters["commodity_subgroup"]:
        add_chip(
            filters["commodity_subgroup"],
            url_with_query(request, remove=["commodity_subgroup"]),
        )
    elif filters["commodity_group"]:
        add_chip(
            filters["commodity_group"],
            url_with_query(
                request,
                remove=["commodity_group", "commodity_subgroup"],
            ),
        )
    elif include_defaults:
        add_chip(defaults.get("commodity_group", "All Commodity"))

    if metric_config and filters.get("metric") and filters["metric"] != "value":
        add_chip(
            metric_config["label"],
            url_with_query(request, remove=["metric"]),
        )

    return chips


# Backwards compatibility aliases
_build_filter_context = build_filter_context
_url_with_query = url_with_query
_preserved_url = preserved_url
_build_active_filter_chips = build_active_filter_chips
