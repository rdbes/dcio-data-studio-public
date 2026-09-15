"""Single-incident bulletin composition using the studio's reporting rules."""
from collections import defaultdict
from decimal import Decimal

from django.db.models import Count, Sum

from reports.analytics import commodity_group_from_row, format_exact_value
from reports.analytics.province_map import build_province_reporting_area_totals
from reports.dashboard.aggregation import METRIC_FIELDS, nullable_sum
from reports.location_ordering import region_sort_key, short_region_label
from reports.pipeline.common import COMMODITY_GROUPS
from reports.pipeline.transformation import (
    TransformError,
    build_historical_residual_records,
    parse_group_metrics,
)
from reports.pipeline.validation import (
    get_metric_columns,
    parse_metric_values,
    run_aggregate_checks,
)

BULLETIN_METRICS = {
    **METRIC_FIELDS,
    "partial": "area_partially_damaged_ha",
    "total": "area_totally_damaged_ha",
    "heads": "affected_livestock_poultry_heads_count",
}
LABELS = {
    "affected_farmers": ("Farmers & Fisherfolk Affected", ""),
    "area_affected": ("Area Affected", " ha"),
    "volume_loss": ("Volume Loss", " MT"),
    "value_loss": ("Value Loss", ""),
    "partial": ("Partially Damaged", " ha"),
    "total": ("Totally Damaged", " ha"),
    "heads": ("No. of Heads", ""),
}

EXTERNAL_GROUP_LABELS = {
    "RICE": "Rice",
    "Y_CORN": "Corn",
    "W_CORN": "Corn",
    "CASS": "Cassava",
    "VEG": "High Value Crops",
    "FRU": "High Value Crops",
    "MANGO": "High Value Crops",
    "BNNA": "High Value Crops",
    "COMM": "High Value Crops",
    "ROOT": "High Value Crops",
    "ORNA": "High Value Crops",
    "FIBE": "Fiber Crops",
    "COCO": "Coconut",
    "SUGR": "Sugarcane",
    "TBCO": "Tobacco",
    "FISH_A": "Fisheries",
    "FISH_B": "Fisheries",
    "LIVE": "Livestock and Poultry",
    "IRRIG_SSIS": "AMEF",
    "IRRIG_NIA": "AMEF",
    "INFRA": "AMEF",
    "EQP": "AMEF",
}

# The bulletin follows the order used by the reference infographic.  AMEF is
# one page, with its source commodity rows rolled into these three cards.
BULLETIN_PAGE_ORDER = (
    "Rice",
    "Corn",
    "Cassava",
    "High Value Crops",
    "Livestock and Poultry",
    "Fisheries",
    "AMEF",
)
AMEF_BREAKDOWN_ORDER = (
    "Irrigation Facilities",
    "Farm Structures",
    "Machineries & Equipment",
)
AMEF_COMMODITY_KEY_LABELS = {
    "CMD_AMEF_IRRIGATION_NIS": "Irrigation Facilities",
    "CMD_AMEF_IRRIGATION_SSIS": "Irrigation Facilities",
    "CMD_AMEF_FACILITIES": "Farm Structures",
    "CMD_AMEF_MACHINERIES_EQUIPMENT": "Machineries & Equipment",
}
AMEF_EXTERNAL_GROUP_LABELS = {
    "IRRIG_SSIS": "Irrigation Facilities",
    "IRRIG_NIA": "Irrigation Facilities",
    "INFRA": "Farm Structures",
    "EQP": "Machineries & Equipment",
}

# Table pages intentionally use the same corrected commodity accents as the
# infographic cards. The CSS maps these keys to a light header fill and the
# matching dark text so the dense tables remain readable at preview scale.
TABLE_ACCENT_KEYS = {
    "TOTAL": "total",
    "Rice": "rice",
    "Corn": "corn",
    "Cassava": "cassava",
    "High Value Crops": "high-value-crops",
    "Fisheries": "fisheries",
    "Livestock and Poultry": "livestock",
    "AMEF": "amef",
}

# Keep the table detail order aligned with the infographic commodity pages.
TABLE_PAGE_ORDER = (
    "TOTAL", "Rice", "Corn", "Cassava", "High Value Crops",
    "Livestock and Poultry", "Fisheries", "AMEF",
)
TABLE_DISPLAY_LABELS = {
    "Fisheries": "Fisheries and Aquatic Resources",
}
# A landscape table page has room for roughly this many compact body rows
# after its grouped header. Pagination is deliberately region-aware: a region
# subtotal and all of its provinces are kept together even when that block is
# larger than the normal page allowance.
TABLE_REGION_PAGE_ROW_LIMIT = 27
REGION_TABLES_PER_PAGE = 2


def _page_sort_key(label):
    normalized = str(label or "").casefold()
    try:
        return (BULLETIN_PAGE_ORDER.index(next(
            item for item in BULLETIN_PAGE_ORDER if item.casefold() == normalized
        )), "")
    except StopIteration:
        return (len(BULLETIN_PAGE_ORDER), normalized)


def _table_display_label(label):
    return TABLE_DISPLAY_LABELS.get(label, label)


def _region_display_label(value):
    raw = str(value or "").strip()
    if "(" in raw and raw.endswith(")"):
        prefix, suffix = raw.split("(", 1)
        prefix = prefix.strip()
        suffix = suffix[:-1].strip()
        if prefix and suffix:
            return f"{prefix} - {suffix}"
    return short_region_label(raw)


def _amef_breakdown_label(row, *, external=False):
    if external:
        return AMEF_EXTERNAL_GROUP_LABELS.get(row.get("source_group"))
    key = str(row.get("commodity_key_id") or "")
    if key in AMEF_COMMODITY_KEY_LABELS:
        return AMEF_COMMODITY_KEY_LABELS[key]
    level_2 = str(row.get("commodity_key__level_2_group") or "").casefold()
    if level_2 in {"irrigation systems", "irrigation facilities"}:
        return "Irrigation Facilities"
    if level_2 in {"facilities", "farm structures"}:
        return "Farm Structures"
    if level_2 in {"machineries and equipment", "machineries & equipment"}:
        return "Machineries & Equipment"
    return None


def _amef_breakdown(rows, *, external=False):
    grouped = defaultdict(list)
    for row in rows:
        label = _amef_breakdown_label(row, external=external)
        if label:
            grouped[label].append(row)

    breakdown = []
    for label in AMEF_BREAKDOWN_ORDER:
        source_rows = grouped.get(label, [])
        totals = {key: nullable_sum(row.get(key) for row in source_rows) for key in BULLETIN_METRICS}
        counts = {key: sum(row.get(f"{key}_count", row.get(key) is not None) for row in source_rows)
                  for key in BULLETIN_METRICS}
        card = metric_cards(totals, counts, sum(row.get("records", 1) for row in source_rows), ["value_loss"])[0]
        breakdown.append({"label": label, "card": card})
    return breakdown


def metric_cards(totals, counts, record_count, keys):
    cards = []
    icons = {"affected_farmers": "user-group", "area_affected": "location-dot",
             "volume_loss": "wheat-awn", "value_loss": "coins", "heads": "cow"}
    for key in keys:
        value = totals[key]
        prefix = "₱" if key == "value_loss" else ""
        unit = LABELS[key][1].strip()
        display = "Not reported" if value is None else format_exact_value(value, prefix=prefix, suffix=LABELS[key][1])
        number = "Not reported"
        if value is not None:
            if key == "value_loss":
                # Bulletin currency keeps two decimals at every scale, as in the reference.
                scale, unit = next(((scale, label) for scale, label in (
                    (Decimal("1e12"), "T"), (Decimal("1e9"), "B"),
                    (Decimal("1e6"), "M"), (Decimal("1e3"), "K"),
                ) if abs(value) >= scale), (Decimal(1), ""))
                number = f"₱{value / scale:,.2f}"
            else:
                number = f"{value:,.0f}"
        cards.append({
            "key": key, "label": LABELS[key][0], "display": display, "exact_value": value,
            "number": number, "unit": unit.upper() if value is not None else "",
            "icon": icons.get(key, "chart-pie"),
            "percentage": value / totals["area_affected"] * 100
            if key in ("partial", "total") and value is not None
            and totals.get("area_affected") is not None and totals["area_affected"] > 0 else None,
            "incomplete": 0 < counts[key] < record_count,
        })
    return cards


def _table_columns(label):
    """Return the grouped column definition used by the reference tables."""
    if label == "Fisheries":
        return {
            "kind": "fisheries",
            "title": "FISHERIES AND AQUATIC RESOURCES",
            "header_rows": [
                [{"label": "REGION/\nPROVINCE", "rowspan": 3},
                 {"label": "FISHERIES AND AQUATIC RESOURCES", "colspan": 7}],
                [{"label": "PRODUCE", "colspan": 3},
                 {"label": "GEARS/PARAPHERNALIA,\nFACILITY & EQUIPMENT", "colspan": 2},
                 {"label": "GRAND TOTAL (PHP)", "colspan": 2}],
                [{"key": "produce_affected_farmers", "label": "No. of\nFisherfolk\nAffected"},
                 {"key": "produce_volume_loss", "label": "Volume Loss\n(MT)"},
                 {"key": "produce_value_loss", "label": "Estimated\nValue (PhP)"},
                 {"key": "gear_affected_farmers", "label": "No. of\nFisherfolk\nAffected"},
                 {"key": "gear_value_loss", "label": "Estimated\nValue (PhP)"},
                 {"key": "grand_affected_farmers", "label": "Total No. of\nFisherfolk\nAffected"},
                 {"key": "grand_value_loss", "label": "Total\nEstimated\nValue (PHP)"}],
            ],
        }
    if label == "Livestock and Poultry":
        return {
            "kind": "livestock",
            "title": "LIVESTOCK AND POULTRY",
            "header_rows": [
                [{"label": "REGION/\nPROVINCE", "rowspan": 2},
                 {"label": "LIVESTOCK AND POULTRY", "colspan": 3}],
                [{"key": "affected_farmers", "label": "NO. OF\nFARMERS\nAFFECTED"},
                 {"key": "heads", "label": "NO. OF HEAD"},
                 {"key": "value_loss", "label": "ESTIMATED\nVALUE (PHP)"}],
            ],
        }
    if label == "AMEF":
        return {
            "kind": "amef",
            "title": "AGRICULTURAL INFRASTRUCTURES, MACHINERIES, AND EQUIPMENT",
            "header_rows": [
                [{"label": "REGION/\nPROVINCE", "rowspan": 3},
                 {"label": "AGRICULTURAL INFRASTRUCTURES, MACHINERIES, AND EQUIPMENT", "colspan": 6}],
                [{"label": "IRRIGATION SYSTEMS", "subtitle": "Small-scale Irrigation Systems (SSIS)", "colspan": 2},
                 {"label": "FARM STRUCTURES", "colspan": 2},
                 {"label": "MACHINERIES AND\nEQUIPMENT", "colspan": 2}],
                [{"key": "irrigation_affected_farmers", "label": "No. of Affected\nFarmers"},
                 {"key": "irrigation_value_loss", "label": "Estimated\nValue (PhP)"},
                 {"key": "farm_affected_farmers", "label": "No. of Affected\nFarmers"},
                 {"key": "farm_value_loss", "label": "Estimated\nValue (PhP)"},
                 {"key": "equipment_affected_farmers", "label": "No. of Affected\nFarmers"},
                 {"key": "equipment_value_loss", "label": "Estimated\nValue (PhP)"}],
            ],
        }
    if label == "TOTAL":
        title = "ALL COMMODITY"
    else:
        title = str(label).upper()
    farmer_header = (
        "NO. OF\nFARMERS/\nFISHERFOLK\nAFFECTED"
        if label == "TOTAL" else "NO. OF\nFARMERS\nAFFECTED"
    )
    return {
        "kind": "total" if label == "TOTAL" else "standard",
        "title": title,
        "header_rows": [
            [{"label": "REGION/\nPROVINCE", "rowspan": 3},
             {"label": title, "colspan": 6}],
            [{"key": "affected_farmers", "label": farmer_header, "rowspan": 2},
             {"label": "AREA AFFECTED (HA)", "colspan": 3},
             {"key": "volume_loss", "label": "VOLUME LOSS\n(MT)", "rowspan": 2},
             {"key": "value_loss", "label": "VALUE LOSS\n(PHP)", "rowspan": 2}],
            [{"key": "total", "label": "TOTALLY\nDAMAGED"},
             {"key": "partial", "label": "PARTIALLY\nDAMAGED"},
             {"key": "area_affected", "label": "TOTAL"}],
        ],
    }


def _table_metric_sum(records, key):
    values = [record.get(key) for record in records if record.get(key) is not None]
    return sum(values, Decimal("0")) if values else None


def _table_number(value, key):
    """Format compact table cells, matching the reference's dash for zero."""
    if value in (None, 0, Decimal("0")):
        return "-"
    if key in {"value_loss", "produce_value_loss", "gear_value_loss", "grand_value_loss",
               "irrigation_value_loss", "farm_value_loss", "equipment_value_loss"}:
        return f"{value:,.0f}"
    if key in {"affected_farmers", "heads", "produce_affected_farmers", "gear_affected_farmers",
               "grand_affected_farmers", "irrigation_affected_farmers", "farm_affected_farmers",
               "equipment_affected_farmers"}:
        return f"{value:,.0f}"
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def _summary_schema():
    return {
        "kind": "summary",
        "title": "SUMMARY",
        "header_rows": [
            [{"label": "COMMODITY", "rowspan": 2},
             {"key": "affected_farmers", "label": "NO. OF\nFARMERS\nAFFECTED", "rowspan": 2},
             {"label": "AREA AFFECTED (HA)", "colspan": 3},
             {"key": "volume_loss", "label": "VOLUME\nLOSS (MT)", "rowspan": 2},
             {"key": "value_loss", "label": "VALUE LOSS\n(PhP)", "rowspan": 2}],
            [{"key": "total", "label": "Totally\nDamaged"},
             {"key": "partial", "label": "Partially\nDamaged"},
             {"key": "area_affected", "label": "Total"}],
        ],
        "leaf_order": ("affected_farmers", "total", "partial", "area_affected", "volume_loss", "value_loss"),
    }


def _summary_rows(records):
    production_groups = {
        "High Value Crops", "Fiber Crops", "Coconut", "Sugarcane", "Tobacco",
    }
    definitions = [
        ("PRODUCTION LOSSES", [
            ("RICE", lambda record: record["group"] == "Rice"),
            ("CORN", lambda record: record["group"] == "Corn"),
            ("CASSAVA", lambda record: record["group"] == "Cassava"),
            ("HIGH VALUE CROPS", lambda record: record["group"] in production_groups),
            ("FISHERIES (PRODUCE)", lambda record: record["group"] == "Fisheries" and _table_subgroup(record, "Fisheries") == "produce"),
            ("LIVESTOCK AND POULTRY", lambda record: record["group"] == "Livestock and Poultry"),
        ]),
        ("AGRICULTURAL INFRASTRUCTURES / EQUIPMENT", [
            ("FISHERIES (FACILITIES & EQUIPMENT)", lambda record: record["group"] == "Fisheries" and _table_subgroup(record, "Fisheries") == "gear"),
            ("INFRASTRUCTURE (IRRIGATION FACILITIES)", lambda record: record["group"] == "AMEF" and _table_subgroup(record, "AMEF") == "irrigation"),
            ("INFRASTRUCTURE (FARM STRUCTURES)", lambda record: record["group"] == "AMEF" and _table_subgroup(record, "AMEF") == "farm"),
            ("MACHINERIES AND EQUIPMENT", lambda record: record["group"] == "AMEF" and _table_subgroup(record, "AMEF") == "equipment"),
        ]),
    ]
    rows = []
    for section, entries in definitions:
        section_rows = []
        for label, predicate in entries:
            source = [record for record in records if predicate(record)]
            if not source:
                continue
            cells = {
                key: _table_metric_sum(source, key)
                for key in ("affected_farmers", "total", "partial", "area_affected", "volume_loss", "value_loss")
            }
            # Fisheries facilities, livestock, and infrastructure have no
            # crop-area or production-volume fields in the source schema.
            if label in {
                "FISHERIES (PRODUCE)", "FISHERIES (FACILITIES & EQUIPMENT)",
                "LIVESTOCK & POULTRY", "INFRASTRUCTURE (IRRIGATION FACILITIES)",
                "INFRASTRUCTURE (FARM STRUCTURES)", "MACHINERIES AND EQUIPMENT",
            }:
                cells["total"] = cells["partial"] = cells["area_affected"] = None
            if label != "FISHERIES (PRODUCE)" and label != "RICE" and label != "CORN" and label != "CASSAVA" and label != "HIGH VALUE CROPS":
                cells["volume_loss"] = None
            section_rows.append({
                "kind": "summary",
                "label": label,
                "cells": cells,
            })
        if section_rows:
            rows.append({"kind": "section", "label": section, "display_cells": []})
            rows.extend(section_rows)
    schema = _summary_schema()
    grand_cells = {
        key: _table_metric_sum(records, key)
        for key in schema["leaf_order"]
    }
    rows.append({"kind": "grand", "label": "GRAND TOTAL", "cells": grand_cells})
    for row in rows:
        if row["kind"] == "section":
            continue
        row["display_cells"] = [
            "" if row["cells"].get(key) is None else _table_number(row["cells"].get(key), key)
            for key in schema["leaf_order"]
        ]
    return rows


def _summary_table_page(records):
    schema = _summary_schema()
    cell_by_key = {
        cell["key"]: cell
        for header_row in schema["header_rows"]
        for cell in header_row
        if cell.get("key")
    }
    return {
        "label": "Summary",
        "nav_label": "Summary",
        "title": schema["title"],
        "kind": schema["kind"],
        "accent_key": "summary",
        "header_rows": schema["header_rows"],
        "leaf_columns": [cell_by_key[key] for key in schema["leaf_order"]],
        "rows": _summary_rows(records),
    }


def _region_table_schema():
    """Return the compact commodity-by-region table layout."""
    return {
        "kind": "summary",
        "title": "REGION COMMODITY SUMMARY",
        "header_rows": [
            [{"label": "COMMODITY", "rowspan": 2},
             {"key": "affected_farmers", "label": "NO. OF\nFARMERS AND\nFISHERFOLK\nAFFECTED", "rowspan": 2},
             {"label": "AREA AFFECTED (HA)", "colspan": 3},
             {"label": "PRODUCTION LOSS", "colspan": 2}],
            [{"key": "total", "label": "Totally\nDamaged"},
             {"key": "partial", "label": "Partially\nDamaged"},
             {"key": "area_affected", "label": "Total"},
             {"key": "volume_loss", "label": "Volume (MT)"},
             {"key": "value_loss", "label": "Value (PHP '000)"}],
        ],
        "leaf_order": ("affected_farmers", "total", "partial", "area_affected", "volume_loss", "value_loss"),
    }


def _region_table_cells(records, label):
    cells = {
        key: _table_metric_sum(records, key)
        for key in ("affected_farmers", "total", "partial", "area_affected", "volume_loss", "value_loss")
    }
    if label in {"Fisheries", "Livestock and Poultry", "AMEF"}:
        cells["total"] = cells["partial"] = cells["area_affected"] = None
    if label == "Fisheries":
        cells["volume_loss"] = _table_metric_sum(
            [record for record in records if _table_subgroup(record, label) == "produce"],
            "volume_loss",
        )
    elif label in {"Livestock and Poultry", "AMEF"}:
        cells["volume_loss"] = None
    return cells


def _region_table_number(value, key):
    """Format regional value-loss cells in the reference's PHP-thousands unit."""
    if key == "value_loss" and value not in (None, 0, Decimal("0")):
        value = value / Decimal("1000")
        return f"{value:,.2f}".rstrip("0").rstrip(".")
    return _table_number(value, key)


def _region_table_pages(records):
    if not records:
        return []
    schema = _region_table_schema()
    regions = sorted(
        {short_region_label(record.get("region")) for record in records},
        key=region_sort_key,
    )
    region_names = {}
    for record in records:
        short_name = short_region_label(record.get("region"))
        display_name = _region_display_label(record.get("region"))
        if short_name not in region_names or " - " in display_name:
            region_names[short_name] = display_name
    groups = {record["group"] for record in records}
    ordered_groups = [label for label in BULLETIN_PAGE_ORDER if label in groups]
    ordered_groups.extend(sorted(groups - set(ordered_groups), key=_page_sort_key))
    pages = []
    for offset in range(0, len(regions), REGION_TABLES_PER_PAGE):
        region_batch = regions[offset:offset + REGION_TABLES_PER_PAGE]
        display_regions = [region_names.get(region, region) for region in region_batch]
        region_tables = []
        for region, display_region in zip(region_batch, display_regions):
            regional_records = [
                record for record in records if short_region_label(record.get("region")) == region
            ]
            rows = [{
                "kind": "grand",
                "label": "TOTAL",
                "cells": _region_table_cells(regional_records, "TOTAL"),
            }]
            for label in ordered_groups:
                source = [record for record in regional_records if record["group"] == label]
                if source:
                    rows.append({
                        "kind": "summary",
                        "label": str(_table_display_label(label)).upper(),
                        "cells": _region_table_cells(source, label),
                    })
            for row in rows:
                row["display_cells"] = [
                    "" if row["cells"].get(key) is None else _region_table_number(row["cells"].get(key), key)
                    for key in schema["leaf_order"]
                ]
            region_tables.append({
                "label": display_region,
                "nav_label": region,
                "title": display_region,
                "kind": schema["kind"],
                "accent_key": "region-summary",
                "header_rows": schema["header_rows"],
                "leaf_columns": [
                    cell for header_row in schema["header_rows"] for cell in header_row if cell.get("key")
                ],
                "rows": rows,
            })
        combined_rows = []
        for region_table in region_tables:
            combined_rows.append({
                "kind": "section",
                "label": region_table["title"],
                "display_cells": [],
            })
            combined_rows.extend(region_table["rows"])
        pages.append({
            "label": " + ".join(display_regions),
            "nav_label": " + ".join(region_batch),
            "title": " + ".join(display_regions),
            "kind": schema["kind"],
            "accent_key": "region-summary",
            "header_rows": schema["header_rows"],
            "leaf_columns": [
                cell for header_row in schema["header_rows"] for cell in header_row if cell.get("key")
            ],
            "rows": combined_rows,
            "region_tables": region_tables,
        })
    return pages


def _paginate_table_rows(rows, *, limit=TABLE_REGION_PAGE_ROW_LIMIT):
    """Split detail rows without separating a region from its provinces."""
    if len(rows) <= limit + 1:
        return [rows]
    total = rows[:1]
    blocks = []
    current = []
    for row in rows[1:]:
        if row["kind"] == "region" and current:
            blocks.append(current)
            current = []
        current.append(row)
    if current:
        blocks.append(current)

    pages = []
    current = list(total)
    for block in blocks:
        if len(current) > 1 and len(current) + len(block) > limit + 1:
            pages.append(current)
            current = list(total)
        current.extend(block)
    if len(current) > 1 or not pages:
        pages.append(current)
    return pages


def _table_subgroup(record, group):
    source_group = str(record.get("source_group") or "")
    commodity_key = str(record.get("commodity_key_id") or "")
    if group == "Fisheries":
        if source_group == "FISH_A" or commodity_key == "CMD_FISHERIES_PRODUCE":
            return "produce"
        if source_group == "FISH_B" or commodity_key == "CMD_FISHERIES_GEAR_FACILITY_EQUIPMENT":
            return "gear"
        return None
    if group == "AMEF":
        if source_group in {"IRRIG_SSIS", "IRRIG_NIA"} or commodity_key in {
            "CMD_AMEF_IRRIGATION_NIS", "CMD_AMEF_IRRIGATION_SSIS",
        }:
            return "irrigation"
        if source_group == "INFRA" or commodity_key == "CMD_AMEF_FACILITIES":
            return "farm"
        if source_group == "EQP" or commodity_key == "CMD_AMEF_MACHINERIES_EQUIPMENT":
            return "equipment"
    return None


def _table_cell_values(records, label, schema):
    kind = schema["kind"]
    if kind in {"total", "standard"}:
        return {key: _table_metric_sum(records, key) for key in (
            "affected_farmers", "total", "partial", "area_affected", "volume_loss", "value_loss"
        )}
    if kind == "livestock":
        return {key: _table_metric_sum(records, key) for key in ("affected_farmers", "heads", "value_loss")}
    if kind == "fisheries":
        produce = [record for record in records if _table_subgroup(record, label) == "produce"]
        gear = [record for record in records if _table_subgroup(record, label) == "gear"]
        return {
            "produce_affected_farmers": _table_metric_sum(produce, "affected_farmers"),
            "produce_volume_loss": _table_metric_sum(produce, "volume_loss"),
            "produce_value_loss": _table_metric_sum(produce, "value_loss"),
            "gear_affected_farmers": _table_metric_sum(gear, "affected_farmers"),
            "gear_value_loss": _table_metric_sum(gear, "value_loss"),
            "grand_affected_farmers": _table_metric_sum(records, "affected_farmers"),
            "grand_value_loss": _table_metric_sum(records, "value_loss"),
        }
    values = {}
    for prefix, subtype in (("irrigation", "irrigation"), ("farm", "farm"), ("equipment", "equipment")):
        subset = [record for record in records if _table_subgroup(record, label) == subtype]
        values[f"{prefix}_affected_farmers"] = _table_metric_sum(subset, "affected_farmers")
        values[f"{prefix}_value_loss"] = _table_metric_sum(subset, "value_loss")
    return values


def _table_rows(records, label, schema):
    """Build TOTAL, region subtotal, and province rows for one table page."""
    filtered = records if label == "TOTAL" else [record for record in records if record["group"] == label]
    locations = defaultdict(list)
    for record in filtered:
        region = short_region_label(record.get("region"))
        province = str(record.get("province") or "Unspecified Reporting Area").strip() or "Unspecified Reporting Area"
        locations[(region, province)].append(record)
    rows = []
    for region in sorted({key[0] for key in locations}, key=region_sort_key):
        province_keys = sorted((key for key in locations if key[0] == region), key=lambda key: key[1].casefold())
        region_records = [record for key in province_keys for record in locations[key]]
        rows.append({"kind": "region", "region": region, "province": "", "cells": _table_cell_values(region_records, label, schema)})
        for _, province in province_keys:
            province_records = locations[(region, province)]
            rows.append({"kind": "province", "region": region, "province": province, "cells": _table_cell_values(province_records, label, schema)})
    total_cells = _table_cell_values(filtered, label, schema)
    rows.insert(0, {"kind": "total", "region": "TOTAL", "province": "", "cells": total_cells})
    return rows


def _table_pages(records):
    if not records:
        return []
    labels = {record["group"] for record in records}
    ordered = [label for label in TABLE_PAGE_ORDER if label == "TOTAL" or label in labels]
    ordered.extend(sorted(labels - set(TABLE_PAGE_ORDER), key=_page_sort_key))
    pages = [_summary_table_page(records)]
    for label in ordered:
        schema = _table_columns(label)
        cell_by_key = {
            cell["key"]: cell
            for header_row in schema["header_rows"]
            for cell in header_row
            if cell.get("key")
        }
        leaf_order = {
            "total": ("affected_farmers", "total", "partial", "area_affected", "volume_loss", "value_loss"),
            "standard": ("affected_farmers", "total", "partial", "area_affected", "volume_loss", "value_loss"),
            "fisheries": ("produce_affected_farmers", "produce_volume_loss", "produce_value_loss",
                          "gear_affected_farmers", "gear_value_loss", "grand_affected_farmers", "grand_value_loss"),
            "livestock": ("affected_farmers", "heads", "value_loss"),
            "amef": ("irrigation_affected_farmers", "irrigation_value_loss", "farm_affected_farmers",
                     "farm_value_loss", "equipment_affected_farmers", "equipment_value_loss"),
        }[schema["kind"]]
        rows = _table_rows(records, label, schema)
        for row in rows:
            row["display_cells"] = [
                _table_number(row["cells"].get(key), key) for key in leaf_order
            ]
        row_pages = [rows] if schema["kind"] == "summary" else _paginate_table_rows(rows)
        for part_number, part_rows in enumerate(row_pages, start=1):
            pages.append({
            "label": _table_display_label(label),
            "nav_label": _table_display_label(label) if len(row_pages) == 1 else f"{_table_display_label(label)} ({part_number})",
                "title": schema["title"],
                "kind": schema["kind"],
                "accent_key": TABLE_ACCENT_KEYS.get(label, "total"),
                "header_rows": schema["header_rows"],
                "leaf_columns": [cell_by_key[key] for key in leaf_order],
                "rows": part_rows,
            })
    pages.extend(_region_table_pages(records))
    return pages


def _orm_table_records(reports):
    aggregates = {key: Sum(field) for key, field in BULLETIN_METRICS.items()}
    location_rows = reports.values(
        "location_psgc_key__region_name",
        "location_psgc_key__province_huc_name",
        "location_psgc_key__province_huc_key__location_name",
        "commodity_key_id", "commodity_key__main_sector",
        "commodity_key__level_2_group", "commodity_key__level_3_group",
    ).annotate(**aggregates, records=Count("pk")).order_by()
    source = []
    for row in location_rows:
        source.append({
            "group": commodity_group_from_row(row),
            "region": row.get("location_psgc_key__region_name"),
            "province": row.get("location_psgc_key__province_huc_name")
                or row.get("location_psgc_key__province_huc_key__location_name"),
            "commodity_key_id": row.get("commodity_key_id"),
            **{key: row.get(key) for key in BULLETIN_METRICS},
        })
    return source


def _external_table_records(group_rows):
    records = []
    for group, source_rows in group_rows.items():
        for row in source_rows:
            records.append({
                "group": group,
                "region": row.get("raw_region"),
                "province": row.get("raw_province"),
                "source_group": row.get("source_group"),
                **{key: row.get(key) for key in BULLETIN_METRICS},
            })
    return records


def build_bulletin(reports):
    aggregates = {key: Sum(field) for key, field in BULLETIN_METRICS.items()}
    aggregates.update({f"{key}_count": Count(field) for key, field in BULLETIN_METRICS.items()})
    rows = list(reports.values(
        "commodity_key_id", "commodity_key__main_sector",
        "commodity_key__level_2_group", "commodity_key__level_3_group",
    ).annotate(**aggregates, records=Count("pk")).order_by())
    groups = defaultdict(list)
    for row in rows:
        groups[commodity_group_from_row(row)].append(row)
    totals = {key: nullable_sum(row[key] for row in rows) for key in BULLETIN_METRICS}
    counts = {key: sum(row[f"{key}_count"] for row in rows) for key in BULLETIN_METRICS}
    pages = []
    for label, items in sorted(groups.items(), key=lambda item: _page_sort_key(item[0])):
        label = next((item for item in BULLETIN_PAGE_ORDER if item.casefold() == label.casefold()), label)
        group_totals = {key: nullable_sum(row[key] for row in items) for key in BULLETIN_METRICS}
        group_counts = {key: sum(row[f"{key}_count"] for row in items) for key in BULLETIN_METRICS}
        subset = reports.filter(commodity_key_id__in=[row["commodity_key_id"] for row in items])
        value = group_totals["value_loss"]
        share = value / totals["value_loss"] * 100 if value is not None and totals["value_loss"] and totals["value_loss"] > 0 else None
        breakdown = metric_cards(group_totals, group_counts, sum(row["records"] for row in items),
                                 [key for key in ("partial", "total") if group_counts[key]])
        pages.append({
            "label": label, "value": value, "share": share,
            "cards": metric_cards(group_totals, group_counts, sum(row["records"] for row in items),
                                  [key for key in ("area_affected", "volume_loss", "heads", "value_loss") if group_counts[key] or key == "value_loss"]),
            "breakdown": breakdown,
            "amef_breakdown": _amef_breakdown(items) if label == "AMEF" else [],
            "map": build_province_reporting_area_totals(subset, METRIC_FIELDS["value_loss"]),
        })
    _prepare_pages(pages)
    table_records = _orm_table_records(reports)
    return {
        "cards": metric_cards(totals, counts, sum(row["records"] for row in rows), METRIC_FIELDS),
        "breakdown": metric_cards(totals, counts, sum(row["records"] for row in rows),
                                  [key for key in ("partial", "total") if counts[key]]),
        "pages": pages,
        "table_pages": _table_pages(table_records),
        "composition": [{"label": page["label"], "metric_value": page["value"]} for page in pages],
        "has_reports": bool(rows),
    }


def _external_map(source_rows):
    """Aggregate temporary rows by their source location labels.

    The browser matches these labels to the bundled Province/HUC GeoJSON. This
    deliberately avoids the PSGC database and keeps the uploaded data
    temporary for the request only.
    """
    def location_label(source):
        return (str(source.get("raw_province") or "").strip()
                or str(source.get("raw_region") or "").strip()
                or "Unspecified reporting area")

    totals = {}
    for source in source_rows:
        label = location_label(source)
        area_key = label.casefold()
        area = totals.setdefault(area_key, {
            "province_name": label,
            "region_name": str(source.get("raw_region") or "Unspecified Region"),
            "short_region_label": str(source.get("raw_region") or "Unspecified Region"),
            "psgc_key": str(source.get("raw_psgc_key") or "").strip().upper(),
            "psgc_code": "", "correspondence_code": "",
            "metric_value": Decimal("0"), "record_count": 0,
            "affected_farmers": Decimal("0"), "area_affected": Decimal("0"),
            "volume_loss": Decimal("0"), "value_loss": Decimal("0"),
        })
        if not area["psgc_key"] and source.get("raw_psgc_key"):
            area["psgc_key"] = str(source["raw_psgc_key"]).strip().upper()
        area["record_count"] += 1
        for key in METRIC_FIELDS:
            area[key] += source.get(key) or Decimal("0")

    provinces = sorted(totals.values(), key=lambda item: item["value_loss"], reverse=True)
    for area in provinces:
        area["metric_value"] = area["value_loss"]
    return {"provinces": provinces, "max_metric_value": max((a["value_loss"] for a in provinces), default=0)}


def build_external_bulletin(preflight):
    """Build the Bulletin Checker payload from a validated CSV in memory."""
    positions = preflight.header_positions
    group_rows = defaultdict(list)
    errors = []
    for source_number, values in preflight.rows:
        row = {
            "source_row_number": source_number,
            **{name: values[index] for name, index in positions.items() if index < len(values)},
        }
        validation_issues = []
        parsed_values, invalid_fields = parse_metric_values(
            {**row, "stg_raw_key": source_number},
            get_metric_columns(),
            0,
            validation_issues,
        )
        run_aggregate_checks(
            {**row, "stg_raw_key": source_number},
            parsed_values,
            invalid_fields,
            0,
            validation_issues,
        )
        blocking = [issue for issue in validation_issues if issue.issue_level == "Error"]
        if blocking:
            errors.append(blocking[0].issue_message)
            continue
        for group_name, group in COMMODITY_GROUPS.items():
            try:
                metrics = parse_group_metrics(row, group_name, group)
            except TransformError as exc:
                errors.append(str(exc))
                continue
            if any(value not in (None, 0, Decimal("0")) for value in metrics.values()):
                normalized = {
                    key: metrics.get(field)
                    for key, field in BULLETIN_METRICS.items()
                }
                group_rows[EXTERNAL_GROUP_LABELS.get(group_name, group_name)].append(
                    {**normalized, "source_group": group_name,
                     "raw_region": row.get("raw_region"), "raw_province": row.get("raw_province"),
                     "raw_psgc_key": row.get("raw_psgc_key")}
                )
        for residual in build_historical_residual_records(row, source_number, "", ""):
            label = {"CMD_CROPS_CORN": "Corn", "CMD_CROPS_HVC": "High Value Crops",
                     "CMD_FISHERIES": "Fisheries", "CMD_AMEF": "AMEF"}[residual.commodity_key]
            group_rows[label].append({
                **{key: getattr(residual, field) for key, field in BULLETIN_METRICS.items()},
                "raw_region": row.get("raw_region"), "raw_province": row.get("raw_province"),
                "raw_psgc_key": row.get("raw_psgc_key"),
            })
    if errors:
        raise ValueError(errors[0])

    totals = {key: nullable_sum(row.get(key) for rows in group_rows.values() for row in rows) for key in BULLETIN_METRICS}
    counts = {key: sum(row.get(key) is not None for rows in group_rows.values() for row in rows) for key in BULLETIN_METRICS}
    pages = []
    for label, source_rows in sorted(group_rows.items(), key=lambda item: _page_sort_key(item[0])):
        label = next((item for item in BULLETIN_PAGE_ORDER if item.casefold() == label.casefold()), label)
        group_totals = {key: nullable_sum(row.get(key) for row in source_rows) for key in BULLETIN_METRICS}
        group_counts = {key: sum(row.get(key) is not None for row in source_rows) for key in BULLETIN_METRICS}
        cards = metric_cards(group_totals, group_counts, len(source_rows),
                             [key for key in ("area_affected", "volume_loss", "heads", "value_loss") if group_counts[key] or key == "value_loss"])
        breakdown = metric_cards(group_totals, group_counts, len(source_rows), [key for key in ("partial", "total") if group_counts[key]])
        for card in breakdown:
            area = group_totals["area_affected"]
            card["percentage"] = group_totals[card["key"]] / area * 100 if area and area > 0 else None
        pages.append({
            "label": label, "value": group_totals["value_loss"],
            "share": group_totals["value_loss"] / totals["value_loss"] * 100 if group_totals["value_loss"] is not None and totals["value_loss"] and totals["value_loss"] > 0 else None,
            "cards": cards, "breakdown": breakdown,
            "amef_breakdown": _amef_breakdown(source_rows, external=True) if label == "AMEF" else [],
            "map": _external_map(source_rows),
        })
    _prepare_pages(pages)
    table_records = _external_table_records(group_rows)
    return {
        "cards": metric_cards(totals, counts, len(preflight.rows), METRIC_FIELDS),
        "breakdown": metric_cards(totals, counts, len(preflight.rows), [key for key in ("partial", "total") if counts[key]]),
        "pages": pages,
        "table_pages": _table_pages(table_records),
        "composition": [{"label": page["label"], "metric_value": page["value"]} for page in pages],
        "has_reports": bool(group_rows),
        "source": "Temporary browser CSV", "source_year": preflight.detected_year,
    }


def _prepare_pages(pages):
    for page in pages:
        page["heading"] = {"Fisheries": "Fisheries & Aquatic Resources",
                           "Livestock and Poultry": "Livestock & Poultry",
                           "AMEF": "Infrastructure, Machinery & Equipment"}.get(page["label"], page["label"])
        if page["label"] == "Fisheries":
            page["cards"] = [card for card in page["cards"] if card["key"] == "value_loss"]
        if page["label"] == "AMEF":
            known = nullable_sum(Decimal(item["card"]["exact_value"]) for item in page["amef_breakdown"]
                                 if item["card"]["exact_value"] is not None) or Decimal(0)
            remainder = (page["value"] or Decimal(0)) - known
            page["unallocated"] = format_exact_value(remainder, prefix="₱") if remainder else ""
