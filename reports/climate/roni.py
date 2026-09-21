from __future__ import annotations

import calendar
import logging
import ssl
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import certifi
from django.db import transaction
from django.utils import timezone

from reports.models import ClimateIndex, ClimateIndexObservation

RONI_INDEX_KEY = "RONI"
RONI_INDEX_NAME = "Relative Oceanic Niño Index"
RONI_DOCUMENTATION_URL = (
    "https://www.cpc.ncep.noaa.gov/"
    "products/analysis_monitoring/enso/roni/"
)
RONI_DATA_URL = (
    "https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt"
)
RONI_BASE_PERIOD = "1991–2020"
RONI_MIN_COMPLETE_OBSERVATIONS = 800

RONI_EPISODE_THRESHOLD = Decimal("0.50")
RONI_EPISODE_MIN_SEASONS = 5
RONI_FETCH_TIMEOUT_SECONDS = 20
logger = logging.getLogger(__name__)

_SEASON_CENTER_MONTHS = {
    "DJF": 1,
    "JFM": 2,
    "FMA": 3,
    "MAM": 4,
    "AMJ": 5,
    "MJJ": 6,
    "JJA": 7,
    "JAS": 8,
    "ASO": 9,
    "SON": 10,
    "OND": 11,
    "NDJ": 12,
}

RONI_SEASON_CODES = tuple(_SEASON_CENTER_MONTHS)


class RoniSourceError(ValueError):
    """Raised when a RONI source cannot be safely parsed or synchronized."""


@dataclass(frozen=True, slots=True)
class ParsedRoniObservation:
    season_code: str
    season_year: int
    period_start_date: date
    period_center_date: date
    period_end_date: date
    value: Decimal


@dataclass(frozen=True, slots=True)
class RoniSyncResult:
    source_count: int
    index_created: bool
    created_count: int
    updated_count: int
    unchanged_count: int
    provisional_count: int


def fetch_roni_text(
    url: str = RONI_DATA_URL,
    *,
    timeout: int = RONI_FETCH_TIMEOUT_SECONDS,
) -> str:
    """Fetch the configured NOAA source for an explicit manual refresh.

    The library never fetches during a normal page view. This helper is used
    only by the protected refresh action (and can be reused by a scheduler),
    keeping network failures separate from parsing and database errors.
    """
    request = Request(
        url,
        headers={"User-Agent": "DCIO Data Studio RONI updater"},
    )
    try:
        context = ssl.create_default_context(cafile=certifi.where())
        with urlopen(request, timeout=timeout, context=context) as response:
            payload = response.read()
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
        logger.warning("RONI source download failed for %s: %s", url, exc)
        raise RoniSourceError(
            "The NOAA RONI source could not be downloaded. Try again later."
        ) from exc

    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RoniSourceError(
            "The NOAA RONI source is not valid UTF-8 text."
        ) from exc


def _shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    absolute_month = (year * 12) + (month - 1) + offset
    shifted_year, shifted_month = divmod(absolute_month, 12)
    return shifted_year, shifted_month + 1


def season_period(
    season_code: str,
    season_year: int,
) -> tuple[date, date, date]:
    try:
        center_month = _SEASON_CENTER_MONTHS[season_code]
    except KeyError as exc:
        raise RoniSourceError(
            f"Unsupported RONI season code: {season_code!r}."
        ) from exc

    if not 2 <= season_year <= 9998:
        raise RoniSourceError(
            f"RONI season year is outside the supported range: {season_year}."
        )

    start_year, start_month = _shift_month(
        season_year,
        center_month,
        -1,
    )
    end_year, end_month = _shift_month(
        season_year,
        center_month,
        1,
    )

    start_date = date(start_year, start_month, 1)
    center_date = date(season_year, center_month, 1)
    end_date = date(
        end_year,
        end_month,
        calendar.monthrange(end_year, end_month)[1],
    )

    return start_date, center_date, end_date


def _next_month(value: date) -> date:
    year, month = _shift_month(value.year, value.month, 1)
    return date(year, month, 1)


def parse_roni_text(text: str) -> tuple[ParsedRoniObservation, ...]:
    numbered_lines = [
        (line_number, line.strip())
        for line_number, line in enumerate(text.splitlines(), start=1)
        if line.strip()
    ]

    if not numbered_lines:
        raise RoniSourceError("The NOAA RONI source is empty.")

    header_number, header = numbered_lines[0]
    if header.split() != ["SEAS", "YR", "ANOM"]:
        raise RoniSourceError(
            f"Unexpected RONI header on line {header_number}: {header!r}."
        )

    observations: list[ParsedRoniObservation] = []
    seen_seasons: set[tuple[int, str]] = set()
    previous_center_date: date | None = None

    for line_number, line in numbered_lines[1:]:
        columns = line.split()

        if len(columns) != 3:
            raise RoniSourceError(
                f"Expected three columns on line {line_number}; "
                f"found {len(columns)}."
            )

        season_code, raw_year, raw_value = columns

        if season_code not in _SEASON_CENTER_MONTHS:
            raise RoniSourceError(
                f"Unknown season code on line {line_number}: "
                f"{season_code!r}."
            )

        try:
            season_year = int(raw_year)
        except ValueError as exc:
            raise RoniSourceError(
                f"Invalid year on line {line_number}: {raw_year!r}."
            ) from exc

        try:
            value = Decimal(raw_value)
        except InvalidOperation as exc:
            raise RoniSourceError(
                f"Invalid RONI value on line {line_number}: "
                f"{raw_value!r}."
            ) from exc

        if not value.is_finite():
            raise RoniSourceError(
                f"Non-finite RONI value on line {line_number}."
            )

        if value.as_tuple().exponent < -2:
            raise RoniSourceError(
                f"RONI value has more than two decimal places on "
                f"line {line_number}: {raw_value!r}."
            )

        if abs(value) > Decimal("99.99"):
            raise RoniSourceError(
                f"RONI value is outside the supported range on "
                f"line {line_number}: {raw_value!r}."
            )

        season_identity = (season_year, season_code)
        if season_identity in seen_seasons:
            raise RoniSourceError(
                f"Duplicate RONI season on line {line_number}: "
                f"{season_code} {season_year}."
            )
        seen_seasons.add(season_identity)

        start_date, center_date, end_date = season_period(
            season_code,
            season_year,
        )

        if (
            previous_center_date is not None
            and center_date != _next_month(previous_center_date)
        ):
            raise RoniSourceError(
                f"RONI seasons are not continuous at line {line_number}; "
                f"expected center month "
                f"{_next_month(previous_center_date):%Y-%m}, "
                f"found {center_date:%Y-%m}."
            )

        observations.append(
            ParsedRoniObservation(
                season_code=season_code,
                season_year=season_year,
                period_start_date=start_date,
                period_center_date=center_date,
                period_end_date=end_date,
                value=value,
            )
        )
        previous_center_date = center_date

    if not observations:
        raise RoniSourceError(
            "The NOAA RONI source contains no observations."
        )

    return tuple(observations)


def classify_roni_episode_phases(
    observations,
) -> dict[date, str]:
    """
    Classify observations using NOAA's historical episode convention.

    A warm or cold threshold value is colored only when it belongs to
    at least five consecutive overlapping three-month seasons.
    """
    ordered = sorted(
        observations,
        key=lambda observation: observation.period_center_date,
    )
    phases = {
        observation.period_center_date: "neutral"
        for observation in ordered
    }

    run_phase: str | None = None
    run_observations = []
    previous_center_date: date | None = None

    def finalize_run() -> None:
        if len(run_observations) < RONI_EPISODE_MIN_SEASONS:
            return

        for run_observation in run_observations:
            phases[run_observation.period_center_date] = run_phase

    for observation in ordered:
        if observation.value > RONI_EPISODE_THRESHOLD:
            candidate_phase = "warm"
        elif observation.value < -RONI_EPISODE_THRESHOLD:
            candidate_phase = "cold"
        else:
            candidate_phase = None

        is_consecutive = (
            previous_center_date is not None
            and observation.period_center_date
            == _next_month(previous_center_date)
        )

        if (
            candidate_phase is not None
            and candidate_phase == run_phase
            and is_consecutive
        ):
            run_observations.append(observation)
        else:
            finalize_run()
            run_phase = candidate_phase
            run_observations = (
                [observation]
                if candidate_phase is not None
                else []
            )

        previous_center_date = observation.period_center_date

    finalize_run()
    return phases


def validate_complete_roni_source(
    observations: tuple[ParsedRoniObservation, ...],
) -> None:
    if len(observations) < RONI_MIN_COMPLETE_OBSERVATIONS:
        raise RoniSourceError(
            "The RONI source appears incomplete: "
            f"expected at least {RONI_MIN_COMPLETE_OBSERVATIONS} "
            f"observations, found {len(observations)}."
        )

    first = observations[0]
    if first.season_code != "DJF" or first.season_year != 1950:
        raise RoniSourceError(
            "The complete NOAA RONI source must begin with DJF 1950."
        )


def _provisional_cutoff(
    observations: tuple[ParsedRoniObservation, ...],
) -> date:
    latest = observations[-1].period_center_date
    year, month = _shift_month(latest.year, latest.month, -2)
    return date(year, month, 1)


@transaction.atomic
def sync_roni_observations(
    observations: tuple[ParsedRoniObservation, ...],
    *,
    retrieved_at=None,
) -> RoniSyncResult:
    if not observations:
        raise RoniSourceError(
            "At least one parsed RONI observation is required."
        )

    retrieved_at = retrieved_at or timezone.now()

    climate_index, index_created = ClimateIndex.objects.update_or_create(
        climate_index_key=RONI_INDEX_KEY,
        defaults={
            "index_name": RONI_INDEX_NAME,
            "description": (
                "Three-month running mean of the relative Niño 3.4 "
                "sea-surface-temperature anomaly index."
            ),
            "unit": "degrees Celsius",
            "source_agency": "NOAA Climate Prediction Center",
            "documentation_url": RONI_DOCUMENTATION_URL,
            "data_url": RONI_DATA_URL,
            "base_period": RONI_BASE_PERIOD,
            "is_active": True,
        },
    )

    existing_by_center = {
        observation.period_center_date: observation
        for observation in ClimateIndexObservation.objects.filter(
            climate_index=climate_index
        )
    }

    provisional_cutoff = _provisional_cutoff(observations)
    new_observations: list[ClimateIndexObservation] = []
    changed_observations: list[ClimateIndexObservation] = []
    provisional_count = 0

    compared_fields = (
        "season_code",
        "season_year",
        "period_start_date",
        "period_center_date",
        "period_end_date",
        "value",
        "is_provisional",
    )

    for parsed in observations:
        is_provisional = (
            parsed.period_center_date >= provisional_cutoff
        )

        if is_provisional:
            provisional_count += 1

        desired = {
            "season_code": parsed.season_code,
            "season_year": parsed.season_year,
            "period_start_date": parsed.period_start_date,
            "period_center_date": parsed.period_center_date,
            "period_end_date": parsed.period_end_date,
            "value": parsed.value,
            "is_provisional": is_provisional,
        }

        existing = existing_by_center.get(parsed.period_center_date)

        if existing is None:
            new_observations.append(
                ClimateIndexObservation(
                    climate_index=climate_index,
                    retrieved_at=retrieved_at,
                    created_at=retrieved_at,
                    updated_at=retrieved_at,
                    **desired,
                )
            )
            continue

        if all(
            getattr(existing, field_name) == desired[field_name]
            for field_name in compared_fields
        ):
            continue

        for field_name, field_value in desired.items():
            setattr(existing, field_name, field_value)

        existing.retrieved_at = retrieved_at
        existing.updated_at = retrieved_at
        changed_observations.append(existing)

    if new_observations:
        ClimateIndexObservation.objects.bulk_create(new_observations)

    if changed_observations:
        ClimateIndexObservation.objects.bulk_update(
            changed_observations,
            fields=[
                "season_code",
                "season_year",
                "period_start_date",
                "period_center_date",
                "period_end_date",
                "value",
                "is_provisional",
                "retrieved_at",
                "updated_at",
            ],
        )

    created_count = len(new_observations)
    updated_count = len(changed_observations)

    return RoniSyncResult(
        source_count=len(observations),
        index_created=index_created,
        created_count=created_count,
        updated_count=updated_count,
        unchanged_count=(
            len(observations) - created_count - updated_count
        ),
        provisional_count=provisional_count,
    )
