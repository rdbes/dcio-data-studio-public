from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Iterable

from django.db import transaction

from reports.models import (
    ClimateLocation,
    ClimateLocationPsgc,
    DryDayNormal,
    RefPsgcLocation,
)

DRY_DAY_MONTH_FIELDS = (
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
)
DRY_DAY_EXPECTED_HEADER = (
    "published_label",
    "source_page",
    *DRY_DAY_MONTH_FIELDS,
)
DRY_DAY_EXPECTED_LOCATION_COUNT = 83
DRY_DAY_CLIMATOLOGY_START_YEAR = 1991
DRY_DAY_CLIMATOLOGY_END_YEAR = 2020
DRY_DAY_RAINFALL_THRESHOLD_MM = Decimal("1.00")

_ALLOWED_PSGC_LEVELS = (
    "REGION",
    "PROVINCE",
    "HUC",
    "ICC",
    "COMPONENT_CITY",
)

_PSGC_OVERRIDES = {
    "METRO MANILA": (
        ClimateLocationPsgc.MappingRole.PRIMARY,
        ("PH1300000000",),
    ),
    "DAVAO CITY": (
        ClimateLocationPsgc.MappingRole.PRIMARY,
        ("PH1130700000",),
    ),
    "MAGUINDANAO": (
        ClimateLocationPsgc.MappingRole.COMPONENT,
        (
            "PH1908700000",
            "PH1908800000",
        ),
    ),
    "SAMAR (WESTERN SAMAR)": (
        ClimateLocationPsgc.MappingRole.PRIMARY,
        ("PH0806000000",),
    ),
}

_LOCATION_NOTES = {
    "METRO MANILA": (
        "PAGASA's Metro Manila label is mapped to the current "
        "National Capital Region PSGC record."
    ),
    "DAVAO CITY": (
        "PAGASA's Davao City label is mapped to the current "
        "City of Davao HUC PSGC record."
    ),
    "MAGUINDANAO": (
        "The published legacy Maguindanao geography is represented "
        "by current Maguindanao del Norte and Maguindanao del Sur "
        "component mappings."
    ),
    "SAMAR (WESTERN SAMAR)": (
        "PAGASA's Samar (Western Samar) label is mapped to the "
        "current Samar province PSGC record."
    ),
}


class DryDaySourceError(ValueError):
    """Raised when reviewed PAGASA dry-day data is unsafe to import."""


@dataclass(frozen=True, slots=True)
class ParsedDryDayNormalRow:
    published_label: str
    source_page: int
    monthly_normals: tuple[int, ...]

    def month_values(self) -> tuple[tuple[int, int], ...]:
        return tuple(
            enumerate(self.monthly_normals, start=1)
        )


@dataclass(frozen=True, slots=True)
class DryDaySourceSpec:
    document_title: str
    issue_date: date
    notes: str


@dataclass(frozen=True, slots=True)
class ResolvedPsgcMapping:
    role: str
    location: RefPsgcLocation
    notes: str


@dataclass(frozen=True, slots=True)
class DryDaySyncResult:
    source_location_count: int
    source_normal_count: int
    location_created_count: int
    location_updated_count: int
    location_unchanged_count: int
    mapping_created_count: int
    mapping_updated_count: int
    mapping_deleted_count: int
    mapping_unchanged_count: int
    normal_created_count: int
    normal_updated_count: int
    normal_unchanged_count: int


_EARLY_SOURCE = DryDaySourceSpec(
    document_title=(
        "DOST-PAGASA Climate Outlook December 2025–May 2026"
    ),
    issue_date=date(2025, 11, 26),
    notes=(
        "Reviewed 1991–2020 normal from the November 2025 "
        "PAGASA climate outlook."
    ),
)
_JUNE_SOURCE = DryDaySourceSpec(
    document_title=(
        "DOST-PAGASA 193rd Climate Outlook March–August 2026"
    ),
    issue_date=date(2026, 2, 25),
    notes=(
        "June normal manually reviewed from the raster table. "
        "March–May and July–August row alignment was cross-checked "
        "against the adjacent structured PAGASA outlook tables."
    ),
)
_LATE_SOURCE = DryDaySourceSpec(
    document_title=(
        "DOST-PAGASA 197th Climate Outlook July–December 2026"
    ),
    issue_date=date(2026, 6, 24),
    notes=(
        "Reviewed 1991–2020 normal from the June 2026 "
        "PAGASA climate outlook."
    ),
)

_SOURCE_BY_MONTH = {
    **{month: _EARLY_SOURCE for month in range(1, 6)},
    6: _JUNE_SOURCE,
    **{month: _LATE_SOURCE for month in range(7, 13)},
}


def climate_location_key(published_label: str) -> str:
    normalized = re.sub(
        r"[^A-Z0-9]+",
        "_",
        published_label.upper(),
    ).strip("_")
    key = f"PAGASA_DRY_DAY_{normalized}"

    if len(key) > 64:
        raise DryDaySourceError(
            "Generated climate location key exceeds 64 characters "
            f"for {published_label!r}."
        )

    return key


def _display_label(published_label: str) -> str:
    overrides = {
        "METRO MANILA": "Metro Manila",
        "DAVAO CITY": "Davao City",
        "MAGUINDANAO": "Maguindanao",
        "SAMAR (WESTERN SAMAR)": "Samar (Western Samar)",
        "TAWI-TAWI": "Tawi-Tawi",
    }

    if published_label in overrides:
        return overrides[published_label]

    value = published_label.title()

    for original, replacement in (
        (" Del ", " del "),
        (" De ", " de "),
        (" La ", " la "),
        (" Las ", " las "),
        (" Los ", " los "),
    ):
        value = value.replace(original, replacement)

    return value


def parse_dry_day_normal_csv(
    text: str,
) -> tuple[ParsedDryDayNormalRow, ...]:
    reader = csv.DictReader(io.StringIO(text))

    header = tuple(reader.fieldnames or ())

    if header != DRY_DAY_EXPECTED_HEADER:
        raise DryDaySourceError(
            "Unexpected dry-day CSV header. Expected "
            f"{DRY_DAY_EXPECTED_HEADER!r}; found {header!r}."
        )

    parsed: list[ParsedDryDayNormalRow] = []
    seen_labels: set[str] = set()

    for row_number, row in enumerate(reader, start=2):
        if row.get(None):
            raise DryDaySourceError(
                f"Unexpected extra columns on row {row_number}."
            )

        published_label = (
            row.get("published_label") or ""
        ).strip()

        if not published_label:
            raise DryDaySourceError(
                f"Missing published label on row {row_number}."
            )

        if published_label in seen_labels:
            raise DryDaySourceError(
                f"Duplicate published label on row {row_number}: "
                f"{published_label!r}."
            )

        seen_labels.add(published_label)

        raw_source_page = (
            row.get("source_page") or ""
        ).strip()

        try:
            source_page = int(raw_source_page)
        except ValueError as exc:
            raise DryDaySourceError(
                f"Invalid source page on row {row_number}: "
                f"{raw_source_page!r}."
            ) from exc

        if source_page not in {1, 2}:
            raise DryDaySourceError(
                f"Source page must be 1 or 2 on row {row_number}; "
                f"found {source_page}."
            )

        monthly_normals: list[int] = []

        for month_field in DRY_DAY_MONTH_FIELDS:
            raw_value = (row.get(month_field) or "").strip()

            try:
                normal_value = int(raw_value)
            except ValueError as exc:
                raise DryDaySourceError(
                    f"Invalid {month_field} normal on row "
                    f"{row_number}: {raw_value!r}."
                ) from exc

            if not 0 <= normal_value <= 31:
                raise DryDaySourceError(
                    f"{month_field} normal is outside 0–31 on "
                    f"row {row_number}: {normal_value}."
                )

            monthly_normals.append(normal_value)

        parsed.append(
            ParsedDryDayNormalRow(
                published_label=published_label,
                source_page=source_page,
                monthly_normals=tuple(monthly_normals),
            )
        )

    if not parsed:
        raise DryDaySourceError(
            "The reviewed dry-day source contains no rows."
        )

    return tuple(parsed)


def validate_complete_dry_day_source(
    rows: Iterable[ParsedDryDayNormalRow],
) -> tuple[ParsedDryDayNormalRow, ...]:
    rows = tuple(rows)

    if len(rows) != DRY_DAY_EXPECTED_LOCATION_COUNT:
        raise DryDaySourceError(
            "The reviewed dry-day source is incomplete: expected "
            f"{DRY_DAY_EXPECTED_LOCATION_COUNT} locations, "
            f"found {len(rows)}."
        )

    normal_count = sum(
        len(row.monthly_normals)
        for row in rows
    )

    expected_normal_count = (
        DRY_DAY_EXPECTED_LOCATION_COUNT
        * len(DRY_DAY_MONTH_FIELDS)
    )

    if normal_count != expected_normal_count:
        raise DryDaySourceError(
            "The reviewed dry-day source is incomplete: expected "
            f"{expected_normal_count} monthly normals, "
            f"found {normal_count}."
        )

    return rows


def _resolve_psgc_mappings(
    published_label: str,
) -> tuple[ResolvedPsgcMapping, ...]:
    mapping_notes = _LOCATION_NOTES.get(
        published_label,
        "",
    )

    if published_label in _PSGC_OVERRIDES:
        role, keys = _PSGC_OVERRIDES[published_label]
        rows_by_key = {
            row.psgc_key: row
            for row in RefPsgcLocation.objects.filter(
                psgc_key__in=keys,
                is_active=True,
            )
        }

        missing = [
            key
            for key in keys
            if key not in rows_by_key
        ]

        if missing:
            raise DryDaySourceError(
                f"{published_label}: required PSGC mappings are "
                f"missing or inactive: {', '.join(missing)}."
            )

        return tuple(
            ResolvedPsgcMapping(
                role=role,
                location=rows_by_key[key],
                notes=mapping_notes,
            )
            for key in keys
        )

    exact_rows = list(
        RefPsgcLocation.objects.filter(
            geographic_level__in=_ALLOWED_PSGC_LEVELS,
            location_name__iexact=published_label,
            is_active=True,
        ).order_by("psgc_key")
    )

    if len(exact_rows) == 1:
        return (
            ResolvedPsgcMapping(
                role=ClimateLocationPsgc.MappingRole.PRIMARY,
                location=exact_rows[0],
                notes="",
            ),
        )

    if len(exact_rows) > 1:
        raise DryDaySourceError(
            f"{published_label}: multiple exact active PSGC "
            "locations were found."
        )

    fallback_rows = {
        row.psgc_key: row
        for row in RefPsgcLocation.objects.filter(
            geographic_level__in=_ALLOWED_PSGC_LEVELS,
            province_huc_name__iexact=published_label,
            is_active=True,
        )
    }

    if len(fallback_rows) == 1:
        location = next(iter(fallback_rows.values()))
        return (
            ResolvedPsgcMapping(
                role=ClimateLocationPsgc.MappingRole.PRIMARY,
                location=location,
                notes="",
            ),
        )

    if fallback_rows:
        raise DryDaySourceError(
            f"{published_label}: multiple PSGC fallback "
            "locations were found."
        )

    raise DryDaySourceError(
        f"{published_label}: no active PSGC mapping was found."
    )


def _location_scope(
    published_label: str,
) -> str:
    if published_label == "METRO MANILA":
        return ClimateLocation.GeographicScope.REGION

    if published_label == "MAGUINDANAO":
        return ClimateLocation.GeographicScope.LEGACY_COMPOSITE

    return ClimateLocation.GeographicScope.PROVINCE_HUC


def _apply_updates(instance, values: dict[str, object]) -> bool:
    changed_fields: list[str] = []

    for field_name, value in values.items():
        if getattr(instance, field_name) != value:
            setattr(instance, field_name, value)
            changed_fields.append(field_name)

    if not changed_fields:
        return False

    changed_fields.append("updated_at")
    instance.save(update_fields=changed_fields)
    return True


@transaction.atomic
def sync_dry_day_normals(
    rows: Iterable[ParsedDryDayNormalRow],
) -> DryDaySyncResult:
    rows = validate_complete_dry_day_source(rows)

    location_created = 0
    location_updated = 0
    location_unchanged = 0

    mapping_created = 0
    mapping_updated = 0
    mapping_deleted = 0
    mapping_unchanged = 0

    normal_created = 0
    normal_updated = 0
    normal_unchanged = 0

    for source_row in rows:
        mappings = _resolve_psgc_mappings(
            source_row.published_label
        )
        location_key = climate_location_key(
            source_row.published_label
        )

        location_defaults = {
            "published_label": source_row.published_label,
            "display_label": _display_label(
                source_row.published_label
            ),
            "published_region_label": (
                mappings[0].location.region_name or ""
            ),
            "geographic_scope": _location_scope(
                source_row.published_label
            ),
            "source_agency": "DOST-PAGASA",
            "mapping_notes": _LOCATION_NOTES.get(
                source_row.published_label,
                "",
            ),
            "is_active": True,
        }

        climate_location = ClimateLocation.objects.filter(
            climate_location_key=location_key
        ).first()

        if climate_location is None:
            climate_location = ClimateLocation.objects.create(
                climate_location_key=location_key,
                **location_defaults,
            )
            location_created += 1
        elif _apply_updates(
            climate_location,
            location_defaults,
        ):
            location_updated += 1
        else:
            location_unchanged += 1

        expected_mapping_keys = {
            mapping.location.psgc_key
            for mapping in mappings
        }

        stale_mappings = (
            ClimateLocationPsgc.objects
            .filter(climate_location=climate_location)
            .exclude(
                psgc_location_id__in=expected_mapping_keys
            )
        )
        stale_count = stale_mappings.count()

        if stale_count:
            stale_mappings.delete()
            mapping_deleted += stale_count

        existing_mappings = {
            mapping.psgc_location_id: mapping
            for mapping in ClimateLocationPsgc.objects.filter(
                climate_location=climate_location
            )
        }

        for resolved in mappings:
            mapping = existing_mappings.get(
                resolved.location.psgc_key
            )
            mapping_defaults = {
                "mapping_role": resolved.role,
                "notes": resolved.notes,
            }

            if mapping is None:
                ClimateLocationPsgc.objects.create(
                    climate_location=climate_location,
                    psgc_location=resolved.location,
                    **mapping_defaults,
                )
                mapping_created += 1
            elif _apply_updates(mapping, mapping_defaults):
                mapping_updated += 1
            else:
                mapping_unchanged += 1

        for month, normal_value in source_row.month_values():
            source_spec = _SOURCE_BY_MONTH[month]

            lookup = {
                "climate_location": climate_location,
                "month": month,
                "climatology_start_year": (
                    DRY_DAY_CLIMATOLOGY_START_YEAR
                ),
                "climatology_end_year": (
                    DRY_DAY_CLIMATOLOGY_END_YEAR
                ),
                "rainfall_threshold_mm": (
                    DRY_DAY_RAINFALL_THRESHOLD_MM
                ),
                "threshold_rule": (
                    DryDayNormal.ThresholdRule.LESS_THAN
                ),
            }
            defaults = {
                "normal_dry_days": normal_value,
                "source_document_title": (
                    source_spec.document_title
                ),
                "source_document_url": "",
                "source_issue_date": source_spec.issue_date,
                "source_page": source_row.source_page,
                "source_notes": source_spec.notes,
            }

            normal = DryDayNormal.objects.filter(
                **lookup
            ).first()

            if normal is None:
                DryDayNormal.objects.create(
                    **lookup,
                    **defaults,
                )
                normal_created += 1
            elif _apply_updates(normal, defaults):
                normal_updated += 1
            else:
                normal_unchanged += 1

    return DryDaySyncResult(
        source_location_count=len(rows),
        source_normal_count=(
            len(rows) * len(DRY_DAY_MONTH_FIELDS)
        ),
        location_created_count=location_created,
        location_updated_count=location_updated,
        location_unchanged_count=location_unchanged,
        mapping_created_count=mapping_created,
        mapping_updated_count=mapping_updated,
        mapping_deleted_count=mapping_deleted,
        mapping_unchanged_count=mapping_unchanged,
        normal_created_count=normal_created,
        normal_updated_count=normal_updated,
        normal_unchanged_count=normal_unchanged,
    )
