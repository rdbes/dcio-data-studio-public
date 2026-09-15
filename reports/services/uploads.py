import csv
import hashlib
import io
from collections import Counter
from dataclasses import dataclass

from reports.pipeline.common import (
    build_incident_key,
    clean_header,
    normalize_psgc_key,
    parse_year,
    psgc_key_format_error,
)


class UploadContextError(ValueError):
    """Raised when source context conflicts with the selected upload scope."""


class UploadPreflightError(ValueError):
    """Raised when uploaded CSV bytes fail structural preflight checks."""


@dataclass(frozen=True, slots=True)
class UploadPreflightResult:
    """Parsed, validated CSV input ready for upload-context validation."""

    file_hash: str
    raw_headers: list[str]
    rows: list[tuple[int, list[str]]]
    header_positions: dict[str, int]
    detected_year: int
    total_duplicate_rows: int


MAX_UPLOAD_DATA_ROWS = 5000


def preflight_csv_upload(
    csv_bytes: bytes,
    *,
    max_data_rows: int = MAX_UPLOAD_DATA_ROWS,
) -> UploadPreflightResult:
    """Parse CSV bytes once and validate structural upload requirements."""
    file_hash = hashlib.sha256(csv_bytes).hexdigest()
    csv_content = csv_bytes.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(csv_content))

    try:
        raw_headers = next(reader)
    except StopIteration as exc:
        raise UploadPreflightError(
            "The CSV file is empty and has no header row."
        ) from exc

    rows: list[tuple[int, list[str]]] = []
    for source_row_number, values in enumerate(reader, start=2):
        if not any(values):
            continue
        if len(rows) >= max_data_rows:
            raise UploadPreflightError(
                "The upload contains more than "
                f"{max_data_rows:,} data rows. Source row "
                f"{source_row_number} exceeds the limit."
            )
        rows.append((source_row_number, values))

    if not rows:
        raise UploadPreflightError(
            "The CSV has a header row but no data rows."
        )

    for source_row_number, values in rows:
        if len(values) != len(raw_headers):
            raise UploadPreflightError(
                f"Source row {source_row_number} has {len(values)} values; "
                f"expected {len(raw_headers)}."
            )

    cleaned_headers = [clean_header(header) for header in raw_headers]
    duplicate_headers = sorted(
        name
        for name, count in Counter(cleaned_headers).items()
        if count > 1
    )
    if duplicate_headers:
        raise UploadPreflightError(
            "CSV headers are duplicated after cleaning: "
            + ", ".join(duplicate_headers)
        )

    header_positions = {
        name: index for index, name in enumerate(cleaned_headers)
    }
    year_position = header_positions.get("raw_year")
    if year_position is None:
        raise UploadPreflightError(
            "The CSV is missing the required Year column."
        )

    parsed_years: set[int] = set()
    year_source_rows: dict[int, int] = {}
    for source_row_number, values in rows:
        if year_position >= len(values):
            raise UploadPreflightError(
                f"Source row {source_row_number} is missing the Year column value."
            )
        parsed_year = parse_year(values[year_position])
        if parsed_year is None:
            raise UploadPreflightError(
                f"Source row {source_row_number} has an invalid or missing year value."
            )
        parsed_years.add(parsed_year)
        year_source_rows.setdefault(parsed_year, source_row_number)

    if len(parsed_years) > 1:
        rendered = ", ".join(
            f"{year} (source row {year_source_rows[year]})"
            for year in sorted(parsed_years)
        )
        raise UploadPreflightError(
            f"The CSV contains multiple source years: {rendered}. "
            "Keep one year in the Year column."
        )

    psgc_position = header_positions.get("raw_psgc_key")
    if psgc_position is not None:
        for source_row_number, values in rows:
            raw_psgc_key = values[psgc_position]
            format_error = psgc_key_format_error(raw_psgc_key)
            if format_error:
                raise UploadPreflightError(
                    f"Source row {source_row_number} has invalid PSGC KEY "
                    f"{normalize_psgc_key(raw_psgc_key)!r}. {format_error}"
                )

    seen_row_values: set[tuple[str, ...]] = set()
    total_duplicate_rows = 0
    for _, values in rows:
        row_values = tuple(values)
        if row_values in seen_row_values:
            total_duplicate_rows += 1
        else:
            seen_row_values.add(row_values)

    return UploadPreflightResult(
        file_hash=file_hash,
        raw_headers=raw_headers,
        rows=rows,
        header_positions=header_positions,
        detected_year=next(iter(parsed_years)),
        total_duplicate_rows=total_duplicate_rows,
    )


def validate_upload_context(
    preflight: UploadPreflightResult,
    *,
    upload_mode: str,
    source_year: int,
    incident=None,
) -> None:
    """Validate year and single-incident scope before any staging write."""
    if preflight.detected_year != source_year:
        raise UploadContextError(
            f"File year {preflight.detected_year} does not match selected "
            f"source year {source_year}."
        )

    if upload_mode != "current":
        return

    if incident is None:
        raise UploadContextError("An active incident is required for current uploads.")

    positions = preflight.header_positions
    required = ("raw_month", "raw_category", "raw_calamity")
    if any(field not in positions for field in required):
        return  # Missing headers are reported by the staging loader.

    contexts = {
        (
            values[positions["raw_month"]].strip(),
            values[positions["raw_category"]].strip(),
            values[positions["raw_calamity"]].strip(),
        )
        for _, values in preflight.rows
    }

    if len(contexts) != 1:
        raise UploadContextError(
            "Current incident uploads must contain exactly one month/category/calamity context."
        )

    raw_month, _, raw_calamity = next(iter(contexts))
    derived_key = build_incident_key(raw_calamity, source_year, raw_month)
    selected_key = incident.incident_key

    if derived_key != selected_key:
        raise UploadContextError(
            "File incident context resolves to "
            f"{derived_key or '(invalid incident key)'}, not selected incident {selected_key}."
        )
