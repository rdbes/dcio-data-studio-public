"""PDF renderers for Agricultural Drought reports.

The browser renderer is the canonical export path because the report preview
is already composed from the same Django template and CSS.  The original
dependency-free renderer remains available as a fallback for environments
that do not have the Playwright browser runtime installed.
"""

from __future__ import annotations

import base64
import shutil
import subprocess
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

from reports.agricultural_drought.styles import (
    REPORT_PERCENT_NORMAL_LEGEND,
    REPORT_SVTR_LEGEND,
    report_status_fill_color,
)

PAGE_WIDTH = 841.8898  # A4 landscape, points
PAGE_HEIGHT = 595.2756
PAGE_MARGIN = 24.0
ORANGE = "#FEB601"
GRID = "#E4E4E7"
TEXT = "#27272A"
CELL_TEXT = "#1F2937"
MUTED = "#71717A"
MISSING_VALUE = "#A1A1AA"
MONTH_GUTTER = 1.5
CELL_VERTICAL_INSET = 2.0


class AgriculturalDroughtBrowserPdfError(RuntimeError):
    """Raised when the preview-aligned browser PDF cannot be rendered."""


_PLAYWRIGHT_RENDER_SCRIPT = r"""
const { chromium } = require("playwright");

(async () => {
  const html = require("fs").readFileSync(0, "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1122, height: 793 } });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts ? document.fonts.ready : undefined);
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    process.stdout.write(pdf);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(String(error && error.stack || error));
  process.exit(1);
});
"""


def _hex_color(value, fallback=TEXT):
    text = str(value or fallback).strip().lstrip("#")
    if len(text) != 6:
        text = fallback.lstrip("#")
    try:
        return tuple(int(text[index : index + 2], 16) / 255 for index in (0, 2, 4))
    except ValueError:
        return _hex_color(fallback, TEXT)


def _pdf_color(value, fallback=TEXT):
    red, green, blue = _hex_color(value, fallback)
    return f"{red:.4f} {green:.4f} {blue:.4f}"


def _readable_text_color(background):
    if str(background or "").strip().casefold() == "#da6c6c":
        return "#FFFFFF"
    red, green, blue = _hex_color(background, "#FFFFFF")
    luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    dark_contrast = (luminance + 0.05) / 0.05
    light_contrast = 1.05 / (luminance + 0.05)
    return CELL_TEXT if dark_contrast >= light_contrast else "#FFFFFF"


def _text(value):
    """Keep standard Helvetica output deterministic and PDF-safe."""

    replacements = {
        "\u2013": "-",
        "\u2014": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u00b7": "|",
        "\u00a0": " ",
    }
    normalized = "" if value is None else str(value)
    for source, replacement in replacements.items():
        normalized = normalized.replace(source, replacement)
    return normalized.encode("ascii", "replace").decode("ascii")


def _escape_pdf_text(value):
    return _text(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _estimate_text_width(value, size):
    return len(_text(value)) * size * 0.52


def _wrapped_lines(value, max_chars):
    text = _text(value)
    if len(text) <= max_chars:
        return [text]
    words = text.split()
    lines = []
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if line and len(candidate) > max_chars:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines or [""]


def _month_label(value):
    if hasattr(value, "strftime"):
        return value.strftime("%B %Y")
    return _text(value)


def _rounded_mean(value):
    """Format rainfall means with precision for sub-unit values."""

    if value is None:
        return "-"
    try:
        number = Decimal(str(value))
        if abs(number) < 1:
            return f"{number.quantize(Decimal('0.00'), rounding=ROUND_HALF_UP):.2f}"
        return str(number.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError):
        return "-"


@dataclass
class _PdfPage:
    commands: list[str] = field(default_factory=list)

    def rectangle(self, x, y, width, height, fill=None, stroke=GRID, line_width=0.5):
        self.commands.append(f"{line_width:.2f} w")
        if fill:
            self.commands.append(f"{_pdf_color(fill)} rg")
        if stroke:
            self.commands.append(f"{_pdf_color(stroke)} RG")
        mode = "B" if fill and stroke else "f" if fill else "S"
        self.commands.append(f"{x:.2f} {y:.2f} {width:.2f} {height:.2f} re {mode}")

    def rounded_rectangle(self, x, y, width, height, radius, fill=None, stroke=GRID, line_width=0.5):
        """Draw a rounded rectangle using cubic Bezier corners."""

        radius = max(0.0, min(float(radius), width / 2, height / 2))
        kappa = 0.5522848
        commands = [f"{line_width:.2f} w"]
        if fill:
            commands.append(f"{_pdf_color(fill)} rg")
        if stroke:
            commands.append(f"{_pdf_color(stroke)} RG")
        commands.extend(
            [
                f"{x + radius:.2f} {y:.2f} m",
                f"{x + width - radius:.2f} {y:.2f} l",
                f"{x + width - radius + kappa * radius:.2f} {y:.2f} {x + width:.2f} {y + radius - kappa * radius:.2f} {x + width:.2f} {y + radius:.2f} c",
                f"{x + width:.2f} {y + height - radius:.2f} l",
                f"{x + width:.2f} {y + height - radius + kappa * radius:.2f} {x + width - radius + kappa * radius:.2f} {y + height:.2f} {x + width - radius:.2f} {y + height:.2f} c",
                f"{x + radius:.2f} {y + height:.2f} l",
                f"{x + radius - kappa * radius:.2f} {y + height:.2f} {x:.2f} {y + height - radius + kappa * radius:.2f} {x:.2f} {y + height - radius:.2f} c",
                f"{x:.2f} {y + radius:.2f} l",
                f"{x:.2f} {y + radius - kappa * radius:.2f} {x + radius - kappa * radius:.2f} {y:.2f} {x + radius:.2f} {y:.2f} c",
                "h",
            ]
        )
        mode = "B" if fill and stroke else "f" if fill else "S"
        commands.append(mode)
        self.commands.extend(commands)

    def line(self, x1, y1, x2, y2, color=GRID, line_width=0.5):
        self.commands.extend(
            [
                f"{line_width:.2f} w",
                f"{_pdf_color(color)} RG",
                f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S",
            ]
        )

    def text(self, x, y, value, size=8, color=TEXT, bold=False, align="left"):
        value = _escape_pdf_text(value)
        font = "F2" if bold else "F1"
        if align == "center":
            x -= _estimate_text_width(value, size) / 2
        elif align == "right":
            x -= _estimate_text_width(value, size)
        self.commands.extend(
            [
                "BT",
                f"/{font} {size:.2f} Tf",
                f"{_pdf_color(color)} rg",
                f"{x:.2f} {y:.2f} Td",
                f"({value}) Tj",
                "ET",
            ]
        )

    def stream(self):
        return ("\n".join(self.commands) + "\n").encode("ascii")


def _draw_centered_cell(page, x, y, width, height, value, *, color=TEXT, size=7, bold=False, fill="#FFFFFF"):
    page.rectangle(x, y, width, height, fill=fill, stroke=None)
    page.text(x + width / 2, y + height / 2 - size * 0.32, value, size=size, color=color, bold=bold, align="center")


def _draw_status_cell(page, x, y, width, height, value, *, highlight="", fill="#FFFFFF"):
    """Render a simple black status label in the report cell."""

    page.rectangle(x, y, width, height, fill=fill, stroke=None)
    label = _text(value).strip()
    if not label or label.casefold() == "no data":
        page.text(
            x + width / 2,
            y + height / 2 - 2.4,
            label or "No data",
            size=7.5,
            color=MISSING_VALUE,
            bold=False,
            align="center",
        )
        return

    size = 7.5
    page.text(
        x + width / 2,
        y + height / 2 - 2.4,
        label,
        size=size,
        color=TEXT,
        bold=True,
        align="center",
    )


def _draw_month_cell(
    page,
    x,
    y,
    width,
    height,
    value,
    background="",
    text_color=TEXT,
    bold=False,
    empty_fill="#FFFFFF",
):
    cell_x = x + MONTH_GUTTER / 2
    cell_width = max(0.0, width - MONTH_GUTTER)
    page.rectangle(x, y, width, height, fill=empty_fill, stroke=None)
    if _text(value).strip() in {"-", "—"}:
        text_color = MISSING_VALUE
        bold = False
        page.text(x + width / 2, y + height / 2 - 2.3, value, size=7.5, color=text_color, bold=bold, align="center")
        return
    fill_height = min(14.0, max(8.0, height - 4.0))
    fill_y = y + CELL_VERTICAL_INSET
    page.rectangle(
        cell_x,
        fill_y,
        cell_width,
        fill_height,
        fill=background or empty_fill,
        stroke=None,
    )
    page.text(
        x + width / 2,
        fill_y + fill_height / 2 - 2.3,
        value,
        size=7.5,
        color=text_color,
        bold=bold,
        align="center",
    )


def _draw_rainfall_cell(page, x, y, width, height, value, background="", text_color=TEXT, empty_fill="#FFFFFF"):
    """Render a PAGASA mean as a compact category-colored pill."""

    cell_x = x + MONTH_GUTTER / 2
    cell_width = max(0.0, width - MONTH_GUTTER)
    page.rectangle(x, y, width, height, fill=empty_fill, stroke=None)
    if _text(value).strip() in {"-", "—"}:
        page.text(x + width / 2, y + height / 2 - 2.3, value, size=7.5, color=MISSING_VALUE, align="center")
        return

    label = _text(value)
    pill_height = min(14.0, max(8.0, height - 4.0))
    pill_width = cell_width
    pill_x = cell_x
    # Align the rainfall pill to the top of its row so it sits closer to the
    # rectangular BSWM cell above while preserving the overall location-block
    # height.
    pill_y = y + height - pill_height - CELL_VERTICAL_INSET
    page.rounded_rectangle(
        pill_x,
        pill_y,
        pill_width,
        pill_height,
        pill_height / 2,
        fill=background or "#F4F4F5",
        stroke=None,
        line_width=0.4,
    )
    page.text(
        x + width / 2,
        pill_y + pill_height / 2 - 2.3,
        label,
        size=7.5,
        color=text_color,
        bold=True,
        align="center",
    )


def _legend_groups(report):
    return report.get("report_legends") or [
        {
            "title": "DA-BSWM Monthly Agricultural Drought Forecast",
            "items": list(REPORT_SVTR_LEGEND),
            "shape": "rectangle",
        },
        {
            "title": "DOST-PAGASA Rainfall Monthly Rainfall Forecast and Percent Normal",
            "items": list(REPORT_PERCENT_NORMAL_LEGEND),
            "shape": "pill",
            "unit_label": "Mean rainfall (mm)",
        },
    ]


def _legend_label(title, item):
    label = str(item.get("label") or "").strip()
    if title.casefold() == "outlook":
        return {
            "Ongoing and likely to intensify": "Intensifies",
            "Ongoing and likely to continue": "Continues",
        }.get(label, label)
    if "pagasa" in title.casefold():
        return {
            "Way below normal": "Way below",
            "Below normal": "Below",
        }.get(label, label)
    return label


def _draw_legend_footer(page, report):
    """Draw the two source legends as a compact one-row page footer."""

    left = PAGE_MARGIN
    width = PAGE_WIDTH - PAGE_MARGIN * 2
    bottom = PAGE_MARGIN
    height = 30.0
    page.line(left, bottom + height, left + width, bottom + height, color=ORANGE, line_width=0.5)
    prepared_groups = []
    for group in _legend_groups(report)[:2]:
        title = str(group.get("title") or "Legend")
        unit_label = str(group.get("unit_label") or "").strip()
        separator = " - " if unit_label else ""
        title_width = _estimate_text_width(title, 6.3)
        separator_width = _estimate_text_width(separator, 6.3)
        unit_width = _estimate_text_width(unit_label, 6.3) if unit_label else 0
        source_label_width = title_width + separator_width + unit_width
        shape = str(group.get("shape") or "rectangle").casefold()
        legend_items = []
        for item in group.get("items") or []:
            label = _legend_label(title, item)
            item_label_width = _estimate_text_width(label, 5.4)
            item_width = 14 + 5 + item_label_width + 8
            legend_items.append((item, label, item_width))
        total_items_width = sum(item_width for _, _, item_width in legend_items)
        group_width = max(source_label_width, total_items_width)
        prepared_groups.append(
            (group, title, unit_label, separator, title_width, separator_width, legend_items, group_width, shape)
        )

    if not prepared_groups:
        return

    gap = 20.0
    total_width = sum(group[-2] for group in prepared_groups) + gap * (len(prepared_groups) - 1)
    group_x = left + max(6.0, (width - total_width) / 2)
    for group, title, unit_label, separator, title_width, separator_width, legend_items, group_width, shape in prepared_groups:
        y = bottom
        title_x = group_x
        title_y = y + height - 9
        page.text(title_x, title_y, title, size=6.3, color=MUTED, bold=False)
        if unit_label:
            separator_x = title_x + title_width
            page.text(separator_x, title_y, separator, size=6.3, color=MUTED, bold=False)
            unit_x = separator_x + separator_width
            page.text(unit_x, title_y, unit_label, size=6.3, color=MUTED, bold=True)
        # Leave a small, deliberate gap between the source label and its
        # swatches so the footer reads as a heading followed by a legend row.
        item_y = y + 8
        item_x = group_x
        for item, label, item_width in legend_items:
            swatch = item.get("color") or "#D4D4D8"
            if shape == "pill":
                page.rounded_rectangle(item_x, item_y, 14, 7, 3.5, fill=swatch, stroke=None)
            else:
                page.rectangle(item_x, item_y, 14, 7, fill=swatch, stroke=None)
            page.text(item_x + 19, item_y - 0.2, label, size=5.4, color=TEXT, bold=False)
            item_x += item_width
        group_x += group_width + gap


def _draw_report_page(page_data, report, page, page_number=1, page_count=1):
    left = PAGE_MARGIN
    top = PAGE_HEIGHT - PAGE_MARGIN
    content_width = PAGE_WIDTH - PAGE_MARGIN * 2
    page.text(left, top - 22, "Agricultural Drought Report", size=20, bold=True)
    page.text(
        left + content_width,
        top - 22,
        f"{page_number} of {page_count}",
        size=7.5,
        color="#71717A",
        bold=False,
        align="right",
    )
    page.text(
        left,
        top - 43,
        "Source: DA-BSWM DCAF Agricultural Drought Maps, DOST-PAGASA Monthly Rainfall Outlook",
        size=9.5,
        color="#52525B",
        bold=False,
    )
    page.text(
        left + content_width,
        top - 43,
        f"As of {_month_label(report.get('reporting_month') or '')}",
        size=9.5,
        color="#52525B",
        bold=False,
        align="right",
    )
    page.line(left, top - 55, left + content_width, top - 55, color=ORANGE, line_width=2.0)

    months = report.get("report_months") or []
    month_count = max(len(months), 1)
    location_width = 145.0
    assessment_width = 74.0
    outlook_width = 74.0
    month_width = (content_width - location_width - assessment_width - outlook_width) / month_count
    header_top = top - 70
    header_height = 24.0
    headers = [
        ("Location", ""),
        (report.get("assessment_period_label") or "Assessment", "Assessment" if report.get("assessment_period_label") else ""),
        (report.get("outlook_period_label") or "Outlook", "Outlook" if report.get("outlook_period_label") else ""),
    ] + [
        (f"{month.get('label', '')} {month.get('year', '')}".strip(), "")
        for month in months
    ]
    widths = [location_width, assessment_width, outlook_width] + [month_width] * month_count
    x = left
    for header, width in zip(headers, widths):
        page.rectangle(x, header_top - header_height, width, header_height, fill="#FAFAFA", stroke=GRID)
        primary, secondary = header
        if secondary:
            page.text(x + width / 2, header_top - 10, primary, size=8, color=MUTED, bold=True, align="center")
            page.text(x + width / 2, header_top - 20, secondary, size=8, color=MUTED, bold=True, align="center")
        else:
            page.text(x + width / 2, header_top - 15, primary, size=8, color=MUTED, bold=True, align="center")
        x += width

    cursor = header_top - header_height
    has_rainfall = bool(report.get("has_rainfall"))
    location_index = 0
    for group in page_data.get("groups", []):
        if report.get("boundary_mode") not in {"region", "municipality"}:
            group_height = 18.0
            cursor -= group_height
            page.rectangle(left, cursor, content_width, group_height, fill=ORANGE, stroke=None)
            page.text(left + 7, cursor + 5.3, group.get("label", ""), size=8, color="#3F2A00", bold=True)
        for row in group.get("rows", []):
            # Keep a small reserve above the legend divider so fallback PDFs
            # match the preview's table-to-footer breathing room.
            row_height = 19.2
            show_pagasa = has_rainfall and row.get("show_pagasa", has_rainfall)
            is_province_summary = bool(
                report.get("boundary_mode") == "municipality"
                and row.get("is_province_summary")
            )
            total_height = row_height * 2 if show_pagasa else row_height
            cursor -= total_height + 5.0
            y = cursor
            row_index = row.get("report_row_index", location_index)
            block_fill = "#EEF0F3" if row_index % 2 == 0 else "#FFFFFF"
            page.rectangle(left, y, content_width, total_height, fill=block_fill, stroke=None)
            location_lines = []
            location_lines.extend(_wrapped_lines(row.get("name", ""), 23))
            line_step = 8.5
            first_y = y + total_height / 2 + (len(location_lines) - 1) * line_step / 2 - 2.5
            for line_index, line in enumerate(location_lines):
                page.text(left + 6, first_y - line_index * line_step, line, size=7.5, color=TEXT, bold=line_index == len(location_lines) - 1)

            x = left + location_width
            assessment = row.get("assessment", "")
            _draw_status_cell(
                page,
                x,
                y,
                assessment_width,
                total_height,
                assessment,
                highlight=row.get("assessment_highlight_color")
                or report_status_fill_color(assessment, row.get("assessment_color")),
                fill=block_fill,
            )
            x += assessment_width
            outlook = row.get("outlook", "")
            _draw_status_cell(
                page,
                x,
                y,
                outlook_width,
                total_height,
                outlook,
                highlight=row.get("outlook_highlight_color")
                or report_status_fill_color(outlook, row.get("outlook_color")),
                fill=block_fill,
            )
            x += outlook_width

            monthly = row.get("monthly_report") or []
            for month in monthly:
                _draw_month_cell(
                    page,
                    x,
                    y + (row_height if show_pagasa else 0),
                    month_width,
                    row_height,
                    month.get("forecast", "-"),
                    month.get("forecast_color", ""),
                    month.get("forecast_text_color") or _readable_text_color(month.get("forecast_color")),
                    False,
                    block_fill,
                )
                if show_pagasa:
                    rainfall = month.get("rainfall") or {}
                    mean = rainfall.get("mean")
                    rainfall_value = _rounded_mean(mean)
                    _draw_rainfall_cell(
                        page,
                        x,
                        y,
                        month_width,
                        row_height,
                        rainfall_value,
                        rainfall.get("percent_normal_color", ""),
                        rainfall.get("percent_normal_text_color") or _readable_text_color(rainfall.get("percent_normal_color")),
                        block_fill,
                    )
                x += month_width
            if is_province_summary:
                page.line(
                    left,
                    y + total_height,
                    left + content_width,
                    y + total_height,
                    color=ORANGE,
                    line_width=1.5,
                )
                page.line(
                    left,
                    y,
                    left + content_width,
                    y,
                    color=ORANGE,
                    line_width=1.5,
                )
            location_index += 1

    if not page_data.get("groups"):
        page.rectangle(left, cursor - 22, content_width, 22, fill="#FFFFFF", stroke=GRID)
        page.text(left + 7, cursor - 14, "No report rows are available for this scope.", size=8, color=MUTED)

    _draw_legend_footer(page, report)


def _build_page_streams(report):
    pages = report.get("report_pages") or [{"groups": []}]
    result = []
    page_count = len(pages)
    for page_number, page_data in enumerate(pages, start=1):
        page = _PdfPage()
        _draw_report_page(page_data, report, page, page_number=page_number, page_count=page_count)
        result.append(page.stream())
    return result


def _preview_stylesheet():
    """Return the same FARM CSS and local fonts used by the live preview."""

    from django.conf import settings

    static_dir = Path(settings.BASE_DIR) / "static"
    css = "\n".join(
        (
            (static_dir / "css" / file_name).read_text(encoding="utf-8")
            for file_name in (
                # Match the stylesheet order in templates/base.html and the
                # Agricultural Drought page's extra_head block.
                "tailwind.css",
                "base.css",
                "layout.css",
                "reports.css",
                "agricultural-drought.css",
            )
        )
    )

    font_faces = []
    font_files = (
        (
            "Inter",
            "InterVariable.woff2",
            "100 900",
        ),
        (
            "IBM Plex Mono",
            "IBMPlexMono-Regular.woff2",
            "400",
        ),
        (
            "IBM Plex Mono",
            "IBMPlexMono-Medium.woff2",
            "500",
        ),
        (
            "IBM Plex Mono",
            "IBMPlexMono-SemiBold.woff2",
            "600",
        ),
        (
            "IBM Plex Mono",
            "IBMPlexMono-Bold.woff2",
            "700",
        ),
    )
    for family, file_name, weight in font_files:
        font_path = static_dir / "vendor" / "fonts" / (
            "inter/files" if family == "Inter" else "ibm-plex-mono/files"
        ) / file_name
        if not font_path.exists():
            continue
        encoded = base64.b64encode(font_path.read_bytes()).decode("ascii")
        font_faces.append(
            "@font-face {"
            f"font-family: '{family}';"
            "font-style: normal;"
            f"font-weight: {weight};"
            "font-display: block;"
            f"src: url(data:font/woff2;base64,{encoded}) format('woff2');"
            "}"
        )
    return "\n".join(font_faces) + "\n" + css


def _preview_layout_script():
    """Return the shared report row-layout controller inline for PDF export."""

    from django.conf import settings

    script_path = (
        Path(settings.BASE_DIR)
        / "static"
        / "js"
        / "maps"
        / "drought"
        / "drought_report_layout.js"
    )
    return script_path.read_text(encoding="utf-8")


def build_agricultural_drought_report_html(report):
    """Render the exact report-preview document used by browser export."""

    from django.template.loader import render_to_string

    fragment = render_to_string(
        "reports/partials/agricultural_drought_report_preview.html",
        report,
    )
    return (
        "<!doctype html><html lang=\"en\"><head>"
        "<meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<style>{_preview_stylesheet()}</style>"
        "<style>html,body{margin:0;padding:0;background:#fff;overflow:visible;}"
        "*{box-sizing:border-box;}</style>"
        f"<script>{_preview_layout_script()}</script>"
        "<script>window.addEventListener('DOMContentLoaded', function () {"
        "var apply = function () { window.ADDDroughtReportLayout?.apply(document); };"
        "if (document.fonts) { document.fonts.ready.then(apply); } else { apply(); }"
        "});</script>"
        "</head><body class=\"drought-report-print-document\">"
        f"{fragment}</body></html>"
    )


def build_agricultural_drought_pdf_from_html(html):
    """Render preview HTML to landscape A4 using the local Playwright browser."""

    from django.conf import settings

    node = shutil.which("node")
    node_modules = Path(settings.BASE_DIR) / "node_modules" / "playwright"
    if not node or not node_modules.exists():
        raise AgriculturalDroughtBrowserPdfError(
            "The Playwright browser runtime is not installed."
        )

    try:
        result = subprocess.run(
            [node, "-e", _PLAYWRIGHT_RENDER_SCRIPT],
            cwd=str(settings.BASE_DIR),
            input=html.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            timeout=90,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        detail = " ".join(str(exc).split())
        raise AgriculturalDroughtBrowserPdfError(
            f"The preview-aligned PDF renderer failed: {detail}"
        ) from exc

    if not result.stdout.startswith(b"%PDF"):
        raise AgriculturalDroughtBrowserPdfError(
            "The preview-aligned PDF renderer returned an invalid document."
        )
    return result.stdout


def build_agricultural_drought_pdf(report):
    """Return a landscape-A4 PDF byte string for a composed report."""

    streams = _build_page_streams(report)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        None,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    page_object_numbers = []
    for stream in streams:
        page_object_number = len(objects) + 1
        content_object_number = page_object_number + 1
        page_object_numbers.append(page_object_number)
        objects.extend(
            [
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH:.2f} {PAGE_HEIGHT:.2f}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_object_number} 0 R >>".encode("ascii"),
                f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"endstream",
            ]
        )
    kids = " ".join(f"{number} 0 R" for number in page_object_numbers)
    objects[1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_object_numbers)} >>".encode("ascii")

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_offset = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(output)
