"""Direct DOST-PAGASA dam water-level fetching and normalization."""

from __future__ import annotations

import hashlib
import html
import json
import re
import ssl
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from typing import Iterable
from urllib.parse import quote
from zoneinfo import ZoneInfo

try:
    import certifi
except ImportError:  # pragma: no cover - requirements install certifi in production
    certifi = None
from django.utils import timezone

PAGASA_DAM_PAGE_URL = "https://www.pagasa.dost.gov.ph/flood"
PAGASA_DAM_STATUS_IMAGE_URL = "https://pubfiles.pagasa.dost.gov.ph/hmd/DAMSTATUS.gif"
PAGASA_DAM_CHART_API_URL = "https://pagasa.dost.gov.ph/api/flood/wl/"
PAGASA_SOURCE_NAME = "DOST-PAGASA"
MANILA_TIMEZONE = ZoneInfo("Asia/Manila")
MAX_PAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_CHART_BYTES = 5 * 1024 * 1024
PAGASA_FETCH_TIMEOUT_SECONDS = 12


class DamWaterLevelError(ValueError):
    """Raised when the PAGASA dam source cannot be interpreted safely."""


class DamWaterLevelFetchError(DamWaterLevelError):
    """Raised when a PAGASA source cannot be downloaded."""


def _pagasa_ssl_context() -> ssl.SSLContext:
    """Build a TLS context with certifi when available, otherwise system CAs."""

    certifi_where = getattr(certifi, "where", None)
    if callable(certifi_where):
        try:
            return ssl.create_default_context(cafile=certifi_where())
        except (OSError, ssl.SSLError, TypeError):
            # A partial or stale certifi installation should not prevent the
            # standard library from using the host's trusted CA bundle.
            pass
    return ssl.create_default_context()


@dataclass(frozen=True)
class DamWaterLevelReading:
    dam_name: str
    observed_at: datetime
    reservoir_water_level_m: Decimal | None
    water_level_deviation_hours: Decimal | None
    water_level_deviation_m: Decimal | None
    normal_high_water_level_m: Decimal | None
    deviation_from_nhwl_m: Decimal | None
    rule_curve_elevation_m: Decimal | None
    deviation_from_rule_curve_m: Decimal | None
    gate_count: int | None
    gate_opening_m: Decimal | None
    estimated_inflow_cms: Decimal | None
    estimated_outflow_cms: Decimal | None


@dataclass(frozen=True)
class ParsedDamWaterLevels:
    source_observed_at: datetime
    readings: tuple[DamWaterLevelReading, ...]
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class DamWaterLevelSyncResult:
    source_observed_at: datetime
    dam_count: int
    observation_count: int
    created_count: int
    updated_count: int
    unchanged_count: int
    image_saved: bool
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class _DamTableCell:
    text: str
    data_id: str | None
    rowspan: int
    colspan: int


class _DamTableParser(HTMLParser):
    """Extract the table without depending on a third-party HTML parser."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[_DamTableCell]] = []
        self._in_dam_table = False
        self._current_row: list[_DamTableCell] | None = None
        self._current_cell_tag: str | None = None
        self._current_cell_parts: list[str] = []
        self._current_cell_attrs: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table" and not self._in_dam_table:
            attr_map = {key: value or "" for key, value in attrs}
            classes = set(attr_map.get("class", "").split())
            if "dam-table" in classes:
                self._in_dam_table = True
            return

        if not self._in_dam_table:
            return

        if tag == "tr":
            self._finish_cell()
            self._finish_row()
            self._current_row = []
        elif tag in {"td", "th"} and self._current_row is not None:
            self._finish_cell()
            self._current_cell_tag = tag
            self._current_cell_parts = []
            self._current_cell_attrs = {
                key: value or "" for key, value in attrs
            }

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if not self._in_dam_table:
            return

        if tag in {"td", "th"}:
            self._finish_cell()
        elif tag == "tr":
            self._finish_cell()
            self._finish_row()
            self._current_row = None
        elif tag == "table":
            self._finish_cell()
            self._finish_row()
            self._current_row = None
            self._in_dam_table = False

    def handle_data(self, data: str) -> None:
        if self._in_dam_table and self._current_cell_tag is not None:
            self._current_cell_parts.append(data)

    def _finish_cell(self) -> None:
        if self._current_cell_tag is None or self._current_row is None:
            return

        def positive_span(name: str) -> int:
            try:
                return max(1, int(self._current_cell_attrs.get(name, "1")))
            except (TypeError, ValueError):
                return 1

        attrs = self._current_cell_attrs
        self._current_row.append(
            _DamTableCell(
                text=_normalize_text(" ".join(self._current_cell_parts)),
                data_id=_normalize_text(attrs.get("data-id", "")) or None,
                rowspan=positive_span("rowspan"),
                colspan=positive_span("colspan"),
            )
        )
        self._current_cell_tag = None
        self._current_cell_parts = []
        self._current_cell_attrs = {}

    def _finish_row(self) -> None:
        if self._current_row:
            self.rows.append(self._current_row)
        self._current_row = None


def _normalize_text(value: str) -> str:
    return " ".join(html.unescape(value).split())


def _normalize_meridiem(value: str) -> str:
    return re.sub(
        r"([ap])\s*\.?\s*m\.?",
        lambda match: f"{match.group(1).upper()}M",
        value,
        flags=re.IGNORECASE,
    )


def _expand_table_rows(
    rows: Iterable[list[_DamTableCell]],
) -> list[list[tuple[str, str | None]]]:
    """Expand HTML row/column spans so each reading has stable column indexes."""

    active: dict[int, tuple[_DamTableCell, int]] = {}
    expanded: list[list[tuple[str, str | None]]] = []

    for source_row in rows:
        grid: list[tuple[str, str | None] | None] = []
        next_active: dict[int, tuple[_DamTableCell, int]] = {}

        def set_cell(column: int, cell: _DamTableCell) -> None:
            while len(grid) <= column:
                grid.append(None)
            grid[column] = (cell.text, cell.data_id)

        for column, (cell, remaining_rows) in sorted(active.items()):
            set_cell(column, cell)
            if remaining_rows > 1:
                next_active[column] = (cell, remaining_rows - 1)

        column = 0
        for cell in source_row:
            while column < len(grid) and grid[column] is not None:
                column += 1
            while any(
                index < len(grid) and grid[index] is not None
                for index in range(column, column + cell.colspan)
            ):
                column += 1

            for offset in range(cell.colspan):
                target_column = column + offset
                set_cell(target_column, cell)
                if cell.rowspan > 1:
                    next_active[target_column] = (cell, cell.rowspan - 1)
            column += cell.colspan

        active = next_active
        expanded.append(
            [cell for cell in grid if cell is not None]
        )

    return expanded


def _parse_source_timestamp(raw_html: str) -> datetime:
    timestamp_pattern = re.compile(
        r"([A-Za-z]+\s+\d{1,2},\s*\d{4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*"
        r"(?:a\.?\s*m\.?|p\.?\s*m\.?))",
        re.IGNORECASE,
    )
    visible_text = re.sub(r"<[^>]*>", " ", raw_html)
    match = timestamp_pattern.search(_normalize_text(visible_text))
    if not match:
        raise DamWaterLevelError(
            "PAGASA dam page did not contain a recognizable observation timestamp."
        )

    value = _normalize_meridiem(re.sub(r"\s+", " ", match.group(1)))
    value = re.sub(r"(\d{4}),\s+", r"\1 ", value)
    for format_string in (
        "%B %d, %Y %I:%M:%S %p",
        "%B %d, %Y %I:%M %p",
        "%B %d,%Y %I:%M:%S %p",
        "%B %d,%Y %I:%M %p",
    ):
        try:
            return datetime.strptime(value, format_string).replace(tzinfo=MANILA_TIMEZONE)
        except ValueError:
            continue
    raise DamWaterLevelError(
        f"PAGASA dam page timestamp could not be parsed: {match.group(1)}"
    )


def _parse_observation_datetime(
    time_label: str,
    date_label: str,
    source_observed_at: datetime,
) -> datetime:
    time_match = re.search(
        r"\b\d{1,2}:\d{2}(?::\d{2})?\s*[AP]\.?\s*M\.?\b",
        time_label,
        re.IGNORECASE,
    )
    date_match = re.search(r"\b([A-Za-z]{3})[-\s](\d{1,2})\b", date_label)
    if not time_match or not date_match:
        raise DamWaterLevelError(
            f"PAGASA dam observation date/time could not be parsed: {time_label} {date_label}"
        )

    time_value = _normalize_meridiem(re.sub(r"\s+", " ", time_match.group(0)))
    time_formats = ("%I:%M:%S %p", "%I:%M %p")
    parsed_time = None
    for format_string in time_formats:
        try:
            parsed_time = datetime.strptime(time_value, format_string).time()
            break
        except ValueError:
            continue
    if parsed_time is None:
        raise DamWaterLevelError(
            f"PAGASA dam observation time could not be parsed: {time_label}"
        )

    month_text, day_text = date_match.groups()
    try:
        candidate = datetime.strptime(
            f"{month_text}-{day_text}-{source_observed_at.year}",
            "%b-%d-%Y",
        ).date()
    except ValueError as exc:
        raise DamWaterLevelError(
            f"PAGASA dam observation date could not be parsed: {date_label}"
        ) from exc

    if candidate > source_observed_at.date():
        candidate = candidate.replace(year=candidate.year - 1)
    return datetime.combine(candidate, parsed_time, tzinfo=MANILA_TIMEZONE)


def _parse_decimal(
    value: str,
    label: str,
    *,
    last_number: bool = False,
) -> Decimal | None:
    normalized = _normalize_text(value).replace(",", "")
    if not normalized or normalized in {"-", "—", "–", "N/A", "NA"}:
        return None
    matches = re.findall(r"[-+]?\d+(?:\.\d+)?", normalized)
    if not matches:
        raise DamWaterLevelError(f"Invalid {label} value from PAGASA: {value!r}")
    try:
        return Decimal(matches[-1] if last_number else matches[0])
    except InvalidOperation as exc:
        raise DamWaterLevelError(f"Invalid {label} value from PAGASA: {value!r}") from exc


def _parse_gate_count(value: str) -> int | None:
    parsed = _parse_decimal(value, "gate count")
    if parsed is None:
        return None
    if parsed != parsed.to_integral_value() or parsed < 0:
        raise DamWaterLevelError(f"Invalid gate count value from PAGASA: {value!r}")
    return int(parsed)


def _parse_reading(row: list[tuple[str, str | None]], dam_name: str, observed_at: datetime) -> DamWaterLevelReading:
    if len(row) < 13:
        raise DamWaterLevelError(
            f"PAGASA dam row for {dam_name} had {len(row)} columns; expected at least 13."
        )

    return DamWaterLevelReading(
        dam_name=dam_name,
        observed_at=observed_at,
        reservoir_water_level_m=_parse_decimal(row[2][0], "reservoir water level"),
        water_level_deviation_hours=_parse_decimal(row[3][0], "water-level deviation hours"),
        water_level_deviation_m=_parse_decimal(row[4][0], "water-level deviation"),
        normal_high_water_level_m=_parse_decimal(row[5][0], "normal high water level"),
        deviation_from_nhwl_m=_parse_decimal(row[6][0], "deviation from NHWL"),
        rule_curve_elevation_m=_parse_decimal(row[7][0], "rule curve elevation"),
        deviation_from_rule_curve_m=_parse_decimal(row[8][0], "deviation from rule curve"),
        gate_count=_parse_gate_count(row[9][0]),
        gate_opening_m=_parse_decimal(row[10][0], "gate opening", last_number=True),
        estimated_inflow_cms=_parse_decimal(row[11][0], "estimated inflow"),
        estimated_outflow_cms=_parse_decimal(row[12][0], "estimated outflow"),
    )


def parse_pagasa_dam_water_levels(raw_html: bytes | str) -> ParsedDamWaterLevels:
    """Parse the current and previous reading rows from PAGASA's dam table."""

    if isinstance(raw_html, bytes):
        try:
            text = raw_html.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise DamWaterLevelError("PAGASA dam page was not valid UTF-8.") from exc
    else:
        text = raw_html

    source_observed_at = _parse_source_timestamp(text)
    parser = _DamTableParser()
    parser.feed(text)
    parser.close()
    expanded_rows = _expand_table_rows(parser.rows)
    if not expanded_rows:
        raise DamWaterLevelError("PAGASA dam page did not contain a dam-information table.")

    groups: OrderedDict[str, list[list[tuple[str, str | None]]]] = OrderedDict()
    current_dam_data_id = None
    for row in expanded_rows:
        dam_data_id = next((data_id for _, data_id in row if data_id), None)
        if dam_data_id:
            current_dam_data_id = dam_data_id
            groups.setdefault(dam_data_id, []).append(row)
        elif current_dam_data_id:
            groups[current_dam_data_id].append(row)
        else:
            continue

    if not groups:
        raise DamWaterLevelError("PAGASA dam page did not contain a dam-information table.")

    readings: list[DamWaterLevelReading] = []
    warnings: list[str] = []
    seen_keys: set[tuple[str, datetime]] = set()
    for rows in groups.values():
        if len(rows) % 2:
            warnings.append(
                f"Skipped an incomplete observation row for {rows[0][0][0] or 'unknown dam'}."
            )
        for row_index in range(0, len(rows) - 1, 2):
            time_row = rows[row_index]
            date_row = rows[row_index + 1]
            dam_data_id = next((data_id for _, data_id in time_row if data_id), None)
            dam_name = next(
                (
                    _normalize_text(text)
                    for text, data_id in time_row
                    if data_id == dam_data_id
                ),
                "",
            )
            time_label = next(
                (
                    text
                    for text, _ in time_row
                    if re.search(r"\b\d{1,2}:\d{2}", text)
                ),
                "",
            )
            date_label = next(
                (
                    text
                    for text, _ in date_row
                    if re.search(r"\b[A-Za-z]{3}[-\s]\d{1,2}\b", text)
                ),
                "",
            )
            if not dam_name or not time_label or not date_label:
                warnings.append("Skipped an incomplete PAGASA dam observation row.")
                continue
            observed_at = _parse_observation_datetime(
                time_label,
                date_label,
                source_observed_at,
            )
            reading = _parse_reading(time_row, dam_name, observed_at)
            reading_key = (dam_name, observed_at)
            if reading_key in seen_keys:
                raise DamWaterLevelError(
                    f"PAGASA dam page contained duplicate reading for {dam_name} at {observed_at.isoformat()}."
                )
            seen_keys.add(reading_key)
            readings.append(reading)

    if not readings:
        raise DamWaterLevelError("PAGASA dam page did not contain usable dam readings.")
    return ParsedDamWaterLevels(
        source_observed_at=source_observed_at,
        readings=tuple(readings),
        warnings=tuple(warnings),
    )


def _fetch_source(url: str, accept: str, max_bytes: int) -> tuple[bytes, str]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": accept,
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "DamWaterLevelsMonitoring/1.0 (+https://www.pagasa.dost.gov.ph/flood)",
        },
    )
    try:
        with urllib.request.urlopen(
            request,
            context=_pagasa_ssl_context(),
            timeout=PAGASA_FETCH_TIMEOUT_SECONDS,
        ) as response:
            content = response.read(max_bytes + 1)
            content_type = response.headers.get_content_type()
    except (OSError, urllib.error.URLError) as exc:
        raise DamWaterLevelFetchError(f"Could not fetch PAGASA source: {url}") from exc
    if len(content) > max_bytes:
        raise DamWaterLevelFetchError(f"PAGASA source exceeded the {max_bytes} byte limit.")
    return content, content_type


def fetch_pagasa_dam_page() -> bytes:
    url = f"{PAGASA_DAM_PAGE_URL}?_={time.time_ns()}"
    return _fetch_source(url, "text/html", MAX_PAGE_BYTES)[0]


def fetch_pagasa_dam_status_image() -> tuple[bytes, str]:
    url = f"{PAGASA_DAM_STATUS_IMAGE_URL}?_={time.time_ns()}"
    content, content_type = _fetch_source(
        url,
        "image/gif,image/*;q=0.9",
        MAX_IMAGE_BYTES,
    )
    if content_type not in {"image/gif", "image/png", "image/jpeg", "image/webp"}:
        raise DamWaterLevelFetchError(
            f"PAGASA status image returned unexpected content type: {content_type}"
        )
    return content, content_type


def fetch_pagasa_dam_chart(dam_name: str) -> dict[str, object]:
    """Fetch one source-style annual chart payload for an active dam."""
    url = f"{PAGASA_DAM_CHART_API_URL}{quote(dam_name, safe='')}?_={time.time_ns()}"
    request = urllib.request.Request(
        url,
        data=b"",
        method="POST",
        headers={
            "Accept": "application/json",
            "Cache-Control": "no-cache",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": "https://pagasa.dost.gov.ph",
            "Pragma": "no-cache",
            "Referer": "https://pagasa.dost.gov.ph/flood",
            "User-Agent": "DamWaterLevelsMonitoring/1.0 (+https://www.pagasa.dost.gov.ph/flood)",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    try:
        with urllib.request.urlopen(
            request,
            context=_pagasa_ssl_context(),
            timeout=PAGASA_FETCH_TIMEOUT_SECONDS,
        ) as response:
            content = response.read(MAX_CHART_BYTES + 1)
    except (OSError, urllib.error.URLError) as exc:
        raise DamWaterLevelFetchError("Could not fetch the PAGASA dam chart.") from exc
    if len(content) > MAX_CHART_BYTES:
        raise DamWaterLevelFetchError(
            f"PAGASA dam chart exceeded the {MAX_CHART_BYTES} byte limit."
        )
    try:
        payload = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DamWaterLevelFetchError("PAGASA returned an invalid dam chart.") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        raise DamWaterLevelFetchError("PAGASA returned no usable dam chart data.")
    return payload


def dam_key_for_name(name: str) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")
    key = f"PAGASA_{normalized or 'UNKNOWN'}"
    if len(key) > 64:
        key = f"{key[:55]}_{hashlib.sha256(name.encode('utf-8')).hexdigest()[:8]}"
    return key


def _reading_payload(reading: DamWaterLevelReading) -> dict[str, object]:
    """Serialize one parsed reading for the browser-facing summary payload."""

    return {
        "observed_at": reading.observed_at.isoformat(),
        "reservoir_water_level_m": _decimal_text(reading.reservoir_water_level_m),
        "water_level_deviation_hours": _decimal_text(reading.water_level_deviation_hours),
        "water_level_deviation_m": _decimal_text(reading.water_level_deviation_m),
        "normal_high_water_level_m": _decimal_text(reading.normal_high_water_level_m),
        "deviation_from_nhwl_m": _decimal_text(reading.deviation_from_nhwl_m),
        "rule_curve_elevation_m": _decimal_text(reading.rule_curve_elevation_m),
        "deviation_from_rule_curve_m": _decimal_text(reading.deviation_from_rule_curve_m),
        "gate_count": reading.gate_count,
        "gate_opening_m": _decimal_text(reading.gate_opening_m),
        "estimated_inflow_cms": _decimal_text(reading.estimated_inflow_cms),
        "estimated_outflow_cms": _decimal_text(reading.estimated_outflow_cms),
    }


def _decimal_text(value: Decimal | None) -> str | None:
    return str(value) if value is not None else None


def build_live_summary(delivery: str = "live") -> dict[str, object]:
    """Fetch and normalize the current PAGASA summary without a database."""

    parsed = parse_pagasa_dam_water_levels(fetch_pagasa_dam_page())
    grouped: OrderedDict[str, list[DamWaterLevelReading]] = OrderedDict()
    for reading in parsed.readings:
        grouped.setdefault(reading.dam_name, []).append(reading)

    readings = []
    for dam_name in sorted(grouped):
        dam_readings = sorted(
            grouped[dam_name],
            key=lambda item: item.observed_at,
            reverse=True,
        )
        current = dam_readings[0]
        readings.append({
            "dam_key": dam_key_for_name(dam_name),
            "dam_name": dam_name,
            "current_value": _decimal_text(current.reservoir_water_level_m),
            "observed_at": current.observed_at.isoformat(),
            "observed_month_day": f"{current.observed_at.month}/{current.observed_at.day}",
            "normal_high_water_level_m": _decimal_text(current.normal_high_water_level_m),
            "rule_curve_elevation_m": _decimal_text(current.rule_curve_elevation_m),
            "current": _reading_payload(current),
            "previous": _reading_payload(dam_readings[1]) if len(dam_readings) > 1 else None,
        })

    return {
        "source": {
            "url": PAGASA_DAM_PAGE_URL,
            "observed_at": parsed.source_observed_at.isoformat(),
            "retrieved_at": timezone.now().isoformat(),
            "delivery": delivery,
        },
        "present_year": timezone.localdate().year,
        "readings": readings,
        "warnings": list(parsed.warnings),
        "status_image_url": PAGASA_DAM_STATUS_IMAGE_URL,
        "chart_api_url": PAGASA_DAM_CHART_API_URL,
    }
