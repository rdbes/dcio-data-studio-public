"""Excel formatting utilities and workbook styling helpers for Report Generation."""

from __future__ import annotations

from decimal import Decimal

EXCEL_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument."
    "spreadsheetml.sheet"
)

REPORT_PREVIEW_ROW_LIMIT = 100

IDENTITY_FIELDS = (
    ("year", "YEAR"),
    ("region", "REGION / RFO"),
    ("province", "PROVINCE"),
    (
        "hazard_category",
        "HAZARD CATEGORY",
    ),
    ("incident", "INCIDENT"),
    ("month", "MONTH"),
)

IDENTITY_HEADERS = tuple(
    header
    for _, header in IDENTITY_FIELDS
)

CONSOLIDATION_IDENTITY_FIELDS = {
    "detailed": IDENTITY_FIELDS,
    "year": (
        ("year", "YEAR"),
    ),
    "region": (
        ("region", "REGION / RFO"),
    ),
    "province": (
        ("region", "REGION / RFO"),
        ("province", "PROVINCE"),
    ),
    "incident": (
        ("year", "YEAR"),
        (
            "hazard_category",
            "HAZARD",
        ),
        ("incident", "INCIDENT"),
        ("month", "MONTH"),
    ),
}

CONSOLIDATED_SHEET_NAMES = {
    "detailed": "Consolidated Report",
    "year": "Year Summary",
    "region": "Regional Summary",
    "province": "Provincial Summary",
    "incident": "Incident Summary",
}

IDENTITY_COLUMN_WIDTHS = {
    "year": 10,
    "region": 24,
    "province": 22,
    "hazard_category": 20,
    "incident": 38,
    "month": 12,
}

SHEET_NAME_OVERRIDES = {
    "AMEF": "Infrastructure & Equipment",
    "Livestock and Poultry": "Livestock & Poultry",
}

NUMBER_FORMATS = {
    "people": "#,##0",
    "heads": "#,##0",
    "PHP": "#,##0.00;[Red]-#,##0.00",
    "ha": "#,##0.00;[Red]-#,##0.00",
    "MT": "#,##0.00;[Red]-#,##0.00",
}

SAMPLE_HEADER_PALETTE = {
    "DEFAULT": {
        "fill": "#D9D9D9",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "TOTAL": {
        "fill": "#FF9900",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "Rice": {
        "fill": "#006633",
        "font": "#FFFFFF",
        "metric_font": "#000000",
    },
    "CMD_CROPS_RICE": {
        "fill": "#006633",
        "font": "#FFFFFF",
        "metric_font": "#000000",
    },
    "Corn": {
        "fill": "#FFAD00",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "High Value Crops": {
        "fill": "#8657A6",
        "font": "#FFFFFF",
        "metric_font": "#000000",
    },
    "CMD_CROPS_CORN": {
        "fill": "#FFAD00",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_CORN_YELLOW": {
        "fill": "#FFF5DD",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_CORN_WHITE": {
        "fill": "#FFF5DD",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "Cassava": {
        "fill": "#C56A46",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_CASSAVA": {
        "fill": "#C56A46",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_HVC_VEGETABLES": {
        "fill": "#55A85C",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_HVC_FRUITS": {
        "fill": "#D65F45",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_HVC_MANGO": {
        "fill": "#E3A21A",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_HVC_BANANA": {
        "fill": "#D9C52A",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_HVC_PLANTATION": {
        "fill": "#A96855",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_HVC_ROOT": {
        "fill": "#497E83",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "CMD_CROPS_HVC_ORNAMENTAL": {
        "fill": "#B05A91",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "Fiber Crops": {
        "fill": "#9A5A48",
        "font": "#FFFFFF",
        "metric_font": "#000000",
    },
    "Coconut": {
        "fill": "#435D36",
        "font": "#FFFFFF",
        "metric_font": "#000000",
    },
    "Sugarcane": {
        "fill": "#86A83E",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "Tobacco": {
        "fill": "#8A541C",
        "font": "#FFFFFF",
        "metric_font": "#000000",
    },
    "Fisheries": {
        "fill": "#3578B8",
        "font": "#FFFFFF",
        "metric_font": "#000000",
    },
    "Livestock and Poultry": {
        "fill": "#D07A32",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "AMEF": {
        "fill": "#4F8F94",
        "font": "#000000",
        "metric_font": "#000000",
    },
    "Others": {
        "fill": "#8D9892",
        "font": "#000000",
        "metric_font": "#000000",
    },
}


def _has_redundant_single_commodity_header(group):
    """Whether a group and its only commodity share one display label."""

    commodities = group.get("commodities", ())

    return (
        len(commodities) == 1
        and commodities[0].get("label")
        == group.get("label")
    )

# Reference keys use stable IDs while group headers use their display labels.
# Keep both paths on the same FARM commodity color so an Excel sheet never
# falls back to the generic gray header for a valid commodity.
_FARM_COMMODITY_HEADER_ALIASES = {
    "CMD_CROPS_HVC": "High Value Crops",
    "CMD_CROPS_FIBER": "Fiber Crops",
    "CMD_CROPS_COCONUT": "Coconut",
    "CMD_CROPS_SUGARCANE": "Sugarcane",
    "CMD_CROPS_TOBACCO": "Tobacco",
    "CMD_FISHERIES": "Fisheries",
    "CMD_FISHERIES_PRODUCE": "Fisheries",
    "CMD_FISHERIES_GEAR_FACILITY_EQUIPMENT": "Fisheries",
    "CMD_LIVESTOCK_POULTRY": "Livestock and Poultry",
    "CMD_AMEF": "AMEF",
    "CMD_AMEF_IRRIGATION": "AMEF",
    "CMD_AMEF_IRRIGATION_NIS": "AMEF",
    "CMD_AMEF_IRRIGATION_SSIS": "AMEF",
    "CMD_AMEF_FACILITIES": "AMEF",
    "CMD_AMEF_MACHINERIES_EQUIPMENT": "AMEF",
}

SAMPLE_HEADER_PALETTE.update(
    {
        alias: dict(SAMPLE_HEADER_PALETTE[palette_key])
        for alias, palette_key
        in _FARM_COMMODITY_HEADER_ALIASES.items()
    }
)


def _safe_sheet_name(
    raw_name: str,
    used_names: set[str],
) -> str:
    translated = SHEET_NAME_OVERRIDES.get(
        raw_name,
        raw_name,
    )

    forbidden = set("[]:*?/\\")

    cleaned = "".join(
        "_" if character in forbidden
        else character
        for character in translated
    ).strip("' ")

    cleaned = cleaned or "Sheet"
    base = cleaned[:31]
    candidate = base
    suffix = 2

    while candidate.casefold() in used_names:
        rendered_suffix = f" {suffix}"
        candidate = (
            base[
                : 31 - len(rendered_suffix)
            ]
            + rendered_suffix
        )
        suffix += 1

    used_names.add(candidate.casefold())

    return candidate


def _add_formats(workbook):
    return {
        "identity_header": workbook.add_format(
            {
                "bold": True,
                "font_name": "Arial",
                "font_size": 9,
                "font_color": "#000000",
                "bg_color": "#CFE2F3",
                "border": 1,
                "border_color": "#000000",
                "align": "center",
                "valign": "vcenter",
                "text_wrap": True,
            }
        ),
        "group_header": workbook.add_format(
            {
                "bold": True,
                "font_color": "#FFFFFF",
                "bg_color": "#166534",
                "border": 1,
                "border_color": "#FFFFFF",
                "align": "center",
                "valign": "vcenter",
                "text_wrap": True,
            }
        ),
        "commodity_header": workbook.add_format(
            {
                "bold": True,
                "font_color": "#FFFFFF",
                "bg_color": "#15803D",
                "border": 1,
                "border_color": "#FFFFFF",
                "align": "center",
                "valign": "vcenter",
                "text_wrap": True,
            }
        ),
        "metric_header": workbook.add_format(
            {
                "bold": True,
                "font_color": "#FFFFFF",
                "bg_color": "#3F3F46",
                "border": 1,
                "border_color": "#FFFFFF",
                "align": "center",
                "valign": "vcenter",
                "text_wrap": True,
            }
        ),
        "text": workbook.add_format(
            {
                "border": 1,
                "border_color": "#E4E4E7",
                "valign": "top",
            }
        ),
        "integer": workbook.add_format(
            {
                "border": 1,
                "border_color": "#E4E4E7",
                "num_format": "#,##0",
            }
        ),
        "year": workbook.add_format(
            {
                "border": 1,
                "border_color": "#E4E4E7",
                "num_format": "0",
            }
        ),
        "decimal": workbook.add_format(
            {
                "border": 1,
                "border_color": "#E4E4E7",
                "num_format": (
                    "#,##0.00;"
                    "[Red]-#,##0.00"
                ),
            }
        ),
        "currency": workbook.add_format(
            {
                "border": 1,
                "border_color": "#E4E4E7",
                "num_format": (
                    "#,##0.00;"
                    "[Red]-#,##0.00"
                ),
            }
        ),
        "sample_header_cache": {},
    }


def _sample_header_format(
    workbook,
    formats,
    key,
    level,
):
    cache = formats[
        "sample_header_cache"
    ]
    cache_key = (key, level)

    if cache_key in cache:
        return cache[cache_key]

    palette = SAMPLE_HEADER_PALETTE.get(
        key,
        SAMPLE_HEADER_PALETTE["DEFAULT"],
    )

    properties = {
        "bold": True,
        "font_name": "Arial",
        "font_size": 9,
        "border": 1,
        "border_color": "#000000",
        "align": "center",
        "valign": "vcenter",
        "text_wrap": True,
    }

    if level in {
        "group",
        "commodity",
    }:
        properties.update(
            {
                "bg_color": palette["fill"],
                "font_color": palette["font"],
            }
        )
    elif level == "metric":
        properties.update(
            {
                "bg_color": "#FFFFFF",
                "font_color": (
                    palette["metric_font"]
                ),
            }
        )
    else:
        raise ValueError(
            "Unsupported sample header level: "
            f"{level}"
        )

    cache[cache_key] = (
        workbook.add_format(properties)
    )

    return cache[cache_key]


def _metric_header_label(metric):
    unit = metric.get("unit")

    if not unit:
        return metric["label"]

    return f"{metric['label']} ({unit})"


def _number_format_for_metric(
    formats,
    metric,
):
    if metric["unit"] == "PHP":
        return formats["currency"]

    if metric["is_count"]:
        return formats["integer"]

    return formats["decimal"]


def _write_metric_value(
    worksheet,
    row,
    column,
    value,
    metric,
    formats,
):
    if value is None:
        # Preserve the worksheet grid for unreported metrics.  A skipped
        # write leaves the cell without a style in the XLSX XML, which makes
        # blank/no-data cells appear to have no boundary in Excel.
        worksheet.write_blank(
            row,
            column,
            None,
            _number_format_for_metric(
                formats,
                metric,
            ),
        )
        return

    if isinstance(value, Decimal):
        numeric_value = float(value)
    else:
        numeric_value = value

    worksheet.write_number(
        row,
        column,
        numeric_value,
        _number_format_for_metric(
            formats,
            metric,
        ),
    )
