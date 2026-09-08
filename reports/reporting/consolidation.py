"""Row consolidation services for Report Generation."""

from __future__ import annotations

from typing import Any

from ..location_ordering import region_sort_key
from .formatting import (
    CONSOLIDATION_IDENTITY_FIELDS,
    IDENTITY_FIELDS,
)


def _identity_fields_for_consolidation(
    consolidate_by: str,
):
    return CONSOLIDATION_IDENTITY_FIELDS.get(
        consolidate_by,
        IDENTITY_FIELDS,
    )


def _merge_reported_values(
    target: dict[str, Any],
    source: dict[str, Any],
):
    for metric_key, value in source.items():
        if value is None:
            continue

        current = target.get(metric_key)

        target[metric_key] = (
            value
            if current is None
            else current + value
        )


def _merge_nested_reported_values(
    target: dict[str, Any],
    source: dict[str, Any],
):
    for outer_key, metric_values in (
        source.items()
    ):
        target_values = target.setdefault(
            outer_key,
            {},
        )

        _merge_reported_values(
            target_values,
            metric_values,
        )


def _consolidation_key(
    row_data: dict[str, Any],
    consolidate_by: str,
) -> tuple[Any, ...]:
    identity = row_data["identity"]

    if consolidate_by == "region":
        return (
            identity["region"],
        )

    if consolidate_by == "year":
        return (
            identity.get("year", ""),
        )

    if consolidate_by == "province":
        return (
            identity["region"],
            identity["province"],
        )

    if consolidate_by == "incident":
        return (
            identity.get("incident_key")
            or identity["incident"],
        )

    raise ValueError(
        "Unsupported consolidation level: "
        f"{consolidate_by}"
    )


def _consolidated_identity(
    row_data: dict[str, Any],
    consolidate_by: str,
) -> dict[str, Any]:
    source = row_data["identity"]

    identity = {
        "year": "",
        "region": "",
        "province": "",
        "hazard_category": "",
        "incident_key": "",
        "incident": "",
        "month": "",
    }

    if consolidate_by == "region":
        identity["region"] = source["region"]

    elif consolidate_by == "year":
        identity["year"] = source.get(
            "year",
            "",
        )

    elif consolidate_by == "province":
        identity["region"] = source["region"]
        identity["province"] = source[
            "province"
        ]

    elif consolidate_by == "incident":
        for key in (
            "year",
            "hazard_category",
            "incident_key",
            "incident",
            "month",
        ):
            identity[key] = source.get(
                key,
                "",
            )

    else:
        raise ValueError(
            "Unsupported consolidation level: "
            f"{consolidate_by}"
        )

    return identity


def _consolidated_sort_key(
    row_data: dict[str, Any],
    consolidate_by: str,
) -> tuple[Any, ...]:
    identity = row_data["identity"]

    if consolidate_by == "region":
        return (
            region_sort_key(
                identity["region"]
            ),
        )

    if consolidate_by == "province":
        return (
            region_sort_key(
                identity["region"]
            ),
            identity["province"].casefold(),
        )

    try:
        year_key = -int(
            identity["year"] or 0
        )
    except (TypeError, ValueError):
        year_key = 0

    return (
        year_key,
        row_data.get("month_number", 0),
        identity["incident"].casefold(),
        str(
            identity.get(
                "incident_key",
                "",
            )
        ),
    )


def _consolidate_report_rows(
    dataset: dict[str, Any],
    *,
    consolidate_by: str | None = None,
) -> list[dict[str, Any]]:
    if consolidate_by is None:
        consolidate_by = dataset[
            "selected"
        ].get(
            "consolidate_by",
            "detailed",
        )

    if consolidate_by == "detailed":
        return list(dataset["rows"])

    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}

    for row_data in dataset["rows"]:
        grouping_key = _consolidation_key(
            row_data,
            consolidate_by,
        )

        summary = grouped.setdefault(
            grouping_key,
            {
                "identity": (
                    _consolidated_identity(
                        row_data,
                        consolidate_by,
                    )
                ),
                "month_number": (
                    row_data.get(
                        "month_number",
                        0,
                    )
                    if consolidate_by
                    == "incident"
                    else 0
                ),
                "commodity_values": {},
                "group_values": {},
                "overall": {},
            },
        )

        _merge_nested_reported_values(
            summary["commodity_values"],
            row_data["commodity_values"],
        )

        _merge_nested_reported_values(
            summary["group_values"],
            row_data["group_values"],
        )

        _merge_reported_values(
            summary["overall"],
            row_data["overall"],
        )

    selected_metric_keys = {
        metric["key"]
        for metric in dataset[
            "selected_metrics"
        ]
    }

    rows = [
        row_data
        for row_data in grouped.values()
        if any(
            row_data["overall"].get(
                metric_key
            )
            is not None
            for metric_key
            in selected_metric_keys
        )
    ]

    rows.sort(
        key=lambda row_data: (
            _consolidated_sort_key(
                row_data,
                consolidate_by,
            )
        )
    )

    return rows
