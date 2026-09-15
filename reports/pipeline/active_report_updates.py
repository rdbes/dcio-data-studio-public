"""Comparison rules for cumulative updates to active damage reports."""

from collections.abc import Iterable, Mapping
from decimal import Decimal
from typing import Any

from .transformation import FINAL_METRIC_FIELDS

METRIC_LABELS = {
    "area_totally_damaged_ha": "Totally damaged area (ha)",
    "area_partially_damaged_ha": "Partially damaged area (ha)",
    "area_affected_ha": "Affected area (ha)",
    "production_loss_mt": "Production loss (MT)",
    "value_loss_php": "Value loss (PHP)",
    "affected_farmers_fisherfolk_count": "Affected farmers and fishers",
    "affected_livestock_poultry_heads_count": "Affected livestock and poultry",
}


def _value(record: Mapping[str, Any] | object, field_name: str) -> Decimal:
    """Return one normalized cumulative metric, treating blank as zero."""
    raw_value = (
        record.get(field_name)
        if isinstance(record, Mapping)
        else getattr(record, field_name, None)
    )
    return Decimal(str(raw_value or 0))


def _record_value(
    record: Mapping[str, Any] | object | None,
    field_name: str,
):
    if record is None:
        return None
    if isinstance(record, Mapping):
        return record.get(field_name)
    value = getattr(record, field_name, None)
    if value is not None:
        return value
    relation = getattr(record, "location_psgc_key", None)
    if field_name == "location_name" and relation is not None:
        return getattr(relation, "location_name", None)
    return None


def _grain(record: Mapping[str, Any] | object) -> tuple[str, str, str]:
    if isinstance(record, Mapping):
        return (
            str(record["incident_key"]),
            str(record["location_psgc_key"]),
            str(record["commodity_key"]),
        )
    values = []
    for field_name in ("incident_key", "location_psgc_key", "commodity_key"):
        relation_id = getattr(record, f"{field_name}_id", None)
        values.append(
            str(relation_id if relation_id is not None else getattr(record, field_name))
        )
    return values[0], values[1], values[2]


def _index_by_grain(
    records: Iterable[Mapping[str, Any] | object],
    *,
    record_set_label: str,
) -> dict[tuple[str, str, str], Mapping[str, Any] | object]:
    indexed: dict[tuple[str, str, str], Mapping[str, Any] | object] = {}
    for record in records:
        grain = _grain(record)
        if grain in indexed:
            raise ValueError(
                f"{record_set_label} contains duplicate location/commodity grain {grain}."
            )
        indexed[grain] = record
    return indexed


def compare_active_report_update(
    previous_records: Iterable[Mapping[str, Any] | object],
    updated_records: Iterable[Mapping[str, Any] | object],
) -> dict[str, object]:
    """Compare cumulative current-incident facts with a proposed replacement.

    A location/commodity grain may be newly reported, unchanged, or increased.
    A decrease in any cumulative metric and a missing previously reported grain
    are blocking findings. The returned data is deliberately presentation-ready
    so validation and the import preview use the exact same rules.
    """
    previous_by_grain = _index_by_grain(
        previous_records,
        record_set_label="Previous active report",
    )
    updated_by_grain = _index_by_grain(
        updated_records,
        record_set_label="Updated report",
    )

    metric_totals = {
        field_name: {
            "field_name": field_name,
            "label": METRIC_LABELS[field_name],
            "previous": Decimal("0"),
            "updated": Decimal("0"),
        }
        for field_name in FINAL_METRIC_FIELDS
    }
    for record in previous_by_grain.values():
        for field_name in FINAL_METRIC_FIELDS:
            metric_totals[field_name]["previous"] += _value(record, field_name)
    for record in updated_by_grain.values():
        for field_name in FINAL_METRIC_FIELDS:
            metric_totals[field_name]["updated"] += _value(record, field_name)

    findings: list[dict[str, object]] = []
    counts = {"new": 0, "unchanged": 0, "increased": 0, "decreased": 0, "missing": 0}
    for grain in sorted(set(previous_by_grain) | set(updated_by_grain)):
        previous = previous_by_grain.get(grain)
        updated = updated_by_grain.get(grain)
        metric_changes = []
        for field_name in FINAL_METRIC_FIELDS:
            previous_value = _value(previous, field_name) if previous else Decimal("0")
            updated_value = _value(updated, field_name) if updated else Decimal("0")
            metric_changes.append(
                {
                    "field_name": field_name,
                    "label": METRIC_LABELS[field_name],
                    "previous": previous_value,
                    "updated": updated_value,
                    "delta": updated_value - previous_value,
                }
            )

        if previous is None:
            status = "New"
            count_key = "new"
        elif updated is None:
            status = "Missing"
            count_key = "missing"
        else:
            has_decrease = any(change["delta"] < 0 for change in metric_changes)
            has_increase = any(change["delta"] > 0 for change in metric_changes)
            if has_decrease:
                status = "Decrease detected"
                count_key = "decreased"
            elif has_increase:
                status = "Increased"
                count_key = "increased"
            else:
                status = "Unchanged"
                count_key = "unchanged"

        counts[count_key] += 1
        findings.append(
            {
                "incident_key": grain[0],
                "location_psgc_key": grain[1],
                "commodity_key": grain[2],
                "location_name": (
                    _record_value(updated or previous, "location_name")
                    or grain[1]
                ),
                "source_row_number": _record_value(
                    updated or previous,
                    "source_row_number",
                ),
                "status": status,
                "is_blocking": count_key in {"decreased", "missing"},
                "metric_changes": metric_changes,
                "changed_metrics": [
                    change for change in metric_changes if change["delta"] != 0
                ],
                "decreased_metrics": [
                    change for change in metric_changes if change["delta"] < 0
                ],
            }
        )

    totals = []
    for field_name in FINAL_METRIC_FIELDS:
        total = metric_totals[field_name]
        total["delta"] = total["updated"] - total["previous"]
        totals.append(total)

    return {
        "findings": findings,
        "metric_totals": totals,
        "counts": counts,
        "has_blocking_findings": bool(counts["decreased"] or counts["missing"]),
    }
