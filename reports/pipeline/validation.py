from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal

from psycopg import sql

from reports.constants import (
    VALIDATION_ALLOWED_IMPORT_STATUSES,
    ImportStatus,
    ValidationStatus,
)
from reports.pipeline.active_report_updates import compare_active_report_update
from reports.pipeline.common import (
    COMMODITY_GROUPS,
    COUNT_RAW_FIELDS,
    KNOWN_STAGING_METRIC_FIELDS,
    NUMERIC_TOLERANCE,
    VALIDATION_ONLY_METRIC_FIELDS,
    IngestionRuleError,
    build_incident_key,
    expand_staging_row,
    fetch_latest_batch,
    load_hazard_lookup,
    load_location_matcher,
    map_hazard_key,
    normalize_psgc_key,
    parse_raw_decimal,
    psgc_key_format_error,
)
from reports.pipeline.transformation import TransformError, build_damage_records

REQUIRED_CONTEXT_FIELDS = (
    "raw_year",
    "raw_region",
    "raw_category",
    "raw_calamity",
    "raw_month",
)

CROP_AREA_GROUPS = (
    "RICE",
    "Y_CORN",
    "W_CORN",
    "CASS",
    "VEG",
    "FRU",
    "MANGO",
    "BNNA",
    "COMM",
    "ROOT",
    "ORNA",
    "FIBE",
    "COCO",
    "SUGR",
    "TBCO",
)

TOTAL_COMPONENT_FIELDS = {
    "nof": (
        "rice_nof",
        "corn_nof",
        "hvcc_nof",
        "fish_nof_a",
        "fish_nof_b",
        "live_nof",
        "infeqp_nof",
    ),
    "aa_td": ("rice_aa_td", "corn_aa_td", "hvcc_aa_td"),
    "aa_pd": ("rice_aa_pd", "corn_aa_pd", "hvcc_aa_pd"),
    "aa_tot": ("rice_aa_tot", "corn_aa_tot", "hvcc_aa_tot"),
    "pl_vol": ("rice_pl_vol", "corn_pl_vol", "hvcc_pl_vol", "fish_pl_vol"),
    "pl_val": (
        "rice_pl_val",
        "corn_pl_val",
        "hvcc_pl_val",
        "fish_pl_val",
        "live_pl_val",
        "infeqp_pl_val",
    ),
}

# From 2022 onward these crops are reported as their own source columns rather
# than being included in the HVCC aggregate. They still belong in the file's
# overall TOTAL columns. Keep the pre-2022 hierarchy unchanged because older
# files use HVCC as the lumped source aggregate.
SEPARATE_HVCC_TOTAL_COMPONENT_FIELDS = {
    "nof": ("cass_nof", "fibe_nof", "coco_nof", "sugr_nof", "tbco_nof"),
    "aa_td": (
        "cass_aa_td", "fibe_aa_td", "coco_aa_td", "sugr_aa_td", "tbco_aa_td",
    ),
    "aa_pd": (
        "cass_aa_pd", "fibe_aa_pd", "coco_aa_pd", "sugr_aa_pd", "tbco_aa_pd",
    ),
    "aa_tot": (
        "cass_aa_tot", "fibe_aa_tot", "coco_aa_tot", "sugr_aa_tot", "tbco_aa_tot",
    ),
    "pl_vol": ("cass_pl_vol", "fibe_pl_vol", "sugr_pl_vol", "tbco_pl_vol"),
    "pl_val": (
        "cass_pl_val", "fibe_pl_val", "coco_pl_val", "sugr_pl_val", "tbco_pl_val",
    ),
}


def _uses_separate_hvcc_total_components(row: dict[str, object]) -> bool:
    """Return whether source-year totals include separately reported crops."""
    try:
        return int(str(row.get("raw_year") or "").strip()) >= 2022
    except (TypeError, ValueError):
        return False


@dataclass(frozen=True)
class ValidationIssue:
    import_batch_key: int
    stg_raw_key: int | None
    issue_level: str
    issue_type: str
    field_name: str | None
    expected_value: str | None
    actual_value: str | None
    difference_value: Decimal | None
    issue_message: str


class ValidationRunError(Exception):
    """Raised when the validation run itself is unsafe or incomplete."""


def issue(
    batch_key: int,
    row_key: int | None,
    level: str,
    issue_type: str,
    message: str,
    field_name: str | None = None,
    expected: object | None = None,
    actual: object | None = None,
    difference: Decimal | None = None,
) -> ValidationIssue:
    return ValidationIssue(
        import_batch_key=batch_key,
        stg_raw_key=row_key,
        issue_level=level,
        issue_type=issue_type,
        field_name=field_name,
        expected_value=None if expected is None else str(expected),
        actual_value=None if actual is None else str(actual),
        difference_value=difference,
        issue_message=message,
    )


def persist_validation_issues(
    cursor,
    schema_name: str,
    issues: list[ValidationIssue],
) -> None:
    """Persist validation findings with values required by the live schema."""
    if not issues:
        return

    insert_statement = sql.SQL(
        """
        INSERT INTO {}.import_validation_issue (
            import_batch_key,
            stg_raw_key,
            issue_level,
            issue_type,
            field_name,
            expected_value,
            actual_value,
            difference_value,
            issue_message,
            is_resolved,
            created_at,
            updated_at
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s,
            FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        """
    ).format(sql.Identifier(schema_name))
    cursor.executemany(
        insert_statement,
        [
            (
                item.import_batch_key,
                item.stg_raw_key,
                item.issue_level,
                item.issue_type,
                item.field_name,
                item.expected_value,
                item.actual_value,
                item.difference_value,
                item.issue_message,
            )
            for item in issues
        ],
    )


def find_existing_damage_grains(
    cursor,
    schema_name: str,
    expected_grains: set[tuple[str, str, str]],
) -> dict[int | None, list[tuple[str, str, str]]]:
    """Return existing report grains that would collide on import.

    The final damage table has one row per incident/location/commodity grain.
    Checking those grains during validation keeps an ordinary upload from
    appearing valid until the import preview, where the transformer would
    otherwise reject it with a generic error. Replacement uploads intentionally
    skip this check because their target rows are removed atomically at import.
    """
    if not expected_grains:
        return {}

    incident_keys = sorted({grain[0] for grain in expected_grains})
    cursor.execute(
        sql.SQL(
            """
            SELECT import_batch_key, incident_key, location_psgc_key, commodity_key
            FROM {}.damage_report
            WHERE incident_key = ANY(%s)
            """
        ).format(sql.Identifier(schema_name)),
        (incident_keys,),
    )

    conflicts: dict[int | None, list[tuple[str, str, str]]] = defaultdict(list)
    for row in cursor.fetchall():
        if isinstance(row, tuple):
            import_batch_key, incident_key, location_key, commodity_key = row
        else:
            import_batch_key = row["import_batch_key"]
            incident_key = row["incident_key"]
            location_key = row["location_psgc_key"]
            commodity_key = row["commodity_key"]
        grain = (str(incident_key), str(location_key), str(commodity_key))
        if grain in expected_grains:
            conflicts[import_batch_key].append(grain)

    return dict(conflicts)


def get_metric_columns() -> list[str]:
    return sorted(KNOWN_STAGING_METRIC_FIELDS)


def parse_metric_values(
    row: dict[str, object],
    metric_columns: list[str],
    batch_key: int,
    issues: list[ValidationIssue],
) -> tuple[dict[str, Decimal | None], set[str]]:
    parsed: dict[str, Decimal | None] = {}
    invalid_fields: set[str] = set()
    row_key = int(row["stg_raw_key"])

    for field_name in metric_columns:
        raw_value = row.get(field_name)
        try:
            value = parse_raw_decimal(raw_value)
            if value is not None and value < 0:
                raise IngestionRuleError("Negative values are not allowed")
            if (
                value is not None
                and (
                    field_name.endswith("_nof")
                    or field_name.endswith("_noh")
                    or field_name in COUNT_RAW_FIELDS
                )
                and value != value.to_integral_value()
            ):
                raise IngestionRuleError("Count values must be whole numbers")
            parsed[field_name] = value
        except IngestionRuleError as exc:
            invalid_fields.add(field_name)
            parsed[field_name] = None
            issues.append(
                issue(
                    batch_key,
                    row_key,
                    "Error",
                    "Invalid Numeric Value",
                    f"{field_name} cannot be converted safely: {exc}",
                    field_name=field_name,
                    actual=raw_value,
                )
            )
    return parsed, invalid_fields


def compare_aggregate(
    *,
    batch_key: int,
    row_key: int,
    parsed: dict[str, Decimal | None],
    invalid_fields: set[str],
    actual_field: str,
    component_fields: list[str],
    issue_type: str,
    label: str,
    issues: list[ValidationIssue],
) -> None:
    if actual_field in invalid_fields or actual_field not in parsed:
        return
    actual = parsed[actual_field]
    if actual is None:
        return
    if any(field_name in invalid_fields for field_name in component_fields):
        return

    present_values = [
        parsed.get(field_name)
        for field_name in component_fields
        if parsed.get(field_name) is not None
    ]
    if not present_values:
        return

    expected = sum(present_values, Decimal("0"))
    difference = actual - expected
    if abs(difference) <= NUMERIC_TOLERANCE:
        return

    issues.append(
        issue(
            batch_key,
            row_key,
            "Warning",
            issue_type,
            f"{label}: source aggregate does not equal the available component sum.",
            field_name=actual_field,
            expected=expected,
            actual=actual,
            difference=difference,
        )
    )


def run_aggregate_checks(
    row: dict[str, object],
    parsed: dict[str, Decimal | None],
    invalid_fields: set[str],
    batch_key: int,
    issues: list[ValidationIssue],
) -> None:
    row_key = int(row["stg_raw_key"])

    suffixes = ("nof", "aa_td", "aa_pd", "aa_tot", "pl_vol", "pl_val")
    for suffix in suffixes:
        compare_aggregate(
            batch_key=batch_key,
            row_key=row_key,
            parsed=parsed,
            invalid_fields=invalid_fields,
            actual_field=f"corn_{suffix}",
            component_fields=[f"y_corn_{suffix}", f"w_corn_{suffix}"],
            issue_type="Commodity Group Mismatch",
            label=f"CORN {suffix}",
            issues=issues,
        )

        hvc_components = [
            f"{prefix}_{suffix}"
            for prefix in ("veg", "fru", "mango", "bnna", "comm", "root", "orna")
        ]
        compare_aggregate(
            batch_key=batch_key,
            row_key=row_key,
            parsed=parsed,
            invalid_fields=invalid_fields,
            actual_field=f"hvcc_{suffix}",
            component_fields=hvc_components,
            issue_type="Commodity Group Mismatch",
            label=f"HVCC {suffix}",
            issues=issues,
        )

    compare_aggregate(
        batch_key=batch_key,
        row_key=row_key,
        parsed=parsed,
        invalid_fields=invalid_fields,
        actual_field="fish_pl_val",
        component_fields=["fish_pl_val_a", "fish_pl_val_b"],
        issue_type="Commodity Group Mismatch",
        label="Fisheries value",
        issues=issues,
    )

    for suffix in ("nof", "pl_val"):
        compare_aggregate(
            batch_key=batch_key,
            row_key=row_key,
            parsed=parsed,
            invalid_fields=invalid_fields,
            actual_field=f"infeqp_{suffix}",
            component_fields=[
                f"irrig_ssis_{suffix}",
                f"irrig_nia_{suffix}",
                f"infra_{suffix}",
                f"eqp_{suffix}",
            ],
            issue_type="Commodity Group Mismatch",
            label=f"INFEQP {suffix}",
            issues=issues,
        )

    for group_name in CROP_AREA_GROUPS:
        metric_fields = COMMODITY_GROUPS[group_name]["metrics"]
        total_field = metric_fields.get("area_affected_ha")
        total_damage_field = metric_fields.get("area_totally_damaged_ha")
        partial_damage_field = metric_fields.get("area_partially_damaged_ha")
        if total_field and total_damage_field and partial_damage_field:
            compare_aggregate(
                batch_key=batch_key,
                row_key=row_key,
                parsed=parsed,
                invalid_fields=invalid_fields,
                actual_field=str(total_field),
                component_fields=[str(total_damage_field), str(partial_damage_field)],
                issue_type="Area Mismatch",
                label=f"{group_name} affected area",
                issues=issues,
            )

    include_separate_hvcc_components = _uses_separate_hvcc_total_components(row)
    for suffix, component_fields in TOTAL_COMPONENT_FIELDS.items():
        if include_separate_hvcc_components:
            component_fields = [
                *component_fields,
                *SEPARATE_HVCC_TOTAL_COMPONENT_FIELDS.get(suffix, ()),
            ]
        compare_aggregate(
            batch_key=batch_key,
            row_key=row_key,
            parsed=parsed,
            invalid_fields=invalid_fields,
            actual_field=f"total_{suffix}",
            component_fields=list(component_fields),
            issue_type="Total Mismatch",
            label=f"TOTAL {suffix}",
            issues=issues,
        )


def group_has_data(
    parsed: dict[str, Decimal | None],
    group: dict[str, object],
) -> bool:
    fields = group["metrics"].values()
    return any(parsed.get(str(field)) not in {None, Decimal("0")} for field in fields)


def _row_as_dict(cursor, row: object) -> dict[str, object]:
    if isinstance(row, dict):
        return row
    return dict(zip([column[0] for column in cursor.description], row))


def _metric_values(changes: list[dict[str, object]], value_name: str) -> str:
    return "; ".join(
        f"{change['label']}: {change[value_name]}" for change in changes
    )


def active_update_comparison_issues(
    batch_key: int,
    comparison: dict[str, object],
    *,
    staging_key_by_source_row: dict[int, int] | None = None,
) -> list[ValidationIssue]:
    """Convert only prohibited cumulative changes into validation errors."""
    update_issues: list[ValidationIssue] = []
    for finding in comparison["findings"]:
        if not finding["is_blocking"]:
            continue

        location_key = finding["location_psgc_key"]
        location_name = finding.get("location_name") or location_key
        location_label = (
            str(location_name)
            if str(location_name) == str(location_key)
            else f"{location_name} ({location_key})"
        )
        commodity_key = finding["commodity_key"]
        source_row_number = finding.get("source_row_number")
        staging_key = None
        if source_row_number is not None and staging_key_by_source_row:
            staging_key = staging_key_by_source_row.get(int(source_row_number))
        if finding["status"] == "Missing":
            update_issues.append(
                issue(
                    batch_key,
                    staging_key,
                    "Error",
                    "Previously Reported Location / Commodity Missing",
                    (
                        "The update does not include the previously reported "
                        f"location {location_label}, commodity {commodity_key}. "
                        "Keep its cumulative values in the update even when "
                        "there is no new damage."
                    ),
                    field_name="location_psgc_key + commodity_key",
                    expected=f"{location_key} / {commodity_key}",
                    actual="Not included in uploaded update",
                )
            )
            continue

        decreased_metrics = finding["decreased_metrics"]
        update_issues.append(
            issue(
                batch_key,
                staging_key,
                "Error",
                "Cumulative Damage Decrease",
                (
                    f"The update for location {location_label}, commodity {commodity_key} "
                    "reduces a cumulative damage value. Active incident reports "
                    "must retain the prior value or increase it."
                ),
                field_name=", ".join(
                    str(metric["field_name"]) for metric in decreased_metrics
                ),
                expected=_metric_values(decreased_metrics, "previous"),
                actual=_metric_values(decreased_metrics, "updated"),
            )
        )

    return update_issues


def validate_active_report_update(
    cursor,
    schema_name: str,
    batch: dict[str, object],
    staging_rows: list[dict[str, object]],
    location_matcher,
) -> list[ValidationIssue]:
    """Validate that a Current Incident replacement is cumulative and complete."""
    batch_key = int(batch["import_batch_key"])
    replacement_batch_key = batch.get("replaces_batch_key")
    if not replacement_batch_key:
        return []

    cursor.execute(
        sql.SQL(
            """
            SELECT import_batch_key, import_status, import_type, source_template
            FROM {}.import_batch
            WHERE import_batch_key = %s
            """
        ).format(sql.Identifier(schema_name)),
        (replacement_batch_key,),
    )
    target_row = cursor.fetchone()
    if target_row is None:
        return [
            issue(
                batch_key,
                None,
                "Error",
                "Invalid Active Report Replacement",
                "The active report selected for replacement no longer exists.",
                field_name="replaces_batch_key",
                actual=replacement_batch_key,
            )
        ]

    target = _row_as_dict(cursor, target_row)
    source_template = str(batch.get("source_template") or "")
    target_source_template = str(target.get("source_template") or "")
    if (
        batch.get("import_type") != "User Upload"
        or target.get("import_type") != "User Upload"
        or target.get("import_status") != ImportStatus.IMPORTED
        or not source_template.startswith("Incident:")
        or source_template != target_source_template
    ):
        return [
            issue(
                batch_key,
                None,
                "Error",
                "Invalid Active Report Replacement",
                "The replacement target must be the imported report for the same active incident.",
                field_name="replaces_batch_key",
                expected="Imported Current Incident report for the selected incident",
                actual=replacement_batch_key,
            )
        ]

    try:
        proposed_records = build_damage_records(staging_rows, location_matcher)
    except TransformError as exc:
        return [
            issue(
                batch_key,
                None,
                "Error",
                "Active Report Update Cannot Be Compared",
                f"The proposed update could not be compared safely: {exc}",
            )
        ]

    cursor.execute(
        sql.SQL(
            """
            SELECT dr.incident_key, dr.location_psgc_key, dr.commodity_key,
                   location.location_name,
                   dr.area_totally_damaged_ha,
                   dr.area_partially_damaged_ha,
                   dr.area_affected_ha,
                   dr.production_loss_mt,
                   dr.value_loss_php,
                   dr.affected_farmers_fisherfolk_count,
                   dr.affected_livestock_poultry_heads_count
            FROM {}.damage_report AS dr
            LEFT JOIN {}.ref_psgc_location AS location
              ON location.psgc_key = dr.location_psgc_key
            WHERE dr.import_batch_key = %s
            """
        ).format(
            sql.Identifier(schema_name),
            sql.Identifier(schema_name),
        ),
        (replacement_batch_key,),
    )
    previous_records = [
        _row_as_dict(cursor, row)
        for row in cursor.fetchall()
    ]
    comparison = compare_active_report_update(previous_records, proposed_records)
    uploaded_location_names = {}
    for row in staging_rows:
        location = location_matcher.match(
            row.get("raw_region"),
            row.get("raw_province"),
        )
        if location is not None:
            uploaded_location_names[location.psgc_key] = location.location_name
    for finding in comparison["findings"]:
        finding["location_name"] = uploaded_location_names.get(
            finding["location_psgc_key"],
            finding.get("location_name"),
        )
    staging_key_by_source_row = {
        int(row["source_row_number"]): int(row["stg_raw_key"])
        for row in staging_rows
    }
    return active_update_comparison_issues(
        batch_key,
        comparison,
        staging_key_by_source_row=staging_key_by_source_row,
    )


def validate_batch(
    connection,
    schema_name: str,
    source_year: int,
    file_name: str,
    batch_id: int | None = None,
) -> dict[str, int | str]:
    with connection.cursor() as cursor:
        if batch_id is not None:
            cursor.execute(
                sql.SQL(
                    """
                    SELECT import_batch_key, file_name, source_year, import_status,
                           validation_status, import_type, source_template,
                           replaces_batch_key
                    FROM {}.import_batch
                    WHERE import_batch_key = %s
                    """
                ).format(sql.Identifier(schema_name)),
                (batch_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise ValidationRunError(f"No import batch found with ID {batch_id}.")
            if not isinstance(row, dict):
                colnames = [desc[0] for desc in cursor.description]
                batch = dict(zip(colnames, row))
            else:
                batch = row
        else:
            batch = fetch_latest_batch(cursor, schema_name, source_year, file_name)
            if batch is None:
                raise ValidationRunError(
                    f"No matching {source_year} import batch found. Load to staging first."
                )

        batch_key = int(batch["import_batch_key"])
        if batch["import_status"] not in VALIDATION_ALLOWED_IMPORT_STATUSES:
            raise ValidationRunError(
                "Batch status must be Incidents Confirmed "
                "(or Validated for a rerun); "
                f"found {batch['import_status']!r}."
            )

        metric_columns = get_metric_columns()
        hazard_lookup = load_hazard_lookup(cursor, schema_name)
        location_matcher = load_location_matcher(cursor, schema_name)

        cursor.execute(
            sql.SQL(
                "SELECT * FROM {}.stg_damage_report_raw WHERE import_batch_key = %s"
            ).format(sql.Identifier(schema_name)),
            (batch_key,),
        )
        rows = cursor.fetchall()
        if not rows:
            raise ValidationRunError(f"Import batch {batch_key} has no staging rows.")

        staging_rows = []
        colnames = [desc[0] for desc in cursor.description]
        for r in rows:
            if not isinstance(r, dict):
                staging_rows.append(expand_staging_row(dict(zip(colnames, r))))
            else:
                staging_rows.append(expand_staging_row(r))

        cursor.execute(
            sql.SQL(
                """
                SELECT incident_key, hazard_key
                FROM {}.disaster_incident
                WHERE is_active = true
                """
            ).format(sql.Identifier(schema_name))
        )
        i_rows = cursor.fetchall()
        i_colnames = [desc[0] for desc in cursor.description]
        incidents = {}
        for r in i_rows:
            d = dict(zip(i_colnames, r)) if not isinstance(r, dict) else r
            incidents[d["incident_key"]] = d

        expected_commodity_keys = {
            str(group["commodity_key"]) for group in COMMODITY_GROUPS.values()
        }
        cursor.execute(
            sql.SQL(
                """
                SELECT commodity_key
                FROM {}.ref_commodity
                WHERE is_active = true
                  AND commodity_key = ANY(%s)
                """
            ).format(sql.Identifier(schema_name)),
            (sorted(expected_commodity_keys),),
        )
        c_rows = cursor.fetchall()
        c_colnames = [desc[0] for desc in cursor.description]
        existing_commodity_keys = set()
        for r in c_rows:
            d = dict(zip(c_colnames, r)) if not isinstance(r, dict) else r
            existing_commodity_keys.add(d["commodity_key"])

        issues: list[ValidationIssue] = []
        for unknown_field in sorted(set(metric_columns) - KNOWN_STAGING_METRIC_FIELDS):
            issues.append(
                issue(
                    batch_key,
                    None,
                    "Error",
                    "Unknown Commodity Mapping",
                    f"Staging metric column has no approved mapping: {unknown_field}.",
                    field_name=unknown_field,
                    actual=unknown_field,
                )
            )
        for missing_key in sorted(expected_commodity_keys - existing_commodity_keys):
            issues.append(
                issue(
                    batch_key,
                    None,
                    "Error",
                    "Unknown Commodity Mapping",
                    f"Required commodity key is missing or inactive: {missing_key}.",
                    field_name="commodity_key",
                    expected=missing_key,
                )
            )

        grain_sources: dict[tuple[str, str, str], list[int]] = {}
        for row in staging_rows:
            row_key = int(row["stg_raw_key"])
            source_row = int(row["source_row_number"])

            for field_name in REQUIRED_CONTEXT_FIELDS:
                if not str(row.get(field_name) or "").strip():
                    issues.append(
                        issue(
                            batch_key,
                            row_key,
                            "Error",
                            "Missing Required Context",
                            f"Source row {source_row} is missing {field_name}.",
                            field_name=field_name,
                            actual=row.get(field_name),
                        )
                    )

            expected_hazard_key = map_hazard_key(
                row.get("raw_category"),
                hazard_lookup,
                raw_calamity=row.get("raw_calamity"),
            )
            if not expected_hazard_key:
                issues.append(
                    issue(
                        batch_key,
                        row_key,
                        "Error",
                        "Unknown Hazard",
                        f"Source row {source_row} category could not be mapped.",
                        field_name="raw_category",
                        actual=row.get("raw_category"),
                    )
                )

            incident_key = build_incident_key(
                row.get("raw_calamity"),
                row.get("raw_year"),
                row.get("raw_month"),
                source_row,
            )
            matched_incident = incidents.get(incident_key)
            if not incident_key or matched_incident is None:
                issues.append(
                    issue(
                        batch_key,
                        row_key,
                        "Error",
                        "Unknown Incident",
                        f"Source row {source_row} has no confirmed incident match.",
                        field_name="raw_calamity",
                        expected=incident_key or None,
                        actual=row.get("raw_calamity"),
                    )
                )
            elif (
                expected_hazard_key
                and matched_incident["hazard_key"] != expected_hazard_key
            ):
                issues.append(
                    issue(
                        batch_key,
                        row_key,
                        "Error",
                        "Unknown Hazard",
                        f"Source row {source_row} incident hazard differs from raw category mapping.",
                        field_name="raw_category",
                        expected=expected_hazard_key,
                        actual=matched_incident["hazard_key"],
                    )
                )

            location = location_matcher.match(
                row.get("raw_region"),
                row.get("raw_province"),
            )
            if location is None:
                issues.append(
                    issue(
                        batch_key,
                        row_key,
                        "Error",
                        "Unknown Location",
                        f"Source row {source_row} region/province could not be matched safely.",
                        field_name="raw_province",
                        expected=row.get("raw_region"),
                        actual=row.get("raw_province"),
                    )
                )

            raw_psgc_key = row.get("raw_psgc_key")
            if str(raw_psgc_key or "").strip():
                normalized_psgc_key = normalize_psgc_key(raw_psgc_key)
                format_error = psgc_key_format_error(raw_psgc_key)
                if format_error:
                    issues.append(
                        issue(
                            batch_key,
                            row_key,
                            "Error",
                            "Invalid PSGC Key",
                            f"Source row {source_row} has invalid PSGC KEY "
                            f"{normalized_psgc_key!r}. {format_error}",
                            field_name="raw_psgc_key",
                            expected="PH followed by exactly 10 digits",
                            actual=raw_psgc_key,
                        )
                    )
                else:
                    code_location = location_matcher.lookup_psgc_key(
                        normalized_psgc_key
                    )
                    if code_location is None:
                        issues.append(
                            issue(
                                batch_key,
                                row_key,
                                "Error",
                                "Unknown PSGC Key",
                                f"Source row {source_row} contains PSGC KEY "
                                f"{normalized_psgc_key}, which is not in the active PSGC reference.",
                                field_name="raw_psgc_key",
                                expected="An active PSGC key",
                                actual=raw_psgc_key,
                            )
                        )
                    elif location is not None and code_location.psgc_key != location.psgc_key:
                        issues.append(
                            issue(
                                batch_key,
                                row_key,
                                "Error",
                                "PSGC/Location Mismatch",
                                f"PSGC KEY {normalized_psgc_key} resolves to "
                                f"{code_location.location_name}, but the Region/Province "
                                f"values resolve to {location.location_name}.",
                                field_name="raw_psgc_key",
                                expected=location.psgc_key,
                                actual=normalized_psgc_key,
                            )
                        )

            parsed, invalid_fields = parse_metric_values(
                row,
                metric_columns,
                batch_key,
                issues,
            )
            run_aggregate_checks(row, parsed, invalid_fields, batch_key, issues)

            groups_with_data = [
                group
                for group in COMMODITY_GROUPS.values()
                if group_has_data(parsed, group)
            ]
            aggregate_has_data = any(
                parsed.get(field_name) not in {None, Decimal("0")}
                for field_name in VALIDATION_ONLY_METRIC_FIELDS
            )
            if aggregate_has_data and not groups_with_data:
                issues.append(
                    issue(
                        batch_key,
                        row_key,
                        "Info",
                        "No Detail Available",
                        f"Source row {source_row} has aggregate values but no detailed "
                        "commodity values.",
                    )
                )

            if incident_key and matched_incident and location is not None:
                for group in groups_with_data:
                    commodity_key = str(group["commodity_key"])
                    grain = (incident_key, location.psgc_key, commodity_key)
                    grain_sources.setdefault(grain, []).append(source_row)

        for grain, source_rows in sorted(grain_sources.items()):
            if len(source_rows) < 2:
                continue
            issues.append(
                issue(
                    batch_key,
                    None,
                    "Error",
                    "Possible Duplicate",
                    "Multiple staging rows resolve to final grain "
                    f"{grain}; source rows: {', '.join(map(str, source_rows))}.",
                    field_name="incident_key + location_psgc_key + commodity_key",
                    actual=grain,
                )
            )

        if grain_sources and not batch.get("replaces_batch_key"):
            existing_conflicts = find_existing_damage_grains(
                cursor,
                schema_name,
                set(grain_sources),
            )
            for existing_batch_key, grains in sorted(
                existing_conflicts.items(),
                key=lambda item: (item[0] is None, item[0] or 0),
            ):
                incident_labels = sorted({grain[0] for grain in grains})
                incident_text = ", ".join(incident_labels)
                batch_text = (
                    f" imported batch {existing_batch_key}"
                    if existing_batch_key is not None
                    else " existing report data"
                )
                if batch.get("import_type") == "User Upload":
                    action = (
                        "If this is a newer cumulative current-incident report, "
                        "start the upload from that imported report's Update action."
                    )
                else:
                    action = (
                        "Review the existing report or remove the duplicate data "
                        "before uploading this file again."
                    )
                issues.append(
                    issue(
                        batch_key,
                        None,
                        "Error",
                        "Existing Report Conflict",
                        (
                            f"This upload contains {len(grains)} location/commodity "
                            f"grain(s) already present in{batch_text} for "
                            f"{incident_text}. {action}"
                        ),
                        field_name="incident_key + location_psgc_key + commodity_key",
                        expected="No existing report grain",
                        actual=f"{len(grains)} matching grain(s)",
                    )
                )

        if batch.get("replaces_batch_key") and not any(
            existing_issue.issue_level == "Error" for existing_issue in issues
        ):
            issues.extend(
                validate_active_report_update(
                    cursor,
                    schema_name,
                    batch,
                    staging_rows,
                    location_matcher,
                )
            )

        cursor.execute(
            sql.SQL(
                "DELETE FROM {}.import_validation_issue WHERE import_batch_key = %s"
            ).format(sql.Identifier(schema_name)),
            (batch_key,),
        )

        persist_validation_issues(cursor, schema_name, issues)

        error_count = sum(item.issue_level == "Error" for item in issues)
        warning_count = sum(item.issue_level == "Warning" for item in issues)
        info_count = sum(item.issue_level == "Info" for item in issues)

        if error_count:
            validation_status = ValidationStatus.FAILED
        elif warning_count:
            validation_status = ValidationStatus.PASSED_WITH_WARNINGS
        else:
            validation_status = ValidationStatus.PASSED

        cursor.execute(
            sql.SQL(
                """
                UPDATE {}.import_batch
                SET total_error_count = %s,
                    total_warning_count = %s,
                    validation_status = %s,
                    import_status = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE import_batch_key = %s
                """
            ).format(sql.Identifier(schema_name)),
            (
                error_count,
                warning_count,
                validation_status,
                ImportStatus.VALIDATED,
                batch_key,
            ),
        )

    return {
        "batch_key": batch_key,
        "raw_rows": len(staging_rows),
        "errors": error_count,
        "warnings": warning_count,
        "info": info_count,
        "validation_status": validation_status,
    }
