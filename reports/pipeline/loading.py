from collections import Counter
from dataclasses import dataclass
from datetime import datetime

from psycopg import sql
from psycopg.types.json import Jsonb

from reports.constants import ImportStatus, ValidationStatus

from .common import (
    CONTEXT_HEADERS,
    clean_header,
    get_staging_columns,
    normalize_psgc_key,
    psgc_key_format_error,
)


@dataclass
class LoadResult:
    import_batch_key: int
    rows_loaded: int
    csv_only: list[str]
    staging_only: list[str]


class CsvLoadError(Exception):
    """Raised when a CSV cannot be safely loaded into staging."""


REQUIRED_CONTEXT_COLUMNS = {
    "raw_year",
    "raw_region",
    "raw_category",
    "raw_calamity",
    "raw_month",
}


def load_csv_into_staging(
    cursor,
    schema_name: str,
    *,
    raw_headers: list[str],
    rows: list[tuple[int, list[str]]],
    file_name: str,
    source_year: int,
    source_template: str,
    import_type: str,
    remarks: str = "",
    import_status: str = ImportStatus.UPLOADED,
    file_hash: str = None,
    total_duplicate_rows: int = 0,
    replaces_batch_key: int | None = None,
    report_first_uploaded_at: datetime | None = None,
) -> LoadResult:
    """Clean headers, validate, and insert a CSV's rows into staging.

    Raises CsvLoadError with a human-readable message for any validation
    failure, including blank headers, duplicate headers, row-length mismatch,
    no matching staging columns, or no data rows.
    """
    cleaned_headers = [clean_header(h) for h in raw_headers]
    header_positions = {name: index for index, name in enumerate(cleaned_headers)}

    blank_headers = [index + 1 for index, name in enumerate(cleaned_headers) if not name]
    if blank_headers:
        raise CsvLoadError(
            f"CSV contains blank headers at column positions: {', '.join(map(str, blank_headers))}"
        )

    duplicate_headers = sorted(
        name for name, count in Counter(cleaned_headers).items() if count > 1
    )
    if duplicate_headers:
        raise CsvLoadError(
            f"CSV headers are duplicated after cleaning: {', '.join(duplicate_headers)}"
        )

    missing_required = sorted(REQUIRED_CONTEXT_COLUMNS - set(cleaned_headers))
    if missing_required:
        raise CsvLoadError(
            "CSV is missing required columns: " + ", ".join(missing_required)
        )

    for source_row_number, values in rows:
        if len(values) != len(raw_headers):
            raise CsvLoadError(
                f"CSV row {source_row_number} has {len(values)} values; expected {len(raw_headers)}."
            )

        psgc_position = header_positions.get("raw_psgc_key")
        if psgc_position is not None:
            raw_psgc_key = values[psgc_position]
            format_error = psgc_key_format_error(raw_psgc_key)
            if format_error:
                raise CsvLoadError(
                    f"Source row {source_row_number} has invalid PSGC KEY "
                    f"{normalize_psgc_key(raw_psgc_key)!r}. {format_error}"
                )

    staging_columns = get_staging_columns()
    staging_column_set = set(staging_columns)

    matched_columns = [name for name in cleaned_headers if name in staging_column_set]
    if not matched_columns:
        raise CsvLoadError("No cleaned CSV headers match raw staging columns.")

    # Create import_batch
    cursor.execute(
        sql.SQL(
            """
            INSERT INTO {}.import_batch (
                file_name,
                source_year,
                source_template,
                import_type,
                import_status,
                validation_status,
                total_raw_rows,
                total_incident_candidates,
                total_error_count,
                total_warning_count,
                active_update_override_accepted,
                replaces_batch_key,
                report_first_uploaded_at,
                file_hash,
                total_duplicate_rows,
                remarks,
                created_at,
                updated_at
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            RETURNING import_batch_key
            """
        ).format(sql.Identifier(schema_name)),
        (
            file_name,
            source_year,
            source_template,
            import_type,
            import_status,
            ValidationStatus.PENDING,
            len(rows),
            0,
            0,
            0,
            False,
            replaces_batch_key,
            report_first_uploaded_at,
            file_hash,
            total_duplicate_rows,
            remarks,
        ),
    )
    import_batch_key = cursor.fetchone()[0]

    context_column_set = set(CONTEXT_HEADERS.values())
    matched_context_columns = [
        name for name in matched_columns if name in context_column_set
    ]
    matched_metric_columns = [
        name for name in matched_columns if name not in context_column_set
    ]
    insert_column_names = [
        "import_batch_key",
        "source_row_number",
        *matched_context_columns,
        "raw_payload",
    ]

    insert_statement = sql.SQL(
        "INSERT INTO {}.stg_damage_report_raw ({}, created_at) "
        "VALUES ({}, CURRENT_TIMESTAMP)"
    ).format(
        sql.Identifier(schema_name),
        sql.SQL(", ").join(map(sql.Identifier, insert_column_names)),
        sql.SQL(", ").join(sql.Placeholder() for _ in insert_column_names),
    )

    insert_values = [
        (
            import_batch_key,
            source_row_number,
            *(values[header_positions[name]] for name in matched_context_columns),
            Jsonb(
                {
                    name: values[header_positions[name]]
                    for name in matched_metric_columns
                }
            ),
        )
        for source_row_number, values in rows
    ]
    cursor.executemany(insert_statement, insert_values)

    cursor.execute(
        sql.SQL(
            """
            UPDATE {}.import_batch
            SET total_raw_rows = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE import_batch_key = %s
            """
        ).format(sql.Identifier(schema_name)),
        (len(rows), import_batch_key),
    )

    csv_only = [name for name in cleaned_headers if name not in staging_column_set]
    staging_only = [name for name in staging_columns if name not in cleaned_headers]

    return LoadResult(
        import_batch_key=import_batch_key,
        rows_loaded=len(rows),
        csv_only=csv_only,
        staging_only=staging_only,
    )
