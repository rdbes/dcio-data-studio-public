"""Reusable tropical-cyclone track queries and payload serializers."""

from __future__ import annotations

from django.db.models import Prefetch

from reports.models import (
    DisasterIncidentTropicalCyclone,
    TropicalCyclone,
    TropicalCycloneTrackPoint,
)

HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE = (
    (
        TropicalCycloneTrackPoint.SourceType.PAGASA_BEST_TRACK_FINAL,
        "DOST-PAGASA",
        "DOST-PAGASA Final Best Track",
    ),
    (
        TropicalCycloneTrackPoint.SourceType.PAGASA_PRELIMINARY_BEST_TRACK,
        "DOST-PAGASA",
        "DOST-PAGASA Preliminary Best Track",
    ),
    (
        TropicalCycloneTrackPoint.SourceType.PAGASA_WARNING_BEST_TRACK,
        "DOST-PAGASA",
        "DOST-PAGASA Warning Best Track (2017)",
    ),
    (
        TropicalCycloneTrackPoint.SourceType.JMA_BEST_TRACK_FINAL,
        "Japan Meteorological Agency",
        "JMA/RSMC Tokyo Final Best Track",
    ),
)


def _serialize_track_point(point):
    return {
        "valid_at": point.valid_at.isoformat().replace("+00:00", "Z"),
        "latitude": float(point.latitude),
        "longitude": float(point.longitude),
        "intensity_code": point.intensity_code or "",
        "central_pressure_hpa": point.central_pressure_hpa,
        "maximum_wind_kt": point.maximum_wind_kt,
        "source_url": point.source_url or "",
    }


def historical_tc_track_for_cyclone(cyclone):
    """Return the highest-precedence coherent historical track."""
    points_by_source = {}
    for point in getattr(cyclone, "_historical_track_points", ()):
        points_by_source.setdefault(
            (point.source_type, point.source_agency),
            [],
        ).append(point)

    for source_type, source_agency, source_label in HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE:
        points = points_by_source.get((source_type, source_agency), ())
        if not points:
            continue

        serialized_points = [_serialize_track_point(point) for point in points]
        source_url = next(
            (point["source_url"] for point in serialized_points if point["source_url"]),
            "",
        )
        return {
            "cyclone_key": cyclone.cyclone_key,
            "cyclone_name": cyclone.cyclone_name or "",
            "international_name": cyclone.international_name or "",
            "occurrence_year": cyclone.occurrence_year,
            "source_type": source_type,
            "source_agency": source_agency,
            "source_label": source_label,
            "source_url": source_url,
            "points": serialized_points,
        }

    return None


def serialize_historical_tc_tracks(incident_cyclone_links):
    """Serialize every available component cyclone of an incident."""
    return [
        track
        for link in incident_cyclone_links
        if (track := historical_tc_track_for_cyclone(link.cyclone_key)) is not None
    ]


def build_selected_incident_tc_tracks(incident_key):
    """Build the historical track payload for one selected incident."""
    if not incident_key:
        return []

    historical_source_types = [
        source_type
        for source_type, _source_agency, _source_label
        in HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE
    ]
    track_points = (
        TropicalCycloneTrackPoint.objects
        .filter(source_type__in=historical_source_types)
        .order_by("valid_at", "track_point_key")
    )
    incident_cyclone_links = (
        DisasterIncidentTropicalCyclone.objects
        .filter(incident_key_id=incident_key)
        .select_related("cyclone_key")
        .prefetch_related(
            Prefetch(
                "cyclone_key__track_points",
                queryset=track_points,
                to_attr="_historical_track_points",
            )
        )
        .order_by(
            "cyclone_key__occurrence_year",
            "cyclone_key__cyclone_name",
            "cyclone_key_id",
        )
    )
    return serialize_historical_tc_tracks(incident_cyclone_links)


def build_operational_tc_tracks(incident_key=None):
    """Serialize operational tracks relevant to the selected incident."""
    points = (
        TropicalCycloneTrackPoint.objects
        .filter(
            source_type=TropicalCycloneTrackPoint.SourceType.PAGASA_OPERATIONAL_ANALYSIS,
            cyclone_key__catalog_source=TropicalCyclone.CatalogSource.PAGASA_OPERATIONAL_TRACK,
            cyclone_key__is_active=True,
        )
        .select_related("cyclone_key")
        .order_by(
            "cyclone_key__occurrence_year",
            "cyclone_key__cyclone_name",
            "valid_at",
            "track_point_key",
        )
    )
    if incident_key is not None:
        if not incident_key:
            return []
        points = points.filter(
            cyclone_key__incident_links__incident_key_id=incident_key,
        )

    tracks = {}
    for point in points:
        cyclone = point.cyclone_key
        track = tracks.setdefault(
            cyclone.cyclone_key,
            {
                "cyclone_key": cyclone.cyclone_key,
                "cyclone_name": cyclone.cyclone_name or "",
                "international_name": cyclone.international_name or "",
                "occurrence_year": cyclone.occurrence_year,
                "source_type": point.source_type,
                "source_agency": point.source_agency,
                "source_label": "DOST-PAGASA Operational Track",
                "source_url": point.source_url or "",
                "track_kind": "operational",
                "points": [],
            },
        )
        track["points"].append(_serialize_track_point(point))
    return list(tracks.values())
