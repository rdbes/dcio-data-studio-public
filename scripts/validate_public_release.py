#!/usr/bin/env python3
"""Validate an immutable public JSON release and its current manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from decimal import Decimal, InvalidOperation
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent
    / "schemas"
    / "public-data-release.schema.json"
)
SUPPORTED_SCHEMA_VERSIONS = {"1.0.0", "1.1.0", "1.2.0"}

REQUIRED_ARRAYS = (
    "hazards",
    "commodities",
    "locations",
    "incidents",
    "damage_reports",
    "tropical_cyclones",
    "tropical_cyclone_track_points",
)

EXACT_DAMAGE_DECIMAL_FIELDS = (
    "area_totally_damaged_ha",
    "area_partially_damaged_ha",
    "area_affected_ha",
    "production_loss_mt",
    "value_loss_php",
)

EXACT_TRACK_DECIMAL_FIELDS = (
    "latitude",
    "longitude",
)


def is_decimal_string(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        decimal_value = Decimal(value)
    except InvalidOperation:
        return False
    return decimal_value.is_finite()


def validate_exact_decimal_fields(release: dict[str, object]) -> None:
    """Require exact decimal strings for schema 1.1 and later."""
    if release["schema_version"] == "1.0.0":
        return

    collections = (
        (release["damage_reports"], EXACT_DAMAGE_DECIMAL_FIELDS),
        (release["tropical_cyclone_track_points"], EXACT_TRACK_DECIMAL_FIELDS),
    )
    for rows, fields in collections:
        for row in rows:
            for field in fields:
                value = row.get(field)
                if value is not None and not is_decimal_string(value):
                    raise SystemExit(
                        f"Schema {release['schema_version']} requires an exact "
                        f"decimal string for {field}."
                    )


def schema_for_release(release: dict[str, object]) -> dict[str, object]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    schema_version = release.get("schema_version")
    schema["properties"]["schema_version"]["const"] = schema_version
    if schema_version in {"1.0.0", "1.1.0"}:
        schema["required"].remove("incident_cyclone_links")
        del schema["properties"]["incident_cyclone_links"]
        for field in ("correspondence_code", "region_key", "province_huc_key", "city_municipality_key", "barangay_key"):
            del schema["$defs"]["location"]["properties"][field]
            schema["$defs"]["location"]["required"].remove(field)
        del schema["$defs"]["cyclone"]["properties"]["peak_intensity_within_par"]
        schema["$defs"]["cyclone"]["required"].remove("peak_intensity_within_par")
    if schema_version == "1.0.0":
        # Schema 1.0 is retained for immutable historical artifacts. It used
        # JSON numbers for decimals and included fields that 1.1 deliberately
        # removed from the public contract.
        schema["properties"]["schema_version"]["const"] = "1.0.0"
        hazard = schema["$defs"]["hazard"]
        hazard["properties"].update(
            {
                "hazard_description": {"$ref": "#/$defs/nullableString"},
                "agriculture_fisheries_relevance": {
                    "type": ["boolean", "null"]
                },
            }
        )
        damage_report = schema["$defs"]["damageReport"]
        damage_report["properties"]["remarks"] = {
            "$ref": "#/$defs/nullableString"
        }
        schema["$defs"]["exactDecimal"] = {
            "type": ["number", "null"]
        }
    return schema


def validate_schema(release: dict[str, object]) -> None:
    if release.get("schema_version") not in SUPPORTED_SCHEMA_VERSIONS:
        raise SystemExit(
            "Unsupported public release schema version: "
            f"{release.get('schema_version', '<missing>')}."
        )
    schema = schema_for_release(release)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(release), key=lambda error: list(error.path))
    if errors:
        error = errors[0]
        location = ".".join(str(part) for part in error.absolute_path) or "release"
        raise SystemExit(f"Schema validation failed at {location}: {error.message}")


def validate_manifest(
    manifest: dict[str, object],
    release: dict[str, object],
    release_bytes: bytes,
) -> None:
    if manifest.get("release_version") != release["release_version"]:
        raise SystemExit("Manifest and release versions do not match.")
    if manifest.get("schema_version") != release["schema_version"]:
        raise SystemExit("Manifest and release schema versions do not match.")
    if (
        manifest.get("data_cutoff") is not None
        and manifest["data_cutoff"] != release["data_cutoff"]
    ):
        raise SystemExit("Manifest and release cutoffs do not match.")
    if (
        release["schema_version"] != "1.0.0"
        and (
            manifest.get("data_cutoff") is None
            or manifest.get("byte_size") is None
            or manifest.get("sha256") is None
        )
    ):
        raise SystemExit("Schema 1.1 manifests require release integrity metadata.")
    if manifest.get("byte_size") is not None and manifest["byte_size"] != len(release_bytes):
        raise SystemExit("Manifest byte size does not match the release file.")
    digest = hashlib.sha256(release_bytes).hexdigest()
    if manifest.get("sha256") is not None and manifest["sha256"] != digest:
        raise SystemExit("Manifest SHA-256 does not match the release file.")


def validate_cutoff(release: dict[str, object], cutoff_year: int) -> None:
    expected_cutoff = f"{cutoff_year}-01-01"
    if release["data_cutoff"] != expected_cutoff:
        raise SystemExit(
            f"Release cutoff must be {expected_cutoff}, got {release['data_cutoff']}."
        )
    for collection in ("incidents", "damage_reports"):
        for row in release[collection]:
            start_date = row.get("incident_start_date")
            if start_date and int(start_date[:4]) >= cutoff_year:
                raise SystemExit(
                    f"Release contains an out-of-range {collection} record."
                )
    for cyclone in release["tropical_cyclones"]:
        if cyclone["occurrence_year"] >= cutoff_year:
            raise SystemExit("Release contains an out-of-range tropical cyclone.")


def validate_relationships(release: dict[str, object]) -> None:
    def keys(collection: str, field: str) -> set[object]:
        values = [row[field] for row in release[collection]]
        if len(values) != len(set(values)):
            raise SystemExit(f"Duplicate {field} values found in {collection}.")
        return set(values)

    hazard_keys = keys("hazards", "hazard_key")
    commodity_keys = keys("commodities", "commodity_key")
    location_keys = keys("locations", "psgc_key")
    incident_keys = keys("incidents", "incident_key")
    keys("damage_reports", "damage_report_key")
    cyclone_keys = keys("tropical_cyclones", "cyclone_key")
    keys("tropical_cyclone_track_points", "track_point_key")

    for incident in release["incidents"]:
        if incident["hazard_key"] not in hazard_keys:
            raise SystemExit("Incident references a hazard outside the release.")
    for report in release["damage_reports"]:
        if report["incident_key"] not in incident_keys:
            raise SystemExit("Damage report references an incident outside the release.")
        if report["commodity_key"] not in commodity_keys:
            raise SystemExit("Damage report references a commodity outside the release.")
        if report["location_psgc_key"] not in location_keys:
            raise SystemExit("Damage report references a location outside the release.")
    for point in release["tropical_cyclone_track_points"]:
        if point["cyclone_key"] not in cyclone_keys:
            raise SystemExit("Track point references a cyclone outside the release.")
    if release["schema_version"] == "1.2.0":
        keys("incident_cyclone_links", "incident_cyclone_key")
        for link in release["incident_cyclone_links"]:
            if link["incident_key"] not in incident_keys or link["cyclone_key"] not in cyclone_keys:
                raise SystemExit("Cyclone link references an incident or cyclone outside the release.")
        for location in release["locations"]:
            for field in ("parent_psgc_key", "region_key", "province_huc_key", "city_municipality_key", "barangay_key"):
                if location.get(field) and location[field] not in location_keys:
                    raise SystemExit("Location hierarchy references a location outside the release.")


def validate_release_file(
    release_path: Path,
    cutoff_year: int,
) -> tuple[dict[str, object] | None, Path, dict[str, object]]:
    """Validate a release file, returning its manifest, data path, and data."""
    if release_path.name == "current.json":
        manifest = json.loads(release_path.read_text(encoding="utf-8"))
        data_url = manifest.get("data_url")
        if not isinstance(data_url, str) or Path(data_url).name != data_url:
            raise SystemExit("Manifest data_url must name a file in its release directory.")
        data_path = release_path.with_name(data_url)
        if not data_path.exists():
            raise SystemExit(f"Manifest points to a missing release: {data_path}")
    else:
        manifest = None
        data_path = release_path

    release_bytes = data_path.read_bytes()
    release = json.loads(release_bytes)
    validate_schema(release)
    validate_exact_decimal_fields(release)
    validate_cutoff(release, cutoff_year)
    validate_relationships(release)
    if manifest is not None:
        validate_manifest(manifest, release, release_bytes)
    return manifest, data_path, release


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "release",
        type=Path,
        nargs="?",
        default=Path(
            os.getenv("PUBLIC_RELEASE_DIR", "public_release/data/releases")
        )
        / "current.json",
    )
    parser.add_argument(
        "--cutoff-year",
        type=int,
        default=int(os.getenv("PUBLIC_DATA_BEFORE_YEAR", "2027")),
        help="Reject records at or after this year (default: 2027).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    _, data_path, release = validate_release_file(args.release, args.cutoff_year)

    print(f"Validated {data_path}")
    print(f"Release version: {release['release_version']}")
    for name in REQUIRED_ARRAYS:
        print(f"{name}: {len(release[name])}")


if __name__ == "__main__":
    main()
