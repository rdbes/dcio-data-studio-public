"""HTML workbook-preview services for Report Generation."""

from __future__ import annotations

from typing import Any

from .consolidation import (
    _consolidate_report_rows,
    _identity_fields_for_consolidation,
)
from .dataset import (
    _group_metric_options,
    _overall_metric_options,
    _rows_for_group_sheet,
    build_report_dataset,
)
from .formatting import (
    CONSOLIDATED_SHEET_NAMES,
    IDENTITY_FIELDS,
    REPORT_PREVIEW_ROW_LIMIT,
    SAMPLE_HEADER_PALETTE,
    _has_redundant_single_commodity_header,
    _metric_header_label,
    _safe_sheet_name,
)


def _preview_display_value(
    value,
    metric=None,
) -> str:
    if value is None:
        return ""

    if metric is None:
        return str(value)

    try:
        if metric.get("is_count"):
            return format(
                value,
                ",.0f",
            )

        return format(
            value,
            ",.2f",
        )
    except (
        TypeError,
        ValueError,
    ):
        return str(value)


def _preview_header_colors(
    key: str,
    level: str,
) -> dict[str, str]:
    """Return the downloadable workbook colors for one header level."""

    palette = SAMPLE_HEADER_PALETTE.get(
        key,
        SAMPLE_HEADER_PALETTE["DEFAULT"],
    )

    if level == "identity":
        fill = "#CFE2F3"
        font = "#000000"
    elif level in {"group", "commodity"}:
        fill = palette["fill"]
        font = palette["font"]
    elif level == "metric":
        fill = "#FFFFFF"
        font = palette["metric_font"]
    else:
        raise ValueError(
            "Unsupported preview header level: "
            f"{level}"
        )

    return {
        "header_fill": fill,
        "header_font": font,
        "header_border": "#000000",
    }


def _preview_header_cell(
    label: str,
    *,
    key: str,
    level: str,
    rowspan: int = 1,
    colspan: int = 1,
) -> dict[str, Any]:
    return {
        "label": label,
        "level": level,
        "rowspan": rowspan,
        "colspan": colspan,
        **_preview_header_colors(key, level),
    }


def _preview_header_rows(
    *,
    identity_fields,
    total_label,
    total_metrics,
    total_group_value=None,
    groups=(),
    selected_metrics=(),
) -> list[list[dict[str, Any]]]:
    """Build the same four-tier header hierarchy as the XLSX worksheet."""

    header_rows = [[], [], [], []]

    for _, header in identity_fields:
        header_rows[0].append(
            _preview_header_cell(
                header,
                key="IDENTITY",
                level="identity",
                rowspan=4,
            )
        )

    if total_metrics:
        total_palette_key = (
            total_group_value
            if total_group_value
            else "TOTAL"
        )
        header_rows[0].append(
            _preview_header_cell(
                total_label,
                key=total_palette_key,
                level="group",
                rowspan=3,
                colspan=len(total_metrics),
            )
        )
        header_rows[3].extend(
            _preview_header_cell(
                _metric_header_label(metric),
                key=total_palette_key,
                level="metric",
            )
            for metric in total_metrics
        )

    for group in groups:
        group_metrics = _group_metric_options(
            group,
            selected_metrics,
        )
        commodities = group.get("commodities", ())

        if not group_metrics or not commodities:
            continue

        if _has_redundant_single_commodity_header(group):
            commodity = commodities[0]
            header_rows[0].append(
                _preview_header_cell(
                    commodity["label"],
                    key=group["value"],
                    level="group",
                    rowspan=3,
                    colspan=len(group_metrics),
                )
            )
        else:
            header_rows[0].append(
                _preview_header_cell(
                    group["label"],
                    key=group["value"],
                    level="group",
                    colspan=(
                        len(commodities)
                        * len(group_metrics)
                    ),
                )
            )

            for commodity in commodities:
                header_rows[1].append(
                    _preview_header_cell(
                        commodity["label"],
                        key=commodity["value"],
                        level="commodity",
                        rowspan=2,
                        colspan=len(group_metrics),
                    )
                )

        for commodity in commodities:
            header_rows[3].extend(
                _preview_header_cell(
                    _metric_header_label(metric),
                    key=commodity["value"],
                    level="metric",
                )
                for metric in group_metrics
            )

    return header_rows


def _preview_columns(
    *,
    identity_fields,
    total_label,
    total_metrics,
    total_group_value=None,
    groups=(),
    selected_metrics=(),
) -> list[dict[str, Any]]:
    columns = [
        {
            "group_label": "",
            "label": header,
            "source": "identity",
            "field": field_name,
            "metric": None,
        }
        for field_name, header
        in identity_fields
    ]

    total_source = (
        "group"
        if total_group_value
        else "overall"
    )

    for metric in total_metrics:
        columns.append(
            {
                "group_label": total_label,
                "label": (
                    _metric_header_label(
                        metric
                    )
                ),
                "source": total_source,
                "container_key": (
                    total_group_value
                ),
                "metric_key": metric["key"],
                "metric": metric,
            }
        )

    for group in groups:
        group_metrics = (
            _group_metric_options(
                group,
                selected_metrics,
            )
        )

        for commodity in group[
            "commodities"
        ]:
            for metric in group_metrics:
                columns.append(
                    {
                        "group_label": (
                            commodity["label"]
                        ),
                        "label": (
                            _metric_header_label(
                                metric
                            )
                        ),
                        "source": "commodity",
                        "container_key": (
                            commodity["value"]
                        ),
                        "metric_key": (
                            metric["key"]
                        ),
                        "metric": metric,
                    }
                )

    return columns


def _preview_cell(
    row_data,
    column,
) -> dict[str, Any]:
    source = column["source"]

    if source == "identity":
        value = row_data[
            "identity"
        ].get(
            column["field"],
            "",
        )

    elif source == "overall":
        value = row_data[
            "overall"
        ].get(
            column["metric_key"]
        )

    elif source == "group":
        value = (
            row_data["group_values"]
            .get(
                column["container_key"],
                {},
            )
            .get(
                column["metric_key"]
            )
        )

    elif source == "commodity":
        value = (
            row_data[
                "commodity_values"
            ]
            .get(
                column["container_key"],
                {},
            )
            .get(
                column["metric_key"]
            )
        )

    else:
        raise ValueError(
            "Unsupported preview column "
            f"source: {source}"
        )

    return {
        "value": _preview_display_value(
            value,
            column.get("metric"),
        ),
        "numeric": (
            column.get("metric")
            is not None
        ),
    }


def _build_preview_sheet(
    *,
    name,
    rows,
    row_limit,
    identity_fields,
    total_label,
    total_metrics,
    total_group_value=None,
    groups=(),
    selected_metrics=(),
) -> dict[str, Any]:
    columns = _preview_columns(
        identity_fields=identity_fields,
        total_label=total_label,
        total_metrics=total_metrics,
        total_group_value=(
            total_group_value
        ),
        groups=groups,
        selected_metrics=(
            selected_metrics
        ),
    )

    header_rows = _preview_header_rows(
        identity_fields=identity_fields,
        total_label=total_label,
        total_metrics=total_metrics,
        total_group_value=total_group_value,
        groups=groups,
        selected_metrics=selected_metrics,
    )

    limited_rows = list(
        rows[:row_limit]
    )

    rendered_rows = [
        {
            "cells": [
                _preview_cell(
                    row_data,
                    column,
                )
                for column in columns
            ],
        }
        for row_data in limited_rows
    ]

    return {
        "name": name,
        "columns": columns,
        "header_rows": header_rows,
        "rows": rendered_rows,
        "total_rows": len(rows),
        "shown_rows": len(
            rendered_rows
        ),
    }


def build_report_workbook_preview(
    request,
    *,
    row_limit=REPORT_PREVIEW_ROW_LIMIT,
) -> dict[str, Any]:
    """Build an Excel-style HTML preview."""

    row_limit = max(
        1,
        int(row_limit),
    )

    dataset = build_report_dataset(
        request
    )

    selected = dataset["selected"]
    selected_metrics = dataset[
        "selected_metrics"
    ]

    used_names = set()
    sheets = []

    if selected["layout"] == "consolidated":
        consolidate_by = selected[
            "consolidate_by"
        ]

        preview_rows = (
            _consolidate_report_rows(
                dataset
            )
        )

        sheets.append(
            _build_preview_sheet(
                name=_safe_sheet_name(
                    CONSOLIDATED_SHEET_NAMES[
                        consolidate_by
                    ],
                    used_names=used_names,
                ),
                rows=preview_rows,
                row_limit=row_limit,
                identity_fields=(
                    _identity_fields_for_consolidation(
                        consolidate_by
                    )
                ),
                total_label="TOTAL",
                total_metrics=(
                    _overall_metric_options(
                        selected_metrics
                    )
                ),
                groups=dataset[
                    "column_groups"
                ],
                selected_metrics=(
                    selected_metrics
                ),
            )
        )

        if consolidate_by != "incident":
            incident_rows = _consolidate_report_rows(
                dataset,
                consolidate_by="incident",
            )

            sheets.append(
                _build_preview_sheet(
                    name=_safe_sheet_name(
                        "Incident Summary",
                        used_names=used_names,
                    ),
                    rows=incident_rows,
                    row_limit=row_limit,
                    identity_fields=(
                        _identity_fields_for_consolidation(
                            "incident"
                        )
                    ),
                    total_label="TOTAL",
                    total_metrics=(
                        _overall_metric_options(
                            selected_metrics
                        )
                    ),
                    groups=dataset[
                        "column_groups"
                    ],
                    selected_metrics=(
                        selected_metrics
                    ),
                )
            )

        if consolidate_by != "year":
            year_rows = _consolidate_report_rows(
                dataset,
                consolidate_by="year",
            )

            sheets.append(
                _build_preview_sheet(
                    name=_safe_sheet_name(
                        "Year Summary",
                        used_names=used_names,
                    ),
                    rows=year_rows,
                    row_limit=row_limit,
                    identity_fields=(
                        _identity_fields_for_consolidation(
                            "year"
                        )
                    ),
                    total_label="TOTAL",
                    total_metrics=(
                        _overall_metric_options(
                            selected_metrics
                        )
                    ),
                    groups=dataset[
                        "column_groups"
                    ],
                    selected_metrics=(
                        selected_metrics
                    ),
                )
            )

        if consolidate_by not in {
            "region",
            "province",
        }:
            region_rows = _consolidate_report_rows(
                dataset,
                consolidate_by="region",
            )

            sheets.append(
                _build_preview_sheet(
                    name=_safe_sheet_name(
                        "Regional Summary",
                        used_names=used_names,
                    ),
                    rows=region_rows,
                    row_limit=row_limit,
                    identity_fields=(
                        _identity_fields_for_consolidation(
                            "region"
                        )
                    ),
                    total_label="TOTAL",
                    total_metrics=(
                        _overall_metric_options(
                            selected_metrics
                        )
                    ),
                    groups=dataset[
                        "column_groups"
                    ],
                    selected_metrics=(
                        selected_metrics
                    ),
                )
            )

            province_rows = _consolidate_report_rows(
                dataset,
                consolidate_by="province",
            )

            sheets.append(
                _build_preview_sheet(
                    name=_safe_sheet_name(
                        "Provincial Summary",
                        used_names=used_names,
                    ),
                    rows=province_rows,
                    row_limit=row_limit,
                    identity_fields=(
                        _identity_fields_for_consolidation(
                            "province"
                        )
                    ),
                    total_label="TOTAL",
                    total_metrics=(
                        _overall_metric_options(
                            selected_metrics
                        )
                    ),
                    groups=dataset[
                        "column_groups"
                    ],
                    selected_metrics=(
                        selected_metrics
                    ),
                )
            )

    else:
        sheets.append(
            _build_preview_sheet(
                name=_safe_sheet_name(
                    "Overall Summary",
                    used_names=used_names,
                ),
                rows=dataset["rows"],
                row_limit=row_limit,
                identity_fields=(
                    IDENTITY_FIELDS
                ),
                total_label="TOTAL",
                total_metrics=(
                    _overall_metric_options(
                        selected_metrics
                    )
                ),
                selected_metrics=(
                    selected_metrics
                ),
            )
        )

        for group in dataset[
            "sheet_groups"
        ]:
            group_total_metrics = (
                _group_metric_options(
                    group,
                    selected_metrics,
                )
            )

            if not group_total_metrics:
                continue

            child_commodities = [
                commodity
                for commodity
                in group["commodities"]
                if not commodity[
                    "is_parent"
                ]
            ]

            rendered_groups = (
                [
                    {
                        **group,
                        "commodities": (
                            child_commodities
                        ),
                    }
                ]
                if child_commodities
                else []
            )

            group_rows = (
                _rows_for_group_sheet(
                    dataset,
                    group["value"],
                )
            )

            sheets.append(
                _build_preview_sheet(
                    name=_safe_sheet_name(
                        group["value"],
                        used_names=used_names,
                    ),
                    rows=group_rows,
                    row_limit=row_limit,
                    identity_fields=(
                        IDENTITY_FIELDS
                    ),
                    total_label=(
                        f"{group['label']} TOTAL"
                    ),
                    total_metrics=(
                        group_total_metrics
                    ),
                    total_group_value=(
                        group["value"]
                    ),
                    groups=rendered_groups,
                    selected_metrics=(
                        selected_metrics
                    ),
                )
            )

    return {
        "row_limit": row_limit,
        "sheet_count": len(sheets),
        "sheets": sheets,
        "labels": dataset["labels"],
    }
