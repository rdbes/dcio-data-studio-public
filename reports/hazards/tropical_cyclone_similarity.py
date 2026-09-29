"""Similarity scoring for operational and historical tropical-cyclone tracks."""

from __future__ import annotations

import calendar
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Iterable

from django.conf import settings
from django.db.models import Count, Q

from reports.hazards.tropical_cyclone_tracks import (
    HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE,
)
from reports.hazards.tropical_cyclones import (
    TROPICAL_CYCLONE_HAZARD_KEY,
    occurrence_month,
)
from reports.models import (
    DisasterIncidentTropicalCyclone,
    TropicalCyclone,
    TropicalCycloneTrackPoint,
)

DEFAULT_SIMILARITY_WEIGHTS = {
    "track": 50,
    "pressure": 25,
    "wind": 15,
    "intensity": 10,
}
DTW_BAND_FRACTION = 0.25

INTENSITY_RANKS = {
    "LPA": 0,
    "TD": 1,
    "TS": 2,
    "STS": 3,
    "TY": 4,
    "STY": 5,
}
INTENSITY_ALIASES = {
    "LOW PRESSURE AREA": "LPA",
    "TROPICAL DEPRESSION": "TD",
    "TROPICAL STORM": "TS",
    "SEVERE TROPICAL STORM": "STS",
    "TYPHOON": "TY",
    "SUPER TYPHOON": "STY",
}

HISTORICAL_SOURCE_LABELS = dict(TropicalCycloneTrackPoint.SourceType.choices)

CLIMATOLOGY_MONTHS = tuple(
    (month_number, calendar.month_name[month_number].lower())
    for month_number in range(1, 13)
)


def _intensity_code(value: str | None) -> str:
    normalized = " ".join(str(value or "").strip().upper().split())
    return INTENSITY_ALIASES.get(
        normalized,
        normalized if normalized in INTENSITY_RANKS else "",
    )


def _track_name(cyclone: TropicalCyclone) -> str:
    if cyclone.cyclone_name and cyclone.international_name:
        return f"{cyclone.cyclone_name} {{{cyclone.international_name}}}"
    if cyclone.international_name:
        return f"{{{cyclone.international_name}}}"
    return (
        cyclone.cyclone_name
        or "Unnamed Tropical Cyclone"
    )


def build_climatology_reference_paths() -> dict[str, list[dict]]:
    """Load the cleaned, manually traced monthly reference paths."""

    artifact_root = Path(settings.BASE_DIR) / "artifacts" / "tc-summary-tracks"
    references = {}
    for month_number, month_slug in CLIMATOLOGY_MONTHS:
        source_path = (
            artifact_root
            / f"review-{month_slug}"
            / f"{month_slug}-tracks-par.geojson"
        )
        if not source_path.is_file():
            references[str(month_number)] = []
            continue
        try:
            payload = json.loads(source_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            references[str(month_number)] = []
            continue

        paths = []
        for feature in payload.get("features", []):
            properties = feature.get("properties") or {}
            geometry = feature.get("geometry") or {}
            coordinates = geometry.get("coordinates") or []
            if properties.get("id") == "par" or geometry.get("type") != "LineString":
                continue
            points = []
            for coordinate in coordinates:
                if len(coordinate) < 2:
                    continue
                longitude, latitude = coordinate[:2]
                try:
                    points.append({
                        "latitude": float(latitude),
                        "longitude": float(longitude),
                    })
                except (TypeError, ValueError):
                    continue
            if len(points) < 2:
                continue
            path_number = len(paths) + 1
            paths.append({
                "id": properties.get("id") or f"{month_slug}-{path_number:02d}",
                "label": f"{calendar.month_name[month_number]} common path {path_number}",
                "points": points,
                "source_label": "Cleaned monthly PAGASA climatology trace",
                "method": properties.get("method", "Manual reference trace"),
            })
        references[str(month_number)] = paths
    return references


def serialize_similarity_point(point) -> dict:
    """Serialize the fields used by the scoring engine and map."""

    return {
        "valid_at": point.valid_at.isoformat().replace("+00:00", "Z"),
        "latitude": float(point.latitude),
        "longitude": float(point.longitude),
        "intensity_code": _intensity_code(point.intensity_code),
        "central_pressure_hpa": point.central_pressure_hpa,
        "maximum_wind_kt": point.maximum_wind_kt,
    }


def serialize_similarity_track(
    cyclone: TropicalCyclone,
    points: Iterable,
    *,
    source_label: str,
    track_kind: str,
    damage_status: dict | None = None,
) -> dict:
    source_points = list(points)
    serialized_points = [serialize_similarity_point(point) for point in source_points]
    latest_point = serialized_points[-1] if serialized_points else None
    occurrence_month_value = occurrence_month(cyclone, source_points)
    return {
        "cyclone_key": cyclone.cyclone_key,
        "cyclone_name": cyclone.cyclone_name or "",
        "international_name": cyclone.international_name or "",
        "display_name": _track_name(cyclone),
        "occurrence_year": cyclone.occurrence_year,
        "occurrence_month": occurrence_month_value,
        "occurrence_month_label": (
            calendar.month_name[occurrence_month_value]
            if occurrence_month_value
            else ""
        ),
        "source_label": source_label,
        "track_kind": track_kind,
        "has_damage_report": bool((damage_status or {}).get("has_damage_report")),
        "has_combined_damage_report": bool(
            (damage_status or {}).get("has_combined_damage_report")
        ),
        "damage_report_incident_key": (damage_status or {}).get(
            "incident_key",
            "",
        ),
        "damage_report_incident_name": (damage_status or {}).get(
            "incident_name",
            "",
        ),
        "point_count": len(serialized_points),
        "points": serialized_points,
        "latest_valid_at": latest_point["valid_at"] if latest_point else "",
        "latest_latitude": latest_point["latitude"] if latest_point else None,
        "latest_longitude": latest_point["longitude"] if latest_point else None,
        "latest_pressure_hpa": (
            latest_point["central_pressure_hpa"] if latest_point else None
        ),
        "latest_wind_kt": (
            latest_point["maximum_wind_kt"] if latest_point else None
        ),
        "peak_intensity": cyclone.peak_intensity or "",
    }


def _historical_points_by_source() -> dict[str, dict[tuple[str, str], list]]:
    source_types = [
        source_type
        for source_type, _source_agency, _source_label
        in HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE
    ]
    points = (
        TropicalCycloneTrackPoint.objects.filter(
            source_type__in=source_types,
            cyclone_key__is_active=True,
        )
        .exclude(cyclone_key__catalog_source=(
            TropicalCyclone.CatalogSource.PAGASA_OPERATIONAL_TRACK
        ))
        .select_related("cyclone_key")
        .order_by("cyclone_key_id", "valid_at", "track_point_key")
    )
    grouped = defaultdict(lambda: defaultdict(list))
    for point in points:
        grouped[point.cyclone_key_id][
            (point.source_type, point.source_agency or "")
        ].append(point)
    return grouped


def build_historical_similarity_tracks() -> list[dict]:
    """Return one coherent best-track candidate per historical cyclone."""

    grouped = _historical_points_by_source()
    source_rank = {
        source_type: rank
        for rank, (source_type, _source_agency, _source_label) in enumerate(
            HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE
        )
    }
    tracks = []
    damage_incident_by_cyclone = {}
    for row in (
        DisasterIncidentTropicalCyclone.objects.filter(
            cyclone_key_id__in=grouped,
            incident_key__hazard_key_id=TROPICAL_CYCLONE_HAZARD_KEY,
            incident_key__damagereport__is_active=True,
        )
        .values(
            "cyclone_key_id",
            "incident_key_id",
            "incident_key__incident_name",
        )
        .order_by("cyclone_key_id", "incident_key_id")
    ):
        damage_incident_by_cyclone.setdefault(
            row["cyclone_key_id"],
            {
                "incident_key": row["incident_key_id"],
                "incident_name": row["incident_key__incident_name"] or "",
            },
        )
    damage_status_by_cyclone = {
        row["cyclone_key"]: {
            "has_damage_report": bool(row["linked_damage_report_count"]),
            "has_combined_damage_report": bool(row["combined_damage_report_count"]),
            **damage_incident_by_cyclone.get(row["cyclone_key"], {}),
        }
        for row in (
            TropicalCyclone.objects.filter(cyclone_key__in=grouped)
            .annotate(
                linked_damage_report_count=Count(
                    "incident_links__incident_key",
                    filter=Q(
                        incident_links__incident_key__hazard_key_id=(
                            TROPICAL_CYCLONE_HAZARD_KEY
                        ),
                        incident_links__incident_key__damagereport__is_active=True,
                    ),
                    distinct=True,
                ),
                combined_damage_report_count=Count(
                    "incident_links__incident_key",
                    filter=Q(
                        incident_links__attribution_method=(
                            DisasterIncidentTropicalCyclone.AttributionMethod.COMBINED
                        ),
                        incident_links__incident_key__hazard_key_id=(
                            TROPICAL_CYCLONE_HAZARD_KEY
                        ),
                        incident_links__incident_key__damagereport__is_active=True,
                    ),
                    distinct=True,
                ),
            )
            .values(
                "cyclone_key",
                "linked_damage_report_count",
                "combined_damage_report_count",
            )
        )
    }
    for source_groups in grouped.values():
        source_type, source_agency = min(
            source_groups,
            key=lambda key: (
                source_rank.get(key[0], len(source_rank)),
                -len(source_groups[key]),
                key[1],
            ),
        )
        points = source_groups[(source_type, source_agency)]
        if len(points) < 2:
            continue
        cyclone = points[0].cyclone_key
        tracks.append(
            serialize_similarity_track(
                cyclone,
                points,
                source_label=HISTORICAL_SOURCE_LABELS.get(
                    source_type,
                    source_type,
                ),
                track_kind="historical",
                damage_status=damage_status_by_cyclone.get(cyclone.cyclone_key),
            )
        )
    return sorted(
        tracks,
        key=lambda track: (
            -track["occurrence_year"],
            track["display_name"].casefold(),
        )
    )


def _clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, value))


def _haversine_km(first: dict, second: dict) -> float:
    latitude_one = math.radians(first["latitude"])
    latitude_two = math.radians(second["latitude"])
    latitude_delta = latitude_two - latitude_one
    longitude_delta = math.radians(second["longitude"] - first["longitude"])
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(latitude_one)
        * math.cos(latitude_two)
        * math.sin(longitude_delta / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(math.sqrt(haversine))


def _interpolate_point(points: list[dict], position: float) -> dict:
    if len(points) == 1:
        return points[0]
    scaled = _clamp(position, 0.0, 1.0) * (len(points) - 1)
    lower_index = min(int(scaled), len(points) - 2)
    fraction = scaled - lower_index
    lower = points[lower_index]
    upper = points[lower_index + 1]
    interpolated = {
        "latitude": lower["latitude"]
        + (upper["latitude"] - lower["latitude"]) * fraction,
        "longitude": lower["longitude"]
        + (upper["longitude"] - lower["longitude"]) * fraction,
    }
    for field in ("central_pressure_hpa", "maximum_wind_kt"):
        first = lower.get(field)
        second = upper.get(field)
        if first is not None and second is not None:
            interpolated[field] = first + (second - first) * fraction
        else:
            interpolated[field] = first if fraction < 0.5 else second
    interpolated["intensity_code"] = (
        lower.get("intensity_code") if fraction < 0.5 else upper.get("intensity_code")
    )
    return interpolated


def _resample_points(points: list[dict], sample_count: int) -> list[dict]:
    """Put two tracks on a common normalized lifecycle grid before DTW."""

    if len(points) == sample_count:
        return points
    return [
        _interpolate_point(points, index / max(1, sample_count - 1))
        for index in range(sample_count)
    ]


def _constrained_dtw_pairs(
    first_points: list[dict],
    second_points: list[dict],
    *,
    band_fraction: float = DTW_BAND_FRACTION,
) -> list[tuple[dict, dict]]:
    """Return the least-cost alignment under a normalized Sakoe-Chiba band.

    Both tracks are resampled to the longer track's point count first. This
    keeps the band meaningful when one source reports more frequent positions,
    while the dynamic-programming path still allows different movement speeds
    and local turning features to align.
    """

    if not first_points or not second_points:
        return []

    sample_count = max(len(first_points), len(second_points))
    first = _resample_points(first_points, sample_count)
    second = _resample_points(second_points, sample_count)
    band = max(1, math.ceil((sample_count - 1) * _clamp(band_fraction, 0.0, 1.0)))
    infinite = float("inf")
    costs = [[infinite] * sample_count for _ in range(sample_count)]
    path_lengths = [[0] * sample_count for _ in range(sample_count)]
    predecessors = [[None] * sample_count for _ in range(sample_count)]

    for first_index in range(sample_count):
        lower = max(0, first_index - band)
        upper = min(sample_count - 1, first_index + band)
        for second_index in range(lower, upper + 1):
            local_cost = _haversine_km(first[first_index], second[second_index])
            if first_index == 0 and second_index == 0:
                costs[first_index][second_index] = local_cost
                path_lengths[first_index][second_index] = 1
                continue

            candidates = []
            if first_index:
                candidates.append((
                    costs[first_index - 1][second_index],
                    path_lengths[first_index - 1][second_index],
                    (first_index - 1, second_index),
                ))
            if second_index:
                candidates.append((
                    costs[first_index][second_index - 1],
                    path_lengths[first_index][second_index - 1],
                    (first_index, second_index - 1),
                ))
            if first_index and second_index:
                candidates.append((
                    costs[first_index - 1][second_index - 1],
                    path_lengths[first_index - 1][second_index - 1],
                    (first_index - 1, second_index - 1),
                ))
            previous_cost, previous_length, predecessor = min(
                candidates,
                key=lambda candidate: (candidate[0], candidate[1]),
            )
            if math.isfinite(previous_cost):
                costs[first_index][second_index] = previous_cost + local_cost
                path_lengths[first_index][second_index] = previous_length + 1
                predecessors[first_index][second_index] = predecessor

    if not math.isfinite(costs[-1][-1]):
        return _constrained_dtw_pairs(
            first_points,
            second_points,
            band_fraction=1.0,
        ) if band_fraction < 1.0 else []

    path = []
    first_index = second_index = sample_count - 1
    while True:
        path.append((first[first_index], second[second_index]))
        predecessor = predecessors[first_index][second_index]
        if predecessor is None:
            break
        first_index, second_index = predecessor
    path.reverse()
    return path


def _metric_score(delta: float, scale: float) -> float:
    return _clamp(100 * math.exp(-max(0.0, delta) / scale))


def score_similarity(
    current_track: dict,
    historical_track: dict,
    weights: dict[str, float] | None = None,
) -> dict:
    """Score a historical track against the observed operational prefix.

    Tracks are compared with constrained Dynamic Time Warping (DTW) over
    Haversine distances, so different movement speeds can align without
    allowing arbitrary lifecycle jumps. Missing pressure, wind, or intensity
    values are omitted and the remaining weights are renormalized.
    """

    current_points = current_track.get("points") or []
    historical_points = historical_track.get("points") or []
    if not current_points or not historical_points:
        return {
            "score": 0.0,
            "track_distance_method": "constrained_dtw",
            "dtw_band_fraction": DTW_BAND_FRACTION,
            "track_score": 0.0,
            "pressure_score": None,
            "wind_score": None,
            "intensity_score": None,
            "mean_track_distance_km": None,
            "mean_pressure_delta_hpa": None,
            "mean_wind_delta_kt": None,
            "matched_points": 0,
            "warping_path_length": 0,
        }

    aligned_pairs = _constrained_dtw_pairs(current_points, historical_points)
    distance_values = []
    pressure_values = []
    wind_values = []
    intensity_values = []
    for current_point, historical_point in aligned_pairs:
        distance_values.append(_haversine_km(current_point, historical_point))
        if (
            current_point.get("central_pressure_hpa") is not None
            and historical_point.get("central_pressure_hpa") is not None
        ):
            pressure_values.append(
                abs(
                    current_point["central_pressure_hpa"]
                    - historical_point["central_pressure_hpa"]
                )
            )
        if (
            current_point.get("maximum_wind_kt") is not None
            and historical_point.get("maximum_wind_kt") is not None
        ):
            wind_values.append(
                abs(
                    current_point["maximum_wind_kt"]
                    - historical_point["maximum_wind_kt"]
                )
            )
        current_intensity = _intensity_code(current_point.get("intensity_code"))
        historical_intensity = _intensity_code(
            historical_point.get("intensity_code")
        )
        if current_intensity in INTENSITY_RANKS and historical_intensity in INTENSITY_RANKS:
            intensity_values.append(
                abs(
                    INTENSITY_RANKS[current_intensity]
                    - INTENSITY_RANKS[historical_intensity]
                )
            )

    mean_distance = sum(distance_values) / len(distance_values)
    pressure_delta = (
        sum(pressure_values) / len(pressure_values) if pressure_values else None
    )
    wind_delta = sum(wind_values) / len(wind_values) if wind_values else None
    intensity_delta = (
        sum(intensity_values) / len(intensity_values)
        if intensity_values
        else None
    )
    scores = {
        "track": _metric_score(mean_distance, 700),
        "pressure": (
            _metric_score(pressure_delta, 20)
            if pressure_delta is not None
            else None
        ),
        "wind": (
            _metric_score(wind_delta, 20) if wind_delta is not None else None
        ),
        "intensity": (
            _metric_score(intensity_delta * 25, 35)
            if intensity_delta is not None
            else None
        ),
    }
    requested_weights = {
        **DEFAULT_SIMILARITY_WEIGHTS,
        **(weights or {}),
    }
    available_weight = sum(
        requested_weights[name]
        for name, value in scores.items()
        if value is not None
    )
    score = (
        sum(
            requested_weights[name] * value
            for name, value in scores.items()
            if value is not None
        )
        / available_weight
        if available_weight
        else 0.0
    )
    return {
        "score": round(score, 1),
        "track_distance_method": "constrained_dtw",
        "dtw_band_fraction": DTW_BAND_FRACTION,
        "track_score": round(scores["track"], 1),
        "pressure_score": (
            round(scores["pressure"], 1)
            if scores["pressure"] is not None
            else None
        ),
        "wind_score": (
            round(scores["wind"], 1) if scores["wind"] is not None else None
        ),
        "intensity_score": (
            round(scores["intensity"], 1)
            if scores["intensity"] is not None
            else None
        ),
        "mean_track_distance_km": round(mean_distance, 1),
        "mean_pressure_delta_hpa": (
            round(pressure_delta, 1) if pressure_delta is not None else None
        ),
        "mean_wind_delta_kt": (
            round(wind_delta, 1) if wind_delta is not None else None
        ),
        "matched_points": len(distance_values),
        "warping_path_length": len(aligned_pairs),
    }


def rank_similar_tracks(
    current_track: dict,
    historical_tracks: Iterable[dict],
    *,
    weights: dict[str, float] | None = None,
) -> list[dict]:
    ranked = []
    for historical_track in historical_tracks:
        ranked.append(
            {
                **historical_track,
                "similarity": score_similarity(
                    current_track,
                    historical_track,
                    weights,
                ),
            }
        )
    return sorted(
        ranked,
        key=lambda track: (
            -track["similarity"]["score"],
            -track["occurrence_year"],
            track["display_name"].casefold(),
        )
    )
