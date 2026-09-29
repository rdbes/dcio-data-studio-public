"""Excel workbook generation for Agricultural Drought report previews."""

from __future__ import annotations

from io import BytesIO
from numbers import Number

import xlsxwriter

REPORT_SOURCE = (
    "Source: DA-BSWM DCAF Agricultural Drought Maps, "
    "DOST-PAGASA Monthly Rainfall Outlook"
)


def _month_label(month):
    label = str(month.get("label") or month.get("key") or "Month")
    year = month.get("year")
    return f"{label} {year}" if year else label


def _format_cache(workbook):
    cache = {}

    def get(
        *,
        background="",
        foreground="#111827",
        bold=False,
        align="left",
        border=0,
        top=0,
        bottom=0,
        top_color="",
        bottom_color="",
        font_size=10,
        italic=False,
        text_wrap=True,
        num_format=None,
    ):
        key = (
            background,
            foreground,
            bold,
            align,
            border,
            top,
            bottom,
            top_color,
            bottom_color,
            font_size,
            italic,
            text_wrap,
            num_format,
        )
        if key not in cache:
            properties = {
                "font_color": foreground,
                "font_size": font_size,
                "bold": bold,
                "italic": italic,
                "align": align,
                "valign": "vcenter",
                "text_wrap": text_wrap,
                "border": border,
            }
            if top:
                properties["top"] = top
            if bottom:
                properties["bottom"] = bottom
            if top_color:
                properties["top_color"] = top_color
            if bottom_color:
                properties["bottom_color"] = bottom_color
            if background:
                properties["bg_color"] = background
            if num_format:
                properties["num_format"] = num_format
            cache[key] = workbook.add_format(properties)
        return cache[key]

    return get


def _write_or_merge(
    worksheet,
    first_row,
    first_column,
    last_row,
    last_column,
    value,
    cell_format,
):
    if first_row == last_row and first_column == last_column:
        worksheet.write(first_row, first_column, value, cell_format)
    else:
        worksheet.merge_range(
            first_row,
            first_column,
            last_row,
            last_column,
            value,
            cell_format,
        )


def build_agricultural_drought_excel(report):
    """Return one continuous workbook table matching the printable report."""

    output = BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    worksheet = workbook.add_worksheet("Drought Report")
    worksheet.hide_gridlines(2)
    worksheet.set_landscape()
    worksheet.set_paper(9)
    worksheet.fit_to_pages(1, 0)
    worksheet.set_margins(0.25, 0.25, 0.35, 0.35)

    fmt = _format_cache(workbook)
    title_format = fmt(
        foreground="#18181b",
        bold=True,
        font_size=16,
        text_wrap=False,
    )
    source_format = fmt(
        foreground="#52525b",
        font_size=9,
        text_wrap=False,
    )
    metadata_label_format = fmt(
        foreground="#52525b",
        bold=True,
        font_size=9,
        text_wrap=False,
    )
    metadata_value_format = fmt(
        foreground="#52525b",
        font_size=9,
        text_wrap=False,
    )
    header_format = fmt(
        background="#fafafa",
        foreground="#71717a",
        bold=True,
        align="center",
        border=1,
        font_size=9,
    )
    header_left_format = fmt(
        background="#fafafa",
        foreground="#71717a",
        bold=True,
        align="left",
        border=1,
        font_size=9,
    )
    group_format = fmt(
        background="#feb601",
        foreground="#3f2c00",
        bold=True,
        align="left",
        border=1,
        font_size=9,
    )
    legend_heading_format = fmt(
        foreground="#52525b",
        bold=True,
        font_size=10,
        text_wrap=True,
    )
    legend_label_format = fmt(foreground="#52525b", font_size=9)
    muted_format = fmt(
        foreground="#71717a",
        font_size=9,
        italic=True,
    )

    months = list(report.get("report_months") or ())
    columns = [
        "Location",
        (
            f"{report.get('assessment_period_label')}\nAssessment"
            if report.get("assessment_period_label")
            else "Assessment"
        ),
        (
            f"{report.get('outlook_period_label')}\nOutlook"
            if report.get("outlook_period_label")
            else "Outlook"
        ),
    ]
    columns.extend(_month_label(month) for month in months)
    last_column = len(columns) - 1

    _write_or_merge(
        worksheet,
        0,
        0,
        0,
        last_column,
        "Agricultural Drought Report",
        title_format,
    )
    _write_or_merge(
        worksheet,
        1,
        0,
        1,
        last_column,
        REPORT_SOURCE,
        source_format,
    )
    worksheet.write(2, 0, "As of", metadata_label_format)
    reporting_month = report.get("reporting_month")
    worksheet.write(
        2,
        1,
        reporting_month.strftime("%B %Y") if reporting_month else "",
        metadata_value_format,
    )
    report_legends = list(report.get("report_legends") or ())
    legend_heading_row = 4
    header_row = legend_heading_row
    if report_legends:
        _write_or_merge(
            worksheet,
            legend_heading_row,
            0,
            legend_heading_row,
            last_column,
            "Report data legends",
            legend_heading_format,
        )
        legend_title_row = legend_heading_row + 1
        legend_item_row = legend_title_row + 1
        legend_start_column = 1 if last_column >= 1 else 0
        if len(report_legends) == 1:
            block_ranges = [(legend_start_column, last_column)]
        else:
            available_columns = last_column - legend_start_column + 1
            split_column = legend_start_column + max(1, available_columns // 2)
            block_ranges = [
                (legend_start_column, split_column - 1),
                (split_column, last_column),
            ]
        max_item_rows = 0
        for legend, (block_start, block_end) in zip(report_legends, block_ranges):
            title = legend.get("title") or "Legend"
            if legend.get("unit_label"):
                title = f"{title} - {legend['unit_label']}"
            _write_or_merge(
                worksheet,
                legend_title_row,
                block_start,
                legend_title_row,
                block_end,
                title,
                legend_heading_format,
            )
            block_width = block_end - block_start + 1
            items_per_row = max(1, block_width // 2)
            items = list(legend.get("items") or ())
            max_item_rows = max(
                max_item_rows,
                (len(items) + items_per_row - 1) // items_per_row,
            )
            for item_index, item in enumerate(items):
                item_row = legend_item_row + item_index // items_per_row
                slot = item_index % items_per_row
                swatch_column = block_start + slot * 2
                label_column = min(swatch_column + 1, block_end)
                swatch_format = fmt(
                    background=item.get("color") or "#f4f4f5",
                    border=1,
                    text_wrap=False,
                )
                worksheet.write(item_row, swatch_column, "", swatch_format)
                worksheet.write(
                    item_row,
                    label_column,
                    item.get("label") or "",
                    legend_label_format,
                )
        worksheet.set_row(legend_title_row, 28)
        for row in range(legend_item_row, legend_item_row + max_item_rows):
            worksheet.set_row(row, 20)
        header_row = legend_item_row + max_item_rows + 1

    worksheet.write_row(header_row, 0, columns, header_left_format)
    for column in range(1, len(columns)):
        worksheet.write(header_row, column, columns[column], header_format)
    worksheet.set_row(header_row, 34)
    worksheet.repeat_rows(header_row, header_row)

    body_row = header_row + 1
    report_row_index = 0
    previous_group_label = None
    has_rainfall = bool(report.get("has_rainfall"))
    boundary_mode = report.get("boundary_mode")
    written_municipality_summaries = set()
    for page in report.get("report_pages") or ():
        for group in page.get("groups") or ():
            rows = list(group.get("rows") or ())
            group_label = group.get("label") or ""
            if (
                boundary_mode not in {"region", "municipality"}
                and group_label != previous_group_label
            ):
                _write_or_merge(
                    worksheet,
                    body_row,
                    0,
                    body_row,
                    last_column,
                    group_label,
                    group_format,
                )
                worksheet.set_row(body_row, 22)
                body_row += 1
            previous_group_label = group_label
            for row in rows:
                is_province_summary = bool(
                    boundary_mode == "municipality"
                    and row.get("is_province_summary")
                )
                summary_key = (
                    group_label,
                    row.get("region") or "",
                )
                if is_province_summary and summary_key in written_municipality_summaries:
                    continue
                if is_province_summary:
                    written_municipality_summaries.add(summary_key)
                start_row = body_row
                show_pagasa = has_rainfall and row.get("show_pagasa", has_rainfall)
                end_row = body_row + 1 if show_pagasa else body_row
                even_background = "#eef0f3" if report_row_index % 2 == 0 else "#ffffff"
                row_background = even_background
                summary_top = 2 if is_province_summary else 0
                summary_bottom = 2 if is_province_summary else 0
                summary_top_color = "#feb601" if is_province_summary else ""
                summary_bottom_color = "#feb601" if is_province_summary else ""
                body_format = fmt(
                    background=row_background,
                    foreground="#27272a",
                    bold=True,
                    top=summary_top,
                    bottom=summary_bottom,
                    top_color=summary_top_color,
                    bottom_color=summary_bottom_color,
                    font_size=10,
                )
                status_format = fmt(
                    background=row_background,
                    foreground="#111827",
                    bold=True,
                    align="center",
                    top=summary_top,
                    bottom=summary_bottom,
                    top_color=summary_top_color,
                    bottom_color=summary_bottom_color,
                    font_size=10,
                )
                missing_status_format = fmt(
                    background=row_background,
                    foreground="#a1a1aa",
                    align="center",
                    top=summary_top,
                    bottom=summary_bottom,
                    top_color=summary_top_color,
                    bottom_color=summary_bottom_color,
                    font_size=10,
                )
                # Municipality rows contain only their own name. The province
                # is represented once by the preceding marked summary row so
                # the workbook does not repeat the parent on every row.
                location = row.get("name") or ""
                _write_or_merge(
                    worksheet,
                    start_row,
                    0,
                    end_row,
                    0,
                    location,
                    body_format,
                )
                assessment = row.get("assessment") or "No data"
                outlook = row.get("outlook") or "No data"
                assessment_format = (
                    missing_status_format
                    if assessment == "No data"
                    else status_format
                )
                outlook_format = (
                    missing_status_format
                    if outlook == "No data"
                    else status_format
                )
                _write_or_merge(
                    worksheet,
                    start_row,
                    1,
                    end_row,
                    1,
                    assessment,
                    assessment_format,
                )
                _write_or_merge(
                    worksheet,
                    start_row,
                    2,
                    end_row,
                    2,
                    outlook,
                    outlook_format,
                )
                for month_index, month in enumerate(row.get("monthly_report") or ()):
                    column = month_index + 3
                    forecast = month.get("forecast") or "—"
                    forecast_format = fmt(
                        background=month.get("forecast_color") or even_background,
                        foreground=month.get("forecast_text_color") or "#1f2937",
                        align="center",
                        top=summary_top,
                        bottom=summary_bottom if not show_pagasa else 0,
                        top_color=summary_top_color,
                        bottom_color=summary_bottom_color if not show_pagasa else "",
                        font_size=10,
                    )
                    if forecast in {"—", "-"}:
                        forecast_format = fmt(
                            background=row_background,
                            foreground="#a1a1aa",
                            align="center",
                            top=summary_top,
                            bottom=summary_bottom if not show_pagasa else 0,
                            top_color=summary_top_color,
                            bottom_color=summary_bottom_color if not show_pagasa else "",
                            font_size=10,
                        )
                    worksheet.write(start_row, column, forecast, forecast_format)
                    if show_pagasa:
                        rainfall = month.get("rainfall") or {}
                        mean = rainfall.get("mean")
                        numeric_mean = (
                            mean
                            if isinstance(mean, Number) and not isinstance(mean, bool)
                            else None
                        )
                        rainfall_value = (
                            numeric_mean if numeric_mean is not None else "—"
                        )
                        rainfall_format = fmt(
                            background=(
                                rainfall.get("percent_normal_color")
                                or even_background
                            ),
                            foreground=(
                                rainfall.get("percent_normal_text_color")
                                or "#1f2937"
                            ),
                            bold=True,
                            align="center",
                            bottom=summary_bottom,
                            bottom_color=summary_bottom_color,
                            font_size=10,
                            num_format=(
                                "0.00"
                                if numeric_mean is not None
                                and abs(numeric_mean) < 1
                                else "0"
                            ),
                        )
                        if rainfall_value in {"—", "-"}:
                            rainfall_format = fmt(
                                background=row_background,
                                foreground="#a1a1aa",
                                align="center",
                                bottom=summary_bottom,
                                bottom_color=summary_bottom_color,
                                font_size=10,
                            )
                        if numeric_mean is not None:
                            worksheet.write_number(
                                end_row,
                                column,
                                float(numeric_mean),
                                rainfall_format,
                            )
                        else:
                            worksheet.write(
                                end_row,
                                column,
                                rainfall_value,
                                rainfall_format,
                            )
                worksheet.set_row(start_row, 24)
                if show_pagasa:
                    worksheet.set_row(end_row, 24)
                body_row = end_row + 1
                report_row_index += 1
            if not rows:
                _write_or_merge(
                    worksheet,
                    body_row,
                    0,
                    body_row,
                    last_column,
                    "No report rows are available for this scope.",
                    muted_format,
                )
                body_row += 1

    worksheet.set_column(0, 0, 28)
    worksheet.set_column(1, 2, 18)
    if last_column >= 3:
        worksheet.set_column(3, last_column, 16)
    worksheet.set_footer("Page &P of &N")
    workbook.close()
    return output.getvalue()
