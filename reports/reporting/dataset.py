"""Dataset building and data preparation for Report Generation."""

from __future__ import annotations

from calendar import month_name
from collections import defaultdict
from typing import Any

from django.conf import settings

from ..incident_attribution import incident_analysis_date
from ..location_ordering import region_sort_key
from .consolidation import _consolidate_report_rows
from .options import (
    METRIC_OPTIONS,
    _apply_filters,
    _base_queryset,
    _build_commodity_catalog,
    _build_scope_options,
    _normalize_filters,
)


def _reported_sum(values):
    reported = [
        value
        for value in values
        if value is not None
    ]

    if not reported:
        return None

    total = reported[0]

    for value in reported[1:]:
        total += value

    return total


def _rows_for_group_sheet(
    dataset,
    group_value,
):
    if group_value is None:
        return dataset["rows"]

    return [
        row_data
        for row_data in dataset["rows"]
        if (
            row_data["group_values"]
            .get(
                group_value,
                {},
            )
            .get("value_loss")
            is not None
        )
    ]


def _group_metric_options(
    group: dict[str, Any],
    selected_metrics: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        metric
        for metric in selected_metrics
        if (
            not metric["sectors"]
            or group["sector"]
            in metric["sectors"]
        )
    ]


def _overall_metric_options(
    selected_metrics: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        metric
        for metric in selected_metrics
        if metric["key"] != "livestock_heads"
    ]


def _record_year(record: dict[str, Any]) -> str:
    incident_date = _record_analysis_date(record)

    if incident_date:
        return str(incident_date.year)

    return (
        str(
            record.get(
                "import_batch_key__source_year"
            )
        )
        if record.get(
            "import_batch_key__source_year"
        )
        else ""
    )


def _public_release_renderer() -> bool:
    return bool(
        getattr(settings, "PUBLIC_RELEASE_RENDERER", False)
    )


def _record_analysis_date(record: dict[str, Any]):
    return incident_analysis_date(
        record.get(
            "incident_key__incident_start_date"
        ),
        record.get(
            "incident_key__incident_end_date"
        ),
        record.get(
            "incident_key__hazard_key_id"
        ),
    )


def _record_month_number(record: dict[str, Any]) -> int:
    incident_date = _record_analysis_date(record)

    if incident_date:
        return incident_date.month

    return 0


def _record_month_label(record: dict[str, Any]) -> str:
    incident_date = _record_analysis_date(record)

    if incident_date:
        label = month_name[incident_date.month]
        if (
            record.get(
                "incident_key__hazard_key_id"
            )
            == "HZD_EL_NINO"
        ):
            return f"{label} {incident_date.year}"
        return label

    return ""


def _hazard_label(record: dict[str, Any]) -> str:
    category = (
        record[
            "incident_key__hazard_key__hazard_category"
        ]
        or ""
    )
    hazard_type = (
        record[
            "incident_key__hazard_key__hazard_type"
        ]
        or ""
    )

    if category and hazard_type:
        return f"{category} – {hazard_type}"

    return category or hazard_type


def _identity_sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
    identity = row["identity"]

    year = identity["year"]

    try:
        numeric_year = int(year)
    except (TypeError, ValueError):
        numeric_year = 0

    return (
        -numeric_year,
        # Keep the report chronological within each recent year. Geographic
        # fields remain deterministic tie-breakers after incident ordering.
        row.get("month_number", 0),
        identity[
            "hazard_category"
        ].casefold(),
        identity["incident"].casefold(),
        str(identity.get("incident_key", "")),
        region_sort_key(
            identity["region"]
        ),
        identity["province"].casefold(),
    )


def _build_selected_groups(
    *,
    catalog: dict[str, Any],
    selected: dict[str, Any],
) -> list[dict[str, Any]]:
    groups = []

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

        if not commodities:
            continue

        groups.append(
            {
                **group,
                "commodities": commodities,
            }
        )

    return groups


def build_report_dataset(request) -> dict[str, Any]:
    catalog = _build_commodity_catalog()
    options = _build_scope_options(
        _base_queryset()
    )

    selected, warnings = _normalize_filters(
        request,
        options=options,
        catalog=catalog,
    )

    queryset = _apply_filters(
        _base_queryset(),
        selected=selected,
        catalog=catalog,
    )

    metric_map = {
        metric["key"]: metric
        for metric in METRIC_OPTIONS
    }

    selected_metrics = [
        metric_map[key]
        for key in selected["metrics"]
    ]

    groups = _build_selected_groups(
        catalog=catalog,
        selected=selected,
    )

    aggregation_metrics = list(
        selected_metrics
    )

    if all(
        metric["key"] != "value_loss"
        for metric in aggregation_metrics
    ):
        aggregation_metrics.append(
            metric_map["value_loss"]
        )

    metric_fields = [
        metric["field"]
        for metric in aggregation_metrics
    ]

    fields = [
        "damage_report_key",
        "incident_key_id",
        "incident_key__incident_name",
        "incident_key__incident_start_date",
        "incident_key__incident_end_date",
        "incident_key__hazard_key_id",
        "incident_key__hazard_key__hazard_category",
        "incident_key__hazard_key__hazard_type",
        "location_psgc_key_id",
        "location_psgc_key__region_name",
        "location_psgc_key__province_huc_name",
        "commodity_key_id",
        "commodity_key__main_sector",
        "commodity_key__level_2_group",
        "commodity_key__level_3_group",
        *metric_fields,
    ]
    if not _public_release_renderer():
        fields.insert(-len(metric_fields), "import_batch_key__source_year")
    records = list(queryset.values(*fields))

    records.sort(
        key=lambda record: (
            -int(_record_year(record) or 0),
            region_sort_key(
                record[
                    "location_psgc_key__region_name"
                ]
                or ""
            ),
            (
                record[
                    "location_psgc_key__province_huc_name"
                ]
                or ""
            ).casefold(),
            _record_month_number(record),
            (
                record[
                    "incident_key__hazard_key__hazard_category"
                ]
                or ""
            ).casefold(),
            (
                record[
                    "incident_key__incident_name"
                ]
                or ""
            ).casefold(),
            record["commodity_key_id"],
            record["damage_report_key"],
        )
    )

    row_map: dict[tuple[Any, ...], dict[str, Any]] = {}

    for record in records:
        incident_label = (
            record[
                "incident_key__incident_name"
            ]
            or record["incident_key_id"]
            or ""
        )

        identity_key = (
            _record_year(record),
            (
                record[
                    "location_psgc_key__region_name"
                ]
                or ""
            ),
            (
                record[
                    "location_psgc_key__province_huc_name"
                ]
                or ""
            ),
            (
                record[
                    "incident_key__hazard_key__hazard_category"
                ]
                or ""
            ),
            (
                record["incident_key_id"]
                or incident_label
            ),
            incident_label,
            _record_month_number(record),
        )

        row = row_map.setdefault(
            identity_key,
            {
                "identity": {
                    "year": identity_key[0],
                    "region": identity_key[1],
                    "province": identity_key[2],
                    "hazard_category": (
                        identity_key[3]
                    ),
                    "incident_key": (
                        identity_key[4]
                    ),
                    "incident": identity_key[5],
                    "month": (
                        _record_month_label(record)
                    ),
                },
                "month_number": identity_key[6],
                "raw_values": defaultdict(
                    lambda: defaultdict(list)
                ),
            },
        )

        commodity_key = record[
            "commodity_key_id"
        ]

        for metric in aggregation_metrics:
            value = record[metric["field"]]

            if value is not None:
                row["raw_values"][
                    commodity_key
                ][metric["key"]].append(
                    value
                )

    rows = []

    for row in row_map.values():
        commodity_values: dict[str, dict[str, Any]] = {}

        for (
            commodity_key,
            metric_values,
        ) in row["raw_values"].items():
            commodity_values[
                commodity_key
            ] = {
                metric_key: _reported_sum(
                    values
                )
                for metric_key, values
                in metric_values.items()
            }

        group_values: dict[str, dict[str, Any]] = {}

        for group in groups:
            group_metric_values = {}

            parent_options = [
                commodity
                for commodity
                in group["commodities"]
                if commodity["is_parent"]
            ]

            parent_key = (
                parent_options[0]["value"]
                if parent_options
                else None
            )

            child_keys = [
                commodity["value"]
                for commodity
                in group["commodities"]
                if commodity["value"]
                != parent_key
            ]

            for metric in _group_metric_options(
                group,
                aggregation_metrics,
            ):
                metric_key = metric["key"]

                parent_value = None

                if parent_key:
                    parent_value = (
                        commodity_values
                        .get(parent_key, {})
                        .get(metric_key)
                    )

                if parent_value is not None:
                    canonical_value = (
                        parent_value
                    )
                else:
                    child_values = [
                        commodity_values
                        .get(child_key, {})
                        .get(metric_key)
                        for child_key
                        in child_keys
                    ]

                    canonical_value = (
                        _reported_sum(
                            child_values
                        )
                    )

                group_metric_values[
                    metric_key
                ] = canonical_value

            group_values[
                group["value"]
            ] = group_metric_values

        overall_values = {}

        for metric in selected_metrics:
            metric_key = metric["key"]

            applicable_values = [
                group_values[
                    group["value"]
                ].get(metric_key)
                for group in groups
                if (
                    not metric["sectors"]
                    or group["sector"]
                    in metric["sectors"]
                )
            ]

            overall_values[
                metric_key
            ] = _reported_sum(
                applicable_values
            )

        rows.append(
            {
                "identity": row["identity"],
                "month_number": (
                    row["month_number"]
                ),
                "commodity_values": (
                    commodity_values
                ),
                "group_values": (
                    group_values
                ),
                "overall": overall_values,
            }
        )

    rows.sort(key=_identity_sort_key)

    present_commodity_keys = {
        record["commodity_key_id"]
        for record in records
    }

    if selected["commodity_group"]:
        sheet_groups = groups
    else:
        sheet_groups = [
            group
            for group in groups
            if any(
                commodity["value"]
                in present_commodity_keys
                for commodity
                in group["commodities"]
            )
        ]

    commodity_label_by_key = {
        commodity["value"]: (
            commodity["label"]
        )
        for commodity
        in catalog["commodities"]
    }

    commodity_group_by_key = {
        commodity["value"]: (
            commodity["parent"]
        )
        for commodity
        in catalog["commodities"]
    }

    from django.utils import timezone

    from .options import (
        _label,
        _selection_label,
        _selection_option_label,
    )
    from .workbook import _generated_by

    generated_at = timezone.localtime()
    generated_by = _generated_by(request)

    labels = {
        "year": _selection_label(
            selected["years"],
            formatter=str,
            all_values=options["years"],
            all_label="All Years",
        ),
        "month": _selection_label(
            selected["months"],
            formatter=lambda value: month_name[value],
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

    dataset = {
        "selected": selected,
        "labels": labels,
        "selected_metrics": selected_metrics,
        "column_groups": groups,
        "sheet_groups": sheet_groups,
        "all_groups": groups,
        "rows": rows,
        "records": records,
        "row_count": len(records),
        "commodity_label_by_key": (
            commodity_label_by_key
        ),
        "commodity_group_by_key": (
            commodity_group_by_key
        ),
        "generated_at": generated_at,
        "generated_by": generated_by,
        "warnings": warnings,
        "filter_options": options,
        "catalog": catalog,
    }

    dataset["rows"] = _consolidate_report_rows(
        dataset
    )

    return dataset
