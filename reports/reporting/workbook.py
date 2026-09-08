"""XlsxWriter workbook construction and sheet generation services."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Any

import xlsxwriter

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
    IDENTITY_COLUMN_WIDTHS,
    IDENTITY_FIELDS,
    _add_formats,
    _has_redundant_single_commodity_header,
    _metric_header_label,
    _safe_sheet_name,
    _sample_header_format,
    _write_metric_value,
)


@dataclass(frozen=True)
class ReportWorkbookResult:
    content: bytes
    filename: str
    row_count: int
    sheet_names: tuple[str, ...]
    metadata: dict[str, Any]


def _generated_by(request) -> str:
    user = getattr(request, "user", None)

    if (
        user is not None
        and getattr(
            user,
            "is_authenticated",
            False,
        )
    ):
        return (
            user.get_username()
            or user.get_full_name()
            or "Authenticated user"
        )

    return "System"


def _merge_or_write(
    worksheet,
    first_row,
    first_col,
    last_row,
    last_col,
    value,
    cell_format,
):
    if (
        first_row == last_row
        and first_col == last_col
    ):
        worksheet.write(
            first_row,
            first_col,
            value,
            cell_format,
        )
        return

    worksheet.merge_range(
        first_row,
        first_col,
        last_row,
        last_col,
        value,
        cell_format,
    )


def _write_identity_value(
    worksheet,
    row,
    column,
    field_name,
    value,
    formats,
):
    if field_name == "year":
        if value in (None, ""):
            worksheet.write_blank(
                row,
                column,
                None,
                formats["year"],
            )
            return

        try:
            numeric_year = int(value)
        except (TypeError, ValueError):
            worksheet.write(
                row,
                column,
                value,
                formats["text"],
            )
            return

        worksheet.write_number(
            row,
            column,
            numeric_year,
            formats["year"],
        )
        return

    worksheet.write(
        row,
        column,
        value,
        formats["text"],
    )


def _write_wide_sheet(
    workbook,
    *,
    dataset,
    formats,
    used_names,
    sheet_names,
    requested_name,
    groups,
    include_total,
    total_label="TOTAL",
    total_group_value=None,
    total_palette_key=None,
    total_metrics=None,
    row_filter_group_value=None,
    identity_fields=None,
    rows=None,
):
    sheet_name = _safe_sheet_name(
        requested_name,
        used_names=used_names,
    )
    sheet_names.append(sheet_name)

    worksheet = workbook.add_worksheet(
        sheet_name
    )

    resolved_identity_fields = (
        identity_fields
        if identity_fields is not None
        else IDENTITY_FIELDS
    )

    identity_headers = tuple(
        header
        for _, header
        in resolved_identity_fields
    )

    identity_column_count = len(
        resolved_identity_fields
    )

    for column, header in enumerate(
        identity_headers
    ):
        _merge_or_write(
            worksheet,
            0,
            column,
            3,
            column,
            header,
            formats["identity_header"],
        )

    current_column = (
        identity_column_count
    )

    resolved_total_palette_key = (
        total_palette_key
        or (
            groups[0]["value"]
            if (
                len(groups) == 1
                and total_label != "TOTAL"
            )
            else "TOTAL"
        )
    )

    resolved_total_metrics = (
        _overall_metric_options(
            dataset["selected_metrics"]
        )
        if total_metrics is None
        else total_metrics
    )

    resolved_total_metric_keys = {
        metric["key"]
        for metric in resolved_total_metrics
    }

    sheet_rows = (
        _rows_for_group_sheet(
            dataset,
            row_filter_group_value,
        )
        if rows is None
        else rows
    )

    if include_total and resolved_total_metrics:
        total_start = current_column
        total_end = (
            current_column
            + len(
                resolved_total_metrics
            )
            - 1
        )

        _merge_or_write(
            worksheet,
            0,
            total_start,
            2,
            total_end,
            total_label,
            _sample_header_format(
                workbook,
                formats,
                resolved_total_palette_key,
                "group",
            ),
        )

        for metric in dataset[
            "selected_metrics"
        ]:
            if (
                metric["key"]
                not in resolved_total_metric_keys
            ):
                continue

            worksheet.write(
                3,
                current_column,
                _metric_header_label(metric),
                _sample_header_format(
                    workbook,
                    formats,
                    resolved_total_palette_key,
                    "metric",
                ),
            )
            current_column += 1

    rendered_columns = []

    for group in groups:
        group_metrics = (
            _group_metric_options(
                group,
                dataset[
                    "selected_metrics"
                ],
            )
        )

        if not group_metrics:
            continue

        group_start = current_column

        merge_single_commodity_header = (
            _has_redundant_single_commodity_header(
                group
            )
        )

        for commodity in group[
            "commodities"
        ]:
            commodity_start = (
                current_column
            )

            for metric in group_metrics:
                worksheet.write(
                    3,
                    current_column,
                    _metric_header_label(metric),
                    _sample_header_format(
                        workbook,
                        formats,
                        commodity["value"],
                        "metric",
                    ),
                )

                rendered_columns.append(
                    (
                        current_column,
                        commodity,
                        metric,
                    )
                )

                current_column += 1

            if merge_single_commodity_header:
                _merge_or_write(
                    worksheet,
                    0,
                    commodity_start,
                    2,
                    current_column - 1,
                    commodity["label"],
                    _sample_header_format(
                        workbook,
                        formats,
                        group["value"],
                        "group",
                    ),
                )
            else:
                _merge_or_write(
                    worksheet,
                    1,
                    commodity_start,
                    2,
                    current_column - 1,
                    commodity["label"],
                    _sample_header_format(
                        workbook,
                        formats,
                        commodity["value"],
                        "commodity",
                    ),
                )

        if not merge_single_commodity_header:
            _merge_or_write(
                worksheet,
                0,
                group_start,
                0,
                current_column - 1,
                group["label"],
                _sample_header_format(
                    workbook,
                    formats,
                    group["value"],
                    "group",
                ),
            )

    for data_offset, row_data in enumerate(
        sheet_rows,
        start=4,
    ):
        identity = row_data["identity"]

        for column, (
            field_name,
            _,
        ) in enumerate(resolved_identity_fields):
            _write_identity_value(
                worksheet,
                data_offset,
                column,
                field_name,
                identity.get(field_name, ""),
                formats,
            )

        current_total_column = (
            identity_column_count
        )

        if include_total:
            total_values = (
                row_data[
                    "group_values"
                ].get(
                    total_group_value,
                    {},
                )
                if total_group_value
                else row_data["overall"]
            )

            for metric in dataset[
                "selected_metrics"
            ]:
                if (
                    metric["key"]
                    not in resolved_total_metric_keys
                ):
                    continue

                _write_metric_value(
                    worksheet,
                    data_offset,
                    current_total_column,
                    total_values.get(
                        metric["key"]
                    ),
                    metric,
                    formats,
                )
                current_total_column += 1

        for (
            column,
            commodity,
            metric,
        ) in rendered_columns:
            value = (
                row_data[
                    "commodity_values"
                ]
                .get(
                    commodity["value"],
                    {},
                )
                .get(metric["key"])
            )

            _write_metric_value(
                worksheet,
                data_offset,
                column,
                value,
                metric,
                formats,
            )

    worksheet.freeze_panes(
        4,
        identity_column_count,
    )

    worksheet.set_row(0, 24)
    worksheet.set_row(1, 24)
    worksheet.set_row(2, 24)
    worksheet.set_row(3, 58)

    for column, (
        field_name,
        _,
    ) in enumerate(
        resolved_identity_fields
    ):
        worksheet.set_column(
            column,
            column,
            IDENTITY_COLUMN_WIDTHS.get(
                field_name,
                18,
            ),
        )

    if (
        current_column
        > identity_column_count
    ):
        worksheet.set_column(
            identity_column_count,
            current_column - 1,
            15,
        )

    worksheet.hide_gridlines(2)
    worksheet.set_landscape()
    worksheet.fit_to_pages(1, 0)
    worksheet.repeat_rows(0, 3)
    worksheet.set_margins(
        left=0.25,
        right=0.25,
        top=0.4,
        bottom=0.4,
    )


def _download_filename(generated_at) -> str:
    timestamp = generated_at.strftime(
        "%b%d%Y_%H%M%S"
    )

    return (
        f"downloaded_report_{timestamp}.xlsx"
    )


def build_report_workbook(
    request,
) -> ReportWorkbookResult:
    """Generate the selected Excel workbook."""

    dataset = build_report_dataset(
        request
    )

    output = BytesIO()

    workbook = xlsxwriter.Workbook(
        output,
        {
            "in_memory": True,
        },
    )

    workbook.set_properties(
        {
            "title": "DCIO Report Generation",
            "subject": (
                dataset["labels"]["layout"]
            ),
            "author": (
                dataset["generated_by"]
            ),
            "company": (
                "Department of Agriculture"
            ),
            "comments": (
                "Generated by DCIO Data Studio."
            ),
        }
    )

    formats = _add_formats(workbook)
    used_names = set()
    sheet_names = []

    output_rows = len(
        dataset["rows"]
    )

    if (
        dataset["selected"]["layout"]
        == "consolidated"
    ):
        consolidate_by = dataset[
            "selected"
        ]["consolidate_by"]

        consolidated_rows = (
            _consolidate_report_rows(
                dataset
            )
        )

        output_rows = len(
            consolidated_rows
        )

        _write_wide_sheet(
            workbook,
            dataset=dataset,
            formats=formats,
            used_names=used_names,
            sheet_names=sheet_names,
            requested_name=(
                CONSOLIDATED_SHEET_NAMES[
                    consolidate_by
                ]
            ),
            groups=dataset[
                "column_groups"
            ],
            include_total=True,
            identity_fields=(
                _identity_fields_for_consolidation(
                    consolidate_by
                )
            ),
            rows=consolidated_rows,
        )

        if consolidate_by != "incident":
            incident_rows = _consolidate_report_rows(
                dataset,
                consolidate_by="incident",
            )
            output_rows += len(incident_rows)

            _write_wide_sheet(
                workbook,
                dataset=dataset,
                formats=formats,
                used_names=used_names,
                sheet_names=sheet_names,
                requested_name="Incident Summary",
                groups=dataset[
                    "column_groups"
                ],
                include_total=True,
                identity_fields=(
                    _identity_fields_for_consolidation(
                        "incident"
                    )
                ),
                rows=incident_rows,
            )

        if consolidate_by != "year":
            year_rows = _consolidate_report_rows(
                dataset,
                consolidate_by="year",
            )
            output_rows += len(year_rows)

            _write_wide_sheet(
                workbook,
                dataset=dataset,
                formats=formats,
                used_names=used_names,
                sheet_names=sheet_names,
                requested_name="Year Summary",
                groups=dataset[
                    "column_groups"
                ],
                include_total=True,
                identity_fields=(
                    _identity_fields_for_consolidation(
                        "year"
                    )
                ),
                rows=year_rows,
            )

        if consolidate_by not in {
            "region",
            "province",
        }:
            region_rows = _consolidate_report_rows(
                dataset,
                consolidate_by="region",
            )
            output_rows += len(region_rows)

            _write_wide_sheet(
                workbook,
                dataset=dataset,
                formats=formats,
                used_names=used_names,
                sheet_names=sheet_names,
                requested_name="Regional Summary",
                groups=dataset[
                    "column_groups"
                ],
                include_total=True,
                identity_fields=(
                    _identity_fields_for_consolidation(
                        "region"
                    )
                ),
                rows=region_rows,
            )

            province_rows = _consolidate_report_rows(
                dataset,
                consolidate_by="province",
            )
            output_rows += len(province_rows)

            _write_wide_sheet(
                workbook,
                dataset=dataset,
                formats=formats,
                used_names=used_names,
                sheet_names=sheet_names,
                requested_name="Provincial Summary",
                groups=dataset[
                    "column_groups"
                ],
                include_total=True,
                identity_fields=(
                    _identity_fields_for_consolidation(
                        "province"
                    )
                ),
                rows=province_rows,
            )
    else:
        _write_wide_sheet(
            workbook,
            dataset=dataset,
            formats=formats,
            used_names=used_names,
            sheet_names=sheet_names,
            requested_name=(
                "Overall Summary"
            ),
            groups=[],
            include_total=True,
        )

        for group in dataset[
            "sheet_groups"
        ]:
            group_total_metrics = (
                _group_metric_options(
                    group,
                    dataset[
                        "selected_metrics"
                    ],
                )
            )

            if not group_total_metrics:
                continue

            child_commodities = [
                commodity
                for commodity
                in group["commodities"]
                if not commodity["is_parent"]
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

            _write_wide_sheet(
                workbook,
                dataset=dataset,
                formats=formats,
                used_names=used_names,
                sheet_names=sheet_names,
                requested_name=(
                    group["value"]
                ),
                groups=rendered_groups,
                include_total=True,
                total_label=(
                    f"{group['label']} TOTAL"
                ),
                total_group_value=(
                    group["value"]
                ),
                total_palette_key=(
                    group["value"]
                ),
                total_metrics=(
                    group_total_metrics
                ),
                row_filter_group_value=(
                    group["value"]
                ),
            )

    workbook.close()
    content = output.getvalue()

    filename = _download_filename(
        dataset["generated_at"]
    )

    metadata = {
        "generated_by": (
            dataset["generated_by"]
        ),
        "layout": (
            dataset["selected"]["layout"]
        ),
        "consolidate_by": (
            dataset["selected"][
                "consolidate_by"
            ]
        ),
        "row_count": (
            dataset["row_count"]
        ),
        "output_rows": output_rows,
        "sheet_names": sheet_names,
        "filters": {
            key: value
            for key, value
            in dataset["selected"].items()
            if key != "sector"
        },
        "file_size_bytes": len(content),
        "canonical_total_rule": (
            "parent_precedence_then_children"
        ),
    }

    return ReportWorkbookResult(
        content=content,
        filename=filename,
        row_count=dataset["row_count"],
        sheet_names=tuple(sheet_names),
        metadata=metadata,
    )
