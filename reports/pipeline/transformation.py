from collections import Counter, defaultdict
from contextlib import nullcontext
from dataclasses import dataclass
from decimal import Decimal

from django.db import transaction
from psycopg import sql

from reports.constants import (
    ACTIVE_UPDATE_OVERRIDE_ISSUE_TYPES,
    IMPORT_ALLOWED_IMPORT_STATUSES,
    IMPORT_ALLOWED_VALIDATION_STATUSES,
    ImportStatus,
)
from reports.pipeline.common import (
    COMMODITY_GROUPS,
    COUNT_METRICS,
    EXPECTED_INCIDENT_COUNTS,
    NUMERIC_TOLERANCE,
    IngestionRuleError,
    build_incident_key,
    decimal_to_count,
    expand_staging_row,
    fetch_batch_by_key,
    fetch_latest_batch,
    load_location_matcher,
    parse_raw_decimal,
)

FINAL_METRIC_FIELDS = (
    "area_totally_damaged_ha",
    "area_partially_damaged_ha",
    "area_affected_ha",
    "production_loss_mt",
    "value_loss_php",
    "affected_farmers_fisherfolk_count",
    "affected_livestock_poultry_heads_count",
)


@dataclass(frozen=True)
class DamageRecord:
    source_row_number: int
    incident_key: str
    location_psgc_key: str
    commodity_key: str
    area_totally_damaged_ha: Decimal | None = None
    area_partially_damaged_ha: Decimal | None = None
    area_affected_ha: Decimal | None = None
    production_loss_mt: Decimal | None = None
    value_loss_php: Decimal | None = None
    affected_farmers_fisherfolk_count: int | None = None
    affected_livestock_poultry_heads_count: int | None = None
    remarks: str | None = None

    @property
    def grain(self) -> tuple[str, str, str]:
        return self.incident_key, self.location_psgc_key, self.commodity_key


class TransformError(Exception):
    """Raised when final transformation is unsafe."""


def parse_group_metrics(
    row: dict[str, object],
    group_name: str,
    group: dict[str, object],
) -> dict[str, Decimal | int | None]:
    metrics: dict[str, Decimal | int | None] = {
        field_name: None for field_name in FINAL_METRIC_FIELDS
    }
    source_row = int(row["source_row_number"])

    for final_field, raw_field in group["metrics"].items():
        try:
            value = parse_raw_decimal(row.get(str(raw_field)))
            if value is not None and value < 0:
                raise IngestionRuleError("Negative values are not allowed")
            if final_field in COUNT_METRICS:
                metrics[str(final_field)] = decimal_to_count(value, str(raw_field))
            else:
                metrics[str(final_field)] = value
        except IngestionRuleError as exc:
            raise TransformError(
                f"Source row {source_row}, group {group_name}, field {raw_field}: {exc}"
            ) from exc
    return metrics


def metric_group_has_data(metrics: dict[str, Decimal | int | None]) -> bool:
    return any(value not in {None, 0, Decimal("0")} for value in metrics.values())




HISTORICAL_RESIDUAL_GROUPS = [
    {
        "label": "Corn historical aggregate residual",
        "commodity_key": "CMD_CROPS_CORN",
        "metrics": {
            "affected_farmers_fisherfolk_count": ("corn_nof", ["y_corn_nof", "w_corn_nof"]),
            "area_totally_damaged_ha": ("corn_aa_td", ["y_corn_aa_td", "w_corn_aa_td"]),
            "area_partially_damaged_ha": ("corn_aa_pd", ["y_corn_aa_pd", "w_corn_aa_pd"]),
            "area_affected_ha": ("corn_aa_tot", ["y_corn_aa_tot", "w_corn_aa_tot"]),
            "production_loss_mt": ("corn_pl_vol", ["y_corn_pl_vol", "w_corn_pl_vol"]),
            "value_loss_php": ("corn_pl_val", ["y_corn_pl_val", "w_corn_pl_val"]),
        },
    },
    {
        "label": "HVCC historical aggregate residual",
        "commodity_key": "CMD_CROPS_HVC",
        "metrics": {
            "affected_farmers_fisherfolk_count": (
                "hvcc_nof",
                ["cass_nof", "veg_nof", "fru_nof", "mango_nof", "bnna_nof", "comm_nof", "root_nof", "orna_nof", "fibe_nof", "coco_nof", "sugr_nof", "tbco_nof"],
            ),
            "area_totally_damaged_ha": (
                "hvcc_aa_td",
                ["cass_aa_td", "veg_aa_td", "fru_aa_td", "mango_aa_td", "bnna_aa_td", "comm_aa_td", "root_aa_td", "orna_aa_td", "fibe_aa_td", "coco_aa_td", "sugr_aa_td", "tbco_aa_td"],
            ),
            "area_partially_damaged_ha": (
                "hvcc_aa_pd",
                ["cass_aa_pd", "veg_aa_pd", "fru_aa_pd", "mango_aa_pd", "bnna_aa_pd", "comm_aa_pd", "root_aa_pd", "orna_aa_pd", "fibe_aa_pd", "coco_aa_pd", "sugr_aa_pd", "tbco_aa_pd"],
            ),
            "area_affected_ha": (
                "hvcc_aa_tot",
                ["cass_aa_tot", "veg_aa_tot", "fru_aa_tot", "mango_aa_tot", "bnna_aa_tot", "comm_aa_tot", "root_aa_tot", "orna_aa_tot", "fibe_aa_tot", "coco_aa_tot", "sugr_aa_tot", "tbco_aa_tot"],
            ),
            "production_loss_mt": (
                "hvcc_pl_vol",
                ["cass_pl_vol", "veg_pl_vol", "fru_pl_vol", "mango_pl_vol", "bnna_pl_vol", "comm_pl_vol", "root_pl_vol", "orna_pl_vol", "fibe_pl_vol", "coco_pl_vol", "sugr_pl_vol", "tbco_pl_vol"],
            ),
            "value_loss_php": (
                "hvcc_pl_val",
                ["cass_pl_val", "veg_pl_val", "fru_pl_val", "mango_pl_val", "bnna_pl_val", "comm_pl_val", "root_pl_val", "orna_pl_val", "fibe_pl_val", "coco_pl_val", "sugr_pl_val", "tbco_pl_val"],
            ),
        },
    },
    {
        "label": "Fisheries historical aggregate residual",
        "commodity_key": "CMD_FISHERIES",
        "metrics": {
            "affected_farmers_fisherfolk_count": ("fish_nof", ["fish_nof_a", "fish_nof_b"]),
            "production_loss_mt": ("fish_pl_vol", ["fish_pl_vol"]),
            "value_loss_php": ("fish_pl_val", ["fish_pl_val_a", "fish_pl_val_b"]),
        },
    },
    {
        "label": "AMEF historical aggregate residual",
        "commodity_key": "CMD_AMEF",
        "metrics": {
            "affected_farmers_fisherfolk_count": ("infeqp_nof", ["irrig_ssis_nof", "irrig_nia_nof", "infra_nof", "eqp_nof"]),
            "value_loss_php": ("infeqp_pl_val", ["irrig_ssis_pl_val", "irrig_nia_pl_val", "infra_pl_val", "eqp_pl_val"]),
        },
    },
]


def parse_reconciliation_decimal(row: dict[str, object], field_name: str, source_row: int) -> Decimal:
    try:
        return parse_raw_decimal(row.get(field_name)) or Decimal("0")
    except IngestionRuleError as exc:
        raise TransformError(
            f"Source row {source_row}, field {field_name}: {exc}"
        ) from exc


def build_historical_residual_records(
    row: dict[str, object],
    source_row: int,
    incident_key: str,
    location_psgc_key: str,
) -> list[DamageRecord]:
    """Create explicit residual records for historical lumped aggregate values.

    These records preserve official staged totals when older source files contain
    aggregate values that are higher than the available detailed breakdown.
    """
    residual_records: list[DamageRecord] = []

    is_rolly_2020 = (
        str(row.get("raw_calamity")).strip().lower() == "rolly"
        and str(row.get("raw_year")) == "2020"
    )

    for group in HISTORICAL_RESIDUAL_GROUPS:
        metrics: dict[str, Decimal | int | None] = {
            field_name: None for field_name in FINAL_METRIC_FIELDS
        }
        residual_sources: list[str] = []

        for final_field, field_config in group["metrics"].items():
            aggregate_field, detail_fields = field_config

            if is_rolly_2020 and group["commodity_key"] == "CMD_CROPS_HVC":
                detail_fields = [
                    f for f in detail_fields
                    if not (f.startswith("fibe_") or f.startswith("coco_"))
                ]

            if aggregate_field not in row:
                continue

            aggregate_value = parse_reconciliation_decimal(row, aggregate_field, source_row)
            detail_value = sum(
                (
                    parse_reconciliation_decimal(row, detail_field, source_row)
                    for detail_field in detail_fields
                    if detail_field in row
                ),
                Decimal("0"),
            )
            residual_value = aggregate_value - detail_value

            if residual_value <= NUMERIC_TOLERANCE:
                continue

            if final_field in COUNT_METRICS:
                metrics[final_field] = decimal_to_count(
                    residual_value,
                    f"{aggregate_field} residual",
                )
            else:
                metrics[final_field] = residual_value

            residual_sources.append(
                f"{aggregate_field} residual {residual_value}"
            )

        if not metric_group_has_data(metrics):
            continue

        residual_records.append(
            DamageRecord(
                source_row_number=source_row,
                incident_key=incident_key,
                location_psgc_key=location_psgc_key,
                commodity_key=str(group["commodity_key"]),
                remarks=(
                    f"{group['label']}; preserved staged aggregate residual because "
                    "historical source data was not fully disaggregated. "
                    + "; ".join(residual_sources)
                ),
                **metrics,
            )
        )

    return residual_records


def build_damage_records(
    staging_rows: list[dict[str, object]],
    location_matcher,
) -> list[DamageRecord]:
    """Build the normalized final grains used by preview and final import."""
    records: list[DamageRecord] = []
    for row in staging_rows:
        source_row = int(row["source_row_number"])
        incident_key = build_incident_key(
            row["raw_calamity"],
            row["raw_year"],
            row["raw_month"],
            source_row,
        )
        location = location_matcher.match(row["raw_region"], row["raw_province"])
        if location is None:
            raise TransformError(
                f"Source row {source_row} has no safe PSGC location match."
            )

        for group_name, group in COMMODITY_GROUPS.items():
            metrics = parse_group_metrics(row, group_name, group)
            if not metric_group_has_data(metrics):
                continue
            records.append(
                DamageRecord(
                    source_row_number=source_row,
                    incident_key=incident_key,
                    location_psgc_key=location.psgc_key,
                    commodity_key=str(group["commodity_key"]),
                    **metrics,
                )
            )

        records.extend(
            build_historical_residual_records(
                row,
                source_row,
                incident_key,
                location.psgc_key,
            )
        )

    if not records:
        raise TransformError("No nonzero detailed commodity records were produced.")

    grain_sources: dict[tuple[str, str, str], list[int]] = defaultdict(list)
    for record in records:
        grain_sources[record.grain].append(record.source_row_number)
    duplicate_grains = {
        grain: source_rows
        for grain, source_rows in grain_sources.items()
        if len(source_rows) > 1
    }
    if duplicate_grains:
        details = [
            f"{grain} <- source rows {source_rows}"
            for grain, source_rows in sorted(duplicate_grains.items())[:20]
        ]
        raise TransformError(
            "Duplicate final grains require review:\n  - " + "\n  - ".join(details)
        )

    return records

def prepare_records(
    cursor,
    schema_name: str,
    batch: dict[str, object],
) -> tuple[list[DamageRecord], dict[str, str], int, int]:
    batch_key = int(batch["import_batch_key"])

    if batch["import_status"] not in IMPORT_ALLOWED_IMPORT_STATUSES:
        raise TransformError(
            "Batch status must be Validated or Ready for Import; "
            f"found {batch['import_status']!r}."
        )

    if batch["validation_status"] not in IMPORT_ALLOWED_VALIDATION_STATUSES:
        raise TransformError(
            "Batch validation status must be Passed or Passed with Warnings; "
            f"found {batch['validation_status']!r}."
        )

    error_query = sql.SQL(
        """
        SELECT count(*) AS error_count
        FROM {}.import_validation_issue
        WHERE import_batch_key = %s
          AND issue_level = 'Error'
          AND is_resolved = false
        """
    ).format(sql.Identifier(schema_name))
    error_params: tuple[object, ...] = (batch_key,)
    if batch.get("active_update_override_accepted"):
        # Keep accepted comparison findings for audit, but do not let them
        # block preview, approval, or the atomic final replacement.
        override_types = tuple(sorted(ACTIVE_UPDATE_OVERRIDE_ISSUE_TYPES))
        error_query += sql.SQL(" AND issue_type NOT IN (%s, %s)")
        error_params = (batch_key, *override_types)
    cursor.execute(error_query, error_params)
    res = cursor.fetchone()
    unresolved_errors = int(res[0] if isinstance(res, tuple) else res["error_count"])
    if unresolved_errors:
        raise TransformError(
            f"Batch has {unresolved_errors} unresolved validation errors."
        )

    cursor.execute(
        sql.SQL(
            """
            SELECT count(*) AS warning_count
            FROM {}.import_validation_issue
            WHERE import_batch_key = %s
              AND issue_level = 'Warning'
              AND is_resolved = false
            """
        ).format(sql.Identifier(schema_name)),
        (batch_key,),
    )
    res_w = cursor.fetchone()
    warning_count = int(res_w[0] if isinstance(res_w, tuple) else res_w["warning_count"])

    cursor.execute(
        sql.SQL(
            "SELECT * FROM {}.stg_damage_report_raw WHERE import_batch_key = %s"
        ).format(sql.Identifier(schema_name)),
        (batch_key,),
    )
    rows = cursor.fetchall()
    if not rows:
        raise TransformError(f"Import batch {batch_key} contains no staging rows.")

    staging_rows = []
    colnames = [desc[0] for desc in cursor.description]
    for r in rows:
        if not isinstance(r, dict):
            staging_rows.append(expand_staging_row(dict(zip(colnames, r))))
        else:
            staging_rows.append(expand_staging_row(r))

    expected_incident_keys = {
        build_incident_key(
            row["raw_calamity"],
            row["raw_year"],
            row["raw_month"],
            int(row["source_row_number"]),
        )
        for row in staging_rows
    }
    if "" in expected_incident_keys:
        raise TransformError("At least one staging row cannot generate an event key.")

    expected_count = EXPECTED_INCIDENT_COUNTS.get(
        int(batch["source_year"]),
        len(expected_incident_keys),
    )
    if len(expected_incident_keys) != expected_count:
        raise TransformError(
            f"Expected {expected_count} incident keys, found {len(expected_incident_keys)}."
        )

    cursor.execute(
        sql.SQL(
            """
            SELECT incident_key
            FROM {}.disaster_incident
            WHERE is_active = true
              AND incident_key = ANY(%s)
            """
        ).format(sql.Identifier(schema_name)),
        (sorted(expected_incident_keys),),
    )
    confirmed_incident_keys = {
        row[0] if isinstance(row, tuple) else row["incident_key"]
        for row in cursor.fetchall()
    }
    missing_incidents = sorted(expected_incident_keys - confirmed_incident_keys)
    if missing_incidents:
        raise TransformError(
            "Confirmed disaster incidents are missing: " + ", ".join(missing_incidents)
        )

    location_matcher = load_location_matcher(cursor, schema_name)
    records = build_damage_records(staging_rows, location_matcher)

    # Validate only the commodity keys that this batch can actually emit. The
    # historical residual groups are conditional, so a current-incident file
    # with no aggregate residual should not be blocked by a historical-only
    # reference that is not used by its records.
    expected_commodity_keys = {record.commodity_key for record in records}
    cursor.execute(
        sql.SQL(
            """
            SELECT commodity_key, main_sector
            FROM {}.ref_commodity
            WHERE is_active = true
              AND commodity_key = ANY(%s)
            """
        ).format(sql.Identifier(schema_name)),
        (sorted(expected_commodity_keys),),
    )
    commodity_sectors = {}
    for r in cursor.fetchall():
        if isinstance(r, tuple):
            commodity_sectors[r[0]] = r[1]
        else:
            commodity_sectors[r["commodity_key"]] = r["main_sector"]

    missing_commodities = sorted(expected_commodity_keys - set(commodity_sectors))
    if missing_commodities:
        raise TransformError(
            "Commodity references are missing: " + ", ".join(missing_commodities)
        )

    cursor.execute(
        sql.SQL(
            """
            SELECT import_batch_key, incident_key, location_psgc_key, commodity_key
            FROM {}.damage_report
            WHERE incident_key = ANY(%s)
            """
        ).format(sql.Identifier(schema_name)),
        (sorted(expected_incident_keys),),
    )
    existing_rows = cursor.fetchall()
    if existing_rows:
        replacement_batch_key = batch.get("replaces_batch_key")
        existing_grains = []
        unrelated_grains = []
        for r in existing_rows:
            if isinstance(r, tuple):
                existing_batch_key, incident_key, location_key, commodity_key = r
            else:
                existing_batch_key = r["import_batch_key"]
                incident_key = r["incident_key"]
                location_key = r["location_psgc_key"]
                commodity_key = r["commodity_key"]
            grain = (incident_key, location_key, commodity_key)
            existing_grains.append(grain)
            if (
                existing_batch_key is None
                or int(existing_batch_key) != int(replacement_batch_key or 0)
            ):
                unrelated_grains.append(grain)
        if not replacement_batch_key or unrelated_grains:
            raise TransformError(
                "damage_report already contains incident grains; refusing to insert: "
                + repr(existing_grains)
            )

    return records, commodity_sectors, len(staging_rows), warning_count


def sum_metric(records: list[DamageRecord], field_name: str) -> Decimal:
    return sum(
        (
            Decimal(str(value))
            for record in records
            if (value := getattr(record, field_name)) is not None
        ),
        Decimal("0"),
    )


def insert_records(
    cursor,
    schema_name: str,
    batch_key: int,
    records: list[DamageRecord],
) -> None:
    insert_statement = sql.SQL(
        """
        INSERT INTO {}.damage_report (
            import_batch_key,
            incident_key,
            location_psgc_key,
            commodity_key,
            area_totally_damaged_ha,
            area_partially_damaged_ha,
            area_affected_ha,
            production_loss_mt,
            value_loss_php,
            affected_farmers_fisherfolk_count,
            affected_livestock_poultry_heads_count,
            remarks,
            is_active,
            created_at,
            updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        """
    ).format(sql.Identifier(schema_name))
    cursor.executemany(
        insert_statement,
        [
            (
                batch_key,
                record.incident_key,
                record.location_psgc_key,
                record.commodity_key,
                record.area_totally_damaged_ha,
                record.area_partially_damaged_ha,
                record.area_affected_ha,
                record.production_loss_mt,
                record.value_loss_php,
                record.affected_farmers_fisherfolk_count,
                record.affected_livestock_poultry_heads_count,
                (
                    f"Imported from batch {batch_key}; source row "
                    f"{record.source_row_number}"
                    + (f"; {record.remarks}" if record.remarks else "")
                ),
            )
            for record in records
        ],
    )

    cursor.execute(
        sql.SQL(
            """
            UPDATE {}.import_batch
            SET import_status = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE import_batch_key = %s
            """
        ).format(sql.Identifier(schema_name)),
        (
            ImportStatus.IMPORTED,
            batch_key,
        ),
    )


def transform_to_damage_report(
    connection,
    schema_name: str,
    source_year: int,
    file_name: str | None,
    *,
    execute: bool,
    batch_id: int | None = None,
) -> dict:
    """Prepare damage-report records and either preview or insert them.

    Execution locks the selected batch and commits its records and status
    together. Preview also accepts validated batches before explicit approval.
    """
    with (
        transaction.atomic(using=connection.alias) if execute else nullcontext(),
        connection.cursor() as cursor,
    ):
        if batch_id is not None:
            batch = fetch_batch_by_key(cursor, schema_name, batch_id)
        else:
            batch = fetch_latest_batch(
                cursor,
                schema_name,
                source_year,
                file_name or f"damage_report_{source_year}.csv",
            )
        if batch is None:
            if batch_id is not None:
                raise TransformError(f"No import batch found with ID {batch_id}.")
            raise TransformError(
                f"No matching {source_year} import batch found. Load to staging first."
            )

        if execute:
            batch = fetch_batch_by_key(
                cursor, schema_name, int(batch["import_batch_key"]), for_update=True
            )
            if batch is None or batch["import_status"] != ImportStatus.READY_FOR_IMPORT:
                raise TransformError("Batch must be Ready for Import before execution.")

        records, commodity_sectors, staging_count, warning_count = prepare_records(
            cursor,
            schema_name,
            batch,
        )

        if execute:
            insert_records(
                cursor,
                schema_name,
                int(batch["import_batch_key"]),
                records,
            )

    by_sector = Counter(commodity_sectors[record.commodity_key] for record in records)
    by_commodity = Counter(record.commodity_key for record in records)

    return {
        "batch_key": int(batch["import_batch_key"]),
        "staging_rows": staging_count,
        "warnings": warning_count,
        "records_count": len(records),
        "total_value_loss": sum_metric(records, "value_loss_php"),
        "total_affected_area": sum_metric(records, "area_affected_ha"),
        "total_production_loss": sum_metric(records, "production_loss_mt"),
        "by_sector": dict(by_sector),
        "by_commodity": dict(by_commodity),
        "execute": execute,
        "records": records,
    }
