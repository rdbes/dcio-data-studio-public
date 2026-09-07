"""Read-only map workspace for every archived tropical-cyclone track."""

from __future__ import annotations

import calendar
from collections import defaultdict

from django.db.models import Count, Prefetch, Q, Sum
from django.shortcuts import render

from reports.analytics.filters import url_with_query
from reports.hazards.tropical_cyclones import TROPICAL_CYCLONE_HAZARD_KEY
from reports.map_reporting_areas import (
    NCR_REGION_CODE,
    reporting_area_display_name,
)
from reports.models import DamageReport, TropicalCyclone, TropicalCycloneTrackPoint

TRACK_SOURCE_LABELS = dict(TropicalCycloneTrackPoint.SourceType.choices)
TRACK_INTENSITY_LABELS = {
    "STY": "Super Typhoon",
    "TY": "Typhoon",
    "STS": "Severe Tropical Storm",
    "TS": "Tropical Storm",
    "TD": "Tropical Depression",
    "LPA": "Low Pressure Area",
}
TRACK_INTENSITY_RANKS = {
    code: rank
    for rank, code in enumerate(("LPA", "TD", "TS", "STS", "TY", "STY"))
}
TRACK_INTENSITY_ALIASES = {
    "SUPER TYPHOON": "STY",
    "TYPHOON": "TY",
    "SEVERE TROPICAL STORM": "STS",
    "TROPICAL STORM": "TS",
    "TROPICAL DEPRESSION": "TD",
    "LOW PRESSURE AREA": "LPA",
    "L": "LPA",
}


def _selected_year(value: str) -> int | None:
    value = value.strip()
    if not value.isdecimal():
        return None
    year = int(value)
    return year if 1 <= year <= 9999 else None


def _selected_month(value: str) -> int | None:
    value = value.strip()
    if not value.isdecimal():
        return None
    month = int(value)
    return month if 1 <= month <= 12 else None


def _intensity_code(value: str | None) -> str:
    normalized = " ".join(str(value or "").strip().upper().split())
    return TRACK_INTENSITY_ALIASES.get(
        normalized,
        normalized if normalized in TRACK_INTENSITY_LABELS else "",
    )


def _point_intensity_code(point) -> str:
    code = _intensity_code(point.intensity_code)
    if code:
        return code

    wind = point.maximum_wind_kt
    if wind is None:
        return ""
    wind = int(wind)
    if wind >= 100:
        return "STY"
    if wind >= 64:
        return "TY"
    if wind >= 48:
        return "STS"
    if wind >= 34:
        return "TS"
    if wind > 0:
        return "TD"
    return ""


def _highest_strength_code(cyclone, points) -> str:
    codes = [
        _point_intensity_code(point)
        for point in points
    ]
    codes.extend(
        _intensity_code(value)
        for value in (
            cyclone.peak_intensity_within_par,
            cyclone.peak_intensity,
        )
    )
    codes = [code for code in codes if code]
    if not codes:
        return ""
    return max(codes, key=TRACK_INTENSITY_RANKS.get)


def _highest_strength(cyclone, points) -> str:
    code = _highest_strength_code(cyclone, points)
    return TRACK_INTENSITY_LABELS.get(code, "Not available")


def _serialize_damage_loss_records(cyclone_keys):
    """Aggregate active Dashboard Damage & Losses records by cyclone area."""

    cyclone_keys = [str(key) for key in cyclone_keys if key]
    if not cyclone_keys:
        return {}

    rows = (
        DamageReport.objects.filter(
            is_active=True,
            incident_key__hazard_key_id=TROPICAL_CYCLONE_HAZARD_KEY,
            incident_key__tropical_cyclone_links__cyclone_key_id__in=(
                cyclone_keys
            ),
        )
        .values(
            "incident_key__tropical_cyclone_links__cyclone_key_id",
            "location_psgc_key__province_huc_key__psgc_code",
            "location_psgc_key__province_huc_key__correspondence_code",
            "location_psgc_key__province_huc_key__location_name",
            "location_psgc_key__province_huc_name",
            "location_psgc_key__region_key__psgc_code",
            "location_psgc_key__region_name",
        )
        .annotate(
            record_count=Count("damage_report_key", distinct=True),
            affected_farmers=Sum("affected_farmers_fisherfolk_count"),
            area_affected=Sum("area_affected_ha"),
            volume_loss=Sum("production_loss_mt"),
            value_loss=Sum("value_loss_php"),
        )
        .order_by()
    )

    records_by_cyclone = defaultdict(list)
    for row in rows:
        province_code = str(
            row["location_psgc_key__province_huc_key__psgc_code"] or ""
        ).strip()
        region_code = str(
            row["location_psgc_key__region_key__psgc_code"] or ""
        ).strip()
        reporting_code = (
            NCR_REGION_CODE if region_code == NCR_REGION_CODE else province_code
        )
        if not reporting_code:
            continue

        area_name = (
            row["location_psgc_key__province_huc_name"]
            or row["location_psgc_key__province_huc_key__location_name"]
            or "Unspecified Reporting Area"
        )
        records_by_cyclone[
            str(row["incident_key__tropical_cyclone_links__cyclone_key_id"])
        ].append(
            {
                "province_name": reporting_area_display_name(
                    reporting_code,
                    area_name,
                ),
                "region_name": row["location_psgc_key__region_name"]
                or "Unspecified Region",
                "psgc_code": reporting_code,
                "correspondence_code": (
                    row[
                        "location_psgc_key__province_huc_key__correspondence_code"
                    ]
                    or ""
                ),
                "record_count": int(row["record_count"] or 0),
                "affected_farmers": float(row["affected_farmers"] or 0),
                "area_affected": float(row["area_affected"] or 0),
                "volume_loss": float(row["volume_loss"] or 0),
                "value_loss": float(row["value_loss"] or 0),
            }
        )

    return dict(records_by_cyclone)


def _serialize_tracks(cyclones):
    tracks = []

    for cyclone in cyclones:
        points_by_source = defaultdict(list)
        for point in cyclone.all_track_points:
            points_by_source[(point.source_type, point.source_agency or "")].append(
                point
            )

        if not points_by_source:
            tracks.append(
                {
                    "track_key": f"{cyclone.cyclone_key}:no-track",
                    "cyclone_key": cyclone.cyclone_key,
                    "cyclone_name": cyclone.cyclone_name or "",
                    "international_name": cyclone.international_name or "",
                    "occurrence_year": cyclone.occurrence_year,
                    "catalog_source": cyclone.get_catalog_source_display(),
                    "source_type": "",
                    "source_label": "No track data",
                    "source_agency": "",
                    "peak_intensity": cyclone.peak_intensity or "",
                    "highest_strength_code": _highest_strength_code(
                        cyclone,
                        (),
                    ),
                    "highest_strength": _highest_strength(cyclone, ()),
                    "linked_damage_report_count": int(
                        getattr(cyclone, "linked_damage_report_count", 0)
                    ),
                    "has_damage_report": bool(
                        getattr(cyclone, "linked_damage_report_count", 0)
                    ),
                    "is_active": cyclone.is_active,
                    "point_count": 0,
                    "points": [],
                }
            )

        for (source_type, source_agency), points in sorted(
            points_by_source.items(),
            key=lambda item: (
                item[0][0],
                item[0][1],
            ),
        ):
            track_key = ":".join(
                (
                    cyclone.cyclone_key,
                    source_type,
                    source_agency or "unknown",
                )
            )
            tracks.append(
                {
                    "track_key": track_key,
                    "cyclone_key": cyclone.cyclone_key,
                    "cyclone_name": cyclone.cyclone_name or "",
                    "international_name": cyclone.international_name or "",
                    "occurrence_year": cyclone.occurrence_year,
                    "catalog_source": cyclone.get_catalog_source_display(),
                    "source_type": source_type,
                    "source_label": TRACK_SOURCE_LABELS.get(
                        source_type,
                        source_type,
                    ),
                    "source_agency": source_agency or "Unknown source",
                    "peak_intensity": cyclone.peak_intensity or "",
                    "highest_strength_code": _highest_strength_code(
                        cyclone,
                        points,
                    ),
                    "highest_strength": _highest_strength(cyclone, points),
                    "linked_damage_report_count": int(
                        getattr(cyclone, "linked_damage_report_count", 0)
                    ),
                    "has_damage_report": bool(
                        getattr(cyclone, "linked_damage_report_count", 0)
                    ),
                    "is_active": cyclone.is_active,
                    "point_count": len(points),
                    "points": [
                        {
                            "valid_at": point.valid_at.isoformat(),
                            "latitude": float(point.latitude),
                            "longitude": float(point.longitude),
                            "intensity_code": point.intensity_code or "",
                            "central_pressure_hpa": point.central_pressure_hpa,
                            "maximum_wind_kt": point.maximum_wind_kt,
                        }
                        for point in points
                    ],
                }
            )

    return tracks


def tropical_cyclone_tracks(request):
    """Show every stored tropical-cyclone occurrence grouped by year."""

    selected_year = _selected_year(request.GET.get("year", ""))
    selected_month = _selected_month(request.GET.get("month", ""))

    point_queryset = TropicalCycloneTrackPoint.objects.order_by(
        "valid_at",
        "track_point_key",
    )
    cyclone_queryset = TropicalCyclone.objects.annotate(
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
    )
    if selected_year is not None:
        cyclone_queryset = cyclone_queryset.filter(
            occurrence_year=selected_year,
        )
    if selected_month is not None:
        point_queryset = point_queryset.filter(
            valid_at__month=selected_month,
        )
        cyclone_queryset = cyclone_queryset.filter(
            Q(track_points__valid_at__month=selected_month)
            | Q(
                track_points__isnull=True,
                start_date__month=selected_month,
            )
        )
    cyclones = (
        cyclone_queryset.distinct()
        .prefetch_related(
            Prefetch(
                "track_points",
                queryset=point_queryset,
                to_attr="all_track_points",
            )
        )
        .order_by(
            "-occurrence_year",
            "cyclone_name",
            "cyclone_key",
        )
    )
    tracks = _serialize_tracks(cyclones)
    damage_loss_records_by_cyclone = _serialize_damage_loss_records(
        {track["cyclone_key"] for track in tracks}
    )
    for track in tracks:
        damage_loss_records = damage_loss_records_by_cyclone.get(
            str(track["cyclone_key"]),
            [],
        )
        track["damage_loss_records"] = damage_loss_records
        track["damage_loss_record_count"] = sum(
            record["record_count"] for record in damage_loss_records
        )

    track_rows = [
        {
            key: value
            for key, value in track.items()
            if key not in {"points", "damage_loss_records"}
        }
        for track in tracks
    ]
    track_rows.sort(
        key=lambda row: (
            -row["occurrence_year"],
            row["cyclone_name"].casefold(),
            row["source_label"].casefold(),
        )
    )

    track_year_groups = []
    for row in track_rows:
        if not track_year_groups or track_year_groups[-1]["year"] != row[
            "occurrence_year"
        ]:
            track_year_groups.append(
                {
                    "year": row["occurrence_year"],
                    "rows": [],
                    "cyclone_keys": set(),
                    "paired_cyclone_keys": set(),
                }
            )
        group = track_year_groups[-1]
        group["rows"].append(row)
        group["cyclone_keys"].add(row["cyclone_key"])
        if row["has_damage_report"]:
            group["paired_cyclone_keys"].add(row["cyclone_key"])

    for group in track_year_groups:
        group["track_count"] = sum(
            1 for row in group["rows"] if row["point_count"]
        )
        group["cyclone_count"] = len(group.pop("cyclone_keys"))
        group["paired_cyclone_count"] = len(group.pop("paired_cyclone_keys"))

    available_years = list(
        TropicalCyclone.objects.values_list(
            "occurrence_year",
            flat=True,
        )
        .distinct()
        .order_by("-occurrence_year")
    )
    active_filter_chips = [
        {
            "label": str(selected_year) if selected_year else "All Years",
            "clear_url": (
                url_with_query(request, remove=["year"])
                if selected_year
                else ""
            ),
        },
        {
            "label": (
                calendar.month_name[selected_month]
                if selected_month
                else "All Months"
            ),
            "clear_url": (
                url_with_query(request, remove=["month"])
                if selected_month
                else ""
            ),
        },
    ]

    return render(
        request,
        "reports/tropical_cyclone_tracks.html",
        {
            "track_payload": tracks,
            "track_rows": track_rows,
            "track_year_groups": track_year_groups,
            "track_count": sum(
                1 for track in tracks if track["point_count"]
            ),
            "cyclone_count": len({track["cyclone_key"] for track in tracks}),
            "paired_cyclone_count": len(
                {
                    track["cyclone_key"]
                    for track in tracks
                    if track["has_damage_report"]
                }
            ),
            "point_count": sum(len(track["points"]) for track in tracks),
            "available_years": available_years,
            "month_options": [
                {
                    "value": month_number,
                    "label": calendar.month_name[month_number],
                }
                for month_number in range(1, 13)
            ],
            "selected_year": selected_year,
            "selected_month": selected_month,
            "selected_month_label": (
                calendar.month_name[selected_month]
                if selected_month
                else "All Months"
            ),
            "active_filter_chips": active_filter_chips,
        },
    )
