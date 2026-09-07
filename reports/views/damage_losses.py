import calendar

from django.db.models import Count, Max, Prefetch, Sum
from django.db.models.functions import ExtractYear
from django.http import JsonResponse
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone

from reports.analytics import (
    DATE_MODES,
    METRIC_CONFIG,
    discrete_period_selection,
)
from reports.analytics import (
    apply_dashboard_filters as _apply_dashboard_filters,
)
from reports.analytics import (
    build_active_filter_chips as _build_active_filter_chips,
)
from reports.analytics import (
    build_commodity_group_options as _build_commodity_group_options,
)
from reports.analytics import (
    build_commodity_subgroup_cascade_options as _build_commodity_subgroup_cascade_options,
)
from reports.analytics import (
    build_commodity_subgroup_options as _build_commodity_subgroup_options,
)
from reports.analytics import (
    commodity_group_from_row as _commodity_group_from_row,
)
from reports.analytics import (
    hazard_display_label as _hazard_display_label,
)
from reports.analytics import (
    hazard_sort_key as _hazard_sort_key,
)
from reports.analytics import (
    normalize_period as _normalize_period,
)
from reports.analytics import (
    normalize_scope_filter_values as _normalize_scope_filter_values,
)
from reports.analytics import (
    number as _number,
)
from reports.analytics import (
    preserved_url as _preserved_url,
)
from reports.analytics import (
    selected_period_options as _selected_period_options,
)
from reports.analytics import (
    url_with_query as _url_with_query,
)
from reports.analytics import (
    zero as _zero,
)
from reports.analytics.province_map import build_province_reporting_area_totals
from reports.incident_attribution import damage_report_analysis_date_expression
from reports.location_ordering import (
    region_sort_key,
    short_region_label,
    sort_region_names,
)
from reports.map_reporting_areas import (
    NCR_REGION_NAME,
    reporting_area_filter_label,
)

from ..models import (
    DamageReport,
    DisasterIncidentTropicalCyclone,
    RefHazard,
    TropicalCyclone,
    TropicalCycloneTrackPoint,
)

MAP_CANVAS_METRIC_KEYS = (
    "value",
    "volume",
    "area",
    "farmers",
)

MAP_CANVAS_PROVINCE_FIELDS = {
    "value": "value_loss",
    "volume": "volume_loss",
    "area": "area_affected",
    "farmers": "affected_farmers",
}


def _build_hazard_chart_data(filtered_reports):
    """Return explicit hazard totals for the dashboard doughnut chart."""

    rows = (
        filtered_reports
        .values(
            "incident_key__hazard_key__hazard_key",
            "incident_key__hazard_key__hazard_category",
            "incident_key__hazard_key__hazard_type",
        )
        .annotate(
            affected_farmers=Sum(
                METRIC_CONFIG["farmers"]["field"],
            ),
            area_affected=Sum(
                METRIC_CONFIG["area"]["field"],
            ),
            volume_loss=Sum(
                METRIC_CONFIG["volume"]["field"],
            ),
            value_loss=Sum(
                METRIC_CONFIG["value"]["field"],
            ),
        )
        .order_by(
            "incident_key__hazard_key__hazard_key",
        )
    )

    chart_rows = []
    for row in rows:
        hazard_key = row[
            "incident_key__hazard_key__hazard_key"
        ]
        if not hazard_key:
            continue
        chart_rows.append(
            {
                "label": _hazard_display_label(
                    hazard_key,
                    row["incident_key__hazard_key__hazard_type"],
                    row["incident_key__hazard_key__hazard_category"],
                ),
                "hazard_key": hazard_key,
                "affected_farmers": _number(row["affected_farmers"]),
                "area_affected": _number(row["area_affected"]),
                "volume_loss": _number(row["volume_loss"]),
                "value_loss": _number(row["value_loss"]),
            }
        )

    return chart_rows


def _default_period_year_for_incident(request, active_reports, current_year):
    """Use a selected incident's own latest report year for an implicit period."""

    incident_key = request.GET.get("incident") or ""
    has_explicit_period = any(
        request.GET.getlist(key)
        for key in (
            "period_mode",
            "start_year",
            "end_year",
            "start_month",
            "end_month",
            "date_mode",
            "year",
            "years",
            "year_all",
            "month",
            "months",
            "month_all",
            "date_from",
            "date_to",
        )
    )
    if not incident_key or has_explicit_period:
        return current_year

    result = (
        active_reports.filter(incident_key_id=incident_key)
        .annotate(
            map_analysis_year=ExtractYear(
                damage_report_analysis_date_expression()
            )
        )
        .aggregate(year=Max("map_analysis_year"))
    )
    return result["year"] or current_year


def _damage_losses_selected_ints(values, minimum=None, maximum=None):
    selected = []
    seen = set()

    for raw_value in values:
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            continue

        if minimum is not None and value < minimum:
            continue
        if maximum is not None and value > maximum:
            continue
        if value in seen:
            continue

        seen.add(value)
        selected.append(value)

    return sorted(selected)


def _damage_losses_is_contiguous(values):
    if len(values) < 2:
        return True

    return all(
        current == previous + 1
        for previous, current in zip(
            values,
            values[1:],
            strict=False,
        )
    )


def _damage_losses_selection_label(
    values,
    *,
    formatter=str,
    all_values=None,
    all_label="",
):
    values = sorted(set(values))

    if not values:
        return ""

    if len(values) == 1:
        return formatter(values[0])

    contiguous = _damage_losses_is_contiguous(values)
    normalized_all_values = (
        sorted(set(all_values))
        if all_values
        else []
    )

    if (
        all_label
        and normalized_all_values
        and values == normalized_all_values
    ):
        return all_label

    if contiguous:
        return (
            f"{formatter(values[0])}"
            f"–{formatter(values[-1])}"
        )

    return ", ".join(
        formatter(value)
        for value in values
    )


def _damage_losses_discrete_period_selection(
    request,
    period,
    available_years,
):
    return discrete_period_selection(request, period, available_years)


def _build_province_map_data(filtered_reports, metric_field):
    base_map_data = build_province_reporting_area_totals(
        filtered_reports,
        metric_field,
    )
    provinces = base_map_data["provinces"]

    # Keep commodity breakdowns and scoped hazard totals in the same
    # reporting-area query so chart drill-downs stay client-side and do not
    # issue a second request.
    commodity_rows = (
        filtered_reports.values(
            "location_psgc_key__province_huc_key__psgc_code",
            "location_psgc_key__province_huc_key__correspondence_code",
            "location_psgc_key__province_huc_name",
            "location_psgc_key__region_name",
            "commodity_key__main_sector",
            "commodity_key__level_2_group",
            "incident_key__hazard_key__hazard_key",
            "incident_key__hazard_key__hazard_category",
            "incident_key__hazard_key__hazard_type",
        )
        .annotate(
            dashboard_value_loss=Sum("value_loss_php"),
            dashboard_volume_loss=Sum("production_loss_mt"),
            dashboard_area_affected=Sum("area_affected_ha"),
            dashboard_affected_farmers=Sum(
                "affected_farmers_fisherfolk_count"
            ),
        )
        .order_by()
    )
    commodity_by_area = {}
    hazards_by_area = {}
    # Some legacy/imported reports have an explicit commodity and hazard but
    # no province/HUC mapping. Keep those rows available to the commodity
    # chart instead of silently dropping their value from the distribution.
    unmapped_commodities = {}

    def add_hazard_total(target, row, hazard_key, hazard_label):
        hazard_totals = target.setdefault(
            hazard_key,
            {
                "label": hazard_label,
                "hazard_key": hazard_key,
                "affected_farmers": 0.0,
                "area_affected": 0.0,
                "volume_loss": 0.0,
                "value_loss": 0.0,
            },
        )
        hazard_totals["affected_farmers"] += float(
            _number(row.get("dashboard_affected_farmers"))
        )
        hazard_totals["area_affected"] += float(
            _number(row.get("dashboard_area_affected"))
        )
        hazard_totals["volume_loss"] += float(
            _number(row.get("dashboard_volume_loss"))
        )
        hazard_totals["value_loss"] += float(
            _number(row.get("dashboard_value_loss"))
        )

    for row in commodity_rows:
        region_name = str(
            row.get("location_psgc_key__region_name")
            or ""
        ).strip()
        raw_area_code = (
            row.get(
                "location_psgc_key__province_huc_key__psgc_code"
            )
            or row.get(
                "location_psgc_key__province_huc_key__correspondence_code"
            )
            or row.get(
                "location_psgc_key__province_huc_name"
            )
            or ""
        )
        area_key = str(raw_area_code).strip().upper()

        if (
            region_name == "National Capital Region (NCR)"
            or area_key.startswith("13")
        ):
            area_key = "1300000000"

        commodity_label = str(
            _commodity_group_from_row(row)
            or ""
        ).strip()
        if not commodity_label:
            continue

        hazard_key = str(
            row.get("incident_key__hazard_key__hazard_key") or ""
        ).strip()
        hazard_label = ""
        if hazard_key:
            hazard_label = _hazard_display_label(
                hazard_key,
                row.get("incident_key__hazard_key__hazard_type"),
                row.get("incident_key__hazard_key__hazard_category"),
            )

        if not area_key:
            fallback_key = (
                region_name,
                commodity_label,
                hazard_key,
            )
            fallback_totals = unmapped_commodities.setdefault(
                fallback_key,
                {
                    "label": commodity_label,
                    "region_name": region_name,
                    "hazard_key": hazard_key,
                    "hazard_label": hazard_label,
                    "value_loss": 0.0,
                    "volume_loss": 0.0,
                    "area_affected": 0.0,
                    "affected_farmers": 0.0,
                },
            )
            fallback_totals["value_loss"] += float(
                _number(row.get("dashboard_value_loss"))
            )
            fallback_totals["volume_loss"] += float(
                _number(row.get("dashboard_volume_loss"))
            )
            fallback_totals["area_affected"] += float(
                _number(row.get("dashboard_area_affected"))
            )
            fallback_totals["affected_farmers"] += float(
                _number(row.get("dashboard_affected_farmers"))
            )
            continue

        area_commodities = commodity_by_area.setdefault(
            area_key,
            {},
        )
        commodity_totals = area_commodities.setdefault(
            commodity_label,
            {
                "value_loss": 0.0,
                "volume_loss": 0.0,
                "area_affected": 0.0,
                "affected_farmers": 0.0,
            },
        )
        commodity_totals["value_loss"] += float(
            _number(row.get("dashboard_value_loss"))
        )
        commodity_totals["volume_loss"] += float(
            _number(row.get("dashboard_volume_loss"))
        )
        commodity_totals["area_affected"] += float(
            _number(row.get("dashboard_area_affected"))
        )
        commodity_totals["affected_farmers"] += float(
            _number(row.get("dashboard_affected_farmers"))
        )

        if hazard_key:
            area_hazards = hazards_by_area.setdefault(
                area_key,
                {"all": {}, "commodities": {}},
            )
            add_hazard_total(
                area_hazards["all"],
                row,
                hazard_key,
                hazard_label,
            )
            commodity_hazards = area_hazards["commodities"].setdefault(
                commodity_label,
                {},
            )
            add_hazard_total(
                commodity_hazards,
                row,
                hazard_key,
                hazard_label,
            )

    for province in provinces:
        province_region = str(
            province.get("region_name") or ""
        ).strip()
        province_area_key = str(
            province.get("psgc_code")
            or province.get("correspondence_code")
            or province.get("province_name")
            or ""
        ).strip().upper()

        if (
            province_region == "National Capital Region (NCR)"
            or province_area_key.startswith("13")
        ):
            province_area_key = "1300000000"

        province["commodities"] = [
            {
                "label": label,
                **metrics,
            }
            for label, metrics in sorted(
                commodity_by_area.get(
                    province_area_key,
                    {},
                ).items(),
                key=lambda item: (
                    -item[1]["value_loss"],
                    item[0].casefold(),
                ),
            )
        ]

    def sort_hazard_totals(rows):
        return sorted(
            rows.values(),
            key=lambda item: (
                -float(item["value_loss"]),
                str(item["hazard_key"]).casefold(),
            ),
        )

    serialized_hazards_by_area = {}
    for area_key, area_hazards in hazards_by_area.items():
        serialized_hazards_by_area[area_key] = {
            "all": sort_hazard_totals(area_hazards["all"]),
            "commodities": {
                commodity_label: sort_hazard_totals(hazard_rows)
                for commodity_label, hazard_rows in area_hazards[
                    "commodities"
                ].items()
            },
        }

    return {
        "provinces": provinces,
        "max_metric_value": base_map_data["max_metric_value"],
        "unmapped_commodities": sorted(
            unmapped_commodities.values(),
            key=lambda item: (
                -float(item["value_loss"]),
                str(item["label"]).casefold(),
                str(item["region_name"]).casefold(),
                str(item["hazard_key"]).casefold(),
            ),
        ),
        "hazards_by_area": serialized_hazards_by_area,
    }




_HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE = (
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


def _historical_tc_track_for_cyclone(cyclone):
    """Return the highest-precedence coherent historical track."""

    points_by_source = {}

    for point in getattr(
        cyclone,
        "_historical_track_points",
        (),
    ):
        key = (
            point.source_type,
            point.source_agency,
        )
        points_by_source.setdefault(
            key,
            [],
        ).append(point)

    for (
        source_type,
        source_agency,
        source_label,
    ) in _HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE:
        points = points_by_source.get(
            (
                source_type,
                source_agency,
            ),
            (),
        )

        if not points:
            continue

        serialized_points = []

        for point in points:
            serialized_points.append(
                {
                    "valid_at": (
                        point.valid_at.isoformat()
                        .replace("+00:00", "Z")
                    ),
                    "latitude": float(point.latitude),
                    "longitude": float(point.longitude),
                    "intensity_code": (
                        point.intensity_code or ""
                    ),
                    "central_pressure_hpa": (
                        point.central_pressure_hpa
                    ),
                    "maximum_wind_kt": (
                        point.maximum_wind_kt
                    ),
                    "source_url": (
                        point.source_url or ""
                    ),
                }
            )

        source_url = next(
            (
                point["source_url"]
                for point in serialized_points
                if point["source_url"]
            ),
            "",
        )

        return {
            "cyclone_key": cyclone.cyclone_key,
            "cyclone_name": cyclone.cyclone_name or "",
            "international_name": (
                cyclone.international_name or ""
            ),
            "occurrence_year": cyclone.occurrence_year,
            "source_type": source_type,
            "source_agency": source_agency,
            "source_label": source_label,
            "source_url": source_url,
            "points": serialized_points,
        }

    return None


def _serialize_historical_tc_tracks(
    incident_cyclone_links,
):
    """Serialize every available component TC of an incident."""

    tracks = []

    for link in incident_cyclone_links:
        track = _historical_tc_track_for_cyclone(
            link.cyclone_key
        )

        if track is not None:
            tracks.append(track)

    return tracks


def _build_selected_incident_tc_tracks(
    incident_key,
):
    """Build historical track payload for one selected incident."""

    if not incident_key:
        return []

    historical_source_types = [
        source_type
        for (
            source_type,
            _source_agency,
            _source_label,
        ) in _HISTORICAL_TC_TRACK_SOURCE_PRECEDENCE
    ]

    track_points = (
        TropicalCycloneTrackPoint.objects
        .filter(
            source_type__in=historical_source_types,
        )
        .order_by(
            "valid_at",
            "track_point_key",
        )
    )

    incident_cyclone_links = (
        DisasterIncidentTropicalCyclone.objects
        .filter(
            incident_key_id=incident_key,
        )
        .select_related(
            "cyclone_key",
        )
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

    return _serialize_historical_tc_tracks(
        incident_cyclone_links
    )


def _build_operational_tc_tracks(incident_key=None):
    """Serialize operational tracks relevant to the selected incident.

    With the argument omitted this returns the retained catalog payload for
    operational monitoring and maintenance views. The Dashboard always passes
    its selected incident value (including an empty value), which limits the
    layer to cyclones explicitly linked through
    ``disaster_incident_tropical_cyclone``.
    """

    points = (
        TropicalCycloneTrackPoint.objects
        .filter(
            source_type=(
                TropicalCycloneTrackPoint
                .SourceType
                .PAGASA_OPERATIONAL_ANALYSIS
            ),
            cyclone_key__catalog_source=(
                TropicalCyclone
                .CatalogSource
                .PAGASA_OPERATIONAL_TRACK
            ),
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
                "international_name": (
                    cyclone.international_name or ""
                ),
                "occurrence_year": cyclone.occurrence_year,
                "source_type": point.source_type,
                "source_agency": point.source_agency,
                "source_label": (
                    "DOST-PAGASA Operational Track"
                ),
                "source_url": point.source_url or "",
                "track_kind": "operational",
                "points": [],
            },
        )
        track["points"].append(
            {
                "valid_at": (
                    point.valid_at.isoformat()
                    .replace("+00:00", "Z")
                ),
                "latitude": float(point.latitude),
                "longitude": float(point.longitude),
                "intensity_code": point.intensity_code or "",
                "central_pressure_hpa": (
                    point.central_pressure_hpa
                ),
                "maximum_wind_kt": point.maximum_wind_kt,
                "source_url": point.source_url or "",
            }
        )

    return list(tracks.values())


def _is_tropical_cyclone_hazard(hazard):
    """Return whether a selected hazard represents tropical cyclone."""

    if hazard is None:
        return False

    values = (
        getattr(hazard, "display_label", ""),
        getattr(hazard, "hazard_key", ""),
        getattr(hazard, "hazard_type", ""),
        getattr(hazard, "hazard_category", ""),
    )

    normalized_values = {
        " ".join(
            str(value or "")
            .replace("_", " ")
            .replace("-", " ")
            .split()
        ).casefold()
        for value in values
    }

    return bool(
        {
            "tropical cyclone",
            "tc",
        }
        & normalized_values
    )


def _dynamic_incident_options(request):
    """Return incidents matching the pending Damage & Losses filters."""

    current_year = timezone.now().year

    active_reports = DamageReport.objects.filter(
        is_active=True
    )

    hazard_key = (
        request.GET.get("hazard")
        or ""
    )

    if not hazard_key:
        return []

    hazard_exists = (
        RefHazard.objects
        .filter(
            hazard_key=hazard_key,
            is_active=True,
            archived_at__isnull=True,
        )
        .exists()
    )

    if not hazard_exists:
        return []

    available_years = list(
        active_reports
        .annotate(
            map_analysis_year=ExtractYear(
                damage_report_analysis_date_expression()
            )
        )
        .exclude(
            map_analysis_year__isnull=True
        )
        .values_list(
            "map_analysis_year",
            flat=True,
        )
        .distinct()
        .order_by(
            "-map_analysis_year"
        )
    )

    period = _normalize_period(
        request,
        active_reports,
        current_year,
        _default_period_year_for_incident(
            request,
            active_reports,
            current_year,
        ),
    )

    period.update(
        _selected_period_options(
            period,
            available_years,
        )
    )

    period.update(
        _damage_losses_discrete_period_selection(
            request,
            period,
            available_years,
        )
    )

    filters = {
        **period,
        "region": "",
        "province": "",
        "commodity_group": (
            request.GET.get(
                "commodity_group"
            )
            or ""
        ),
        "commodity_subgroup": (
            request.GET.get(
                "commodity_subgroup"
            )
            or ""
        ),
        "hazard": hazard_key,
        "incident": "",
        "metric": "value",
    }

    filters = _normalize_scope_filter_values(
        active_reports,
        filters,
    )

    matching_reports = (
        _apply_dashboard_filters(
            active_reports,
            filters,
        )
    )

    rows = (
        matching_reports
        .exclude(
            incident_key__isnull=True
        )
        .filter(
            incident_key__hazard_key_id=(
                hazard_key
            )
        )
        .values(
            "incident_key_id",
            "incident_key__incident_name",
            "incident_key__hazard_key_id",
        )
        .distinct()
        .order_by(
            "incident_key__incident_name",
            "incident_key_id",
        )
    )

    return [
        {
            "value": row[
                "incident_key_id"
            ],
            "label": (
                row[
                    "incident_key__incident_name"
                ]
                or row[
                    "incident_key_id"
                ]
            ),
            "parent": row[
                "incident_key__hazard_key_id"
            ],
        }
        for row in rows
    ]


def damage_losses_incident_options(
    request,
):
    """Return live Incident choices for pending filter selections."""

    return JsonResponse(
        {
            "options": (
                _dynamic_incident_options(
                    request
                )
            )
        }
    )

def dashboard(request):
    """Show Province/HUC-level spatial analytics with one consolidated NCR."""
    current_year = timezone.now().year
    active_reports = DamageReport.objects.filter(is_active=True)

    active_hazards = list(
        RefHazard.objects.filter(
            is_active=True,
            archived_at__isnull=True,
        ).order_by("hazard_key")
    )
    for hazard in active_hazards:
        hazard.display_label = _hazard_display_label(
            hazard.hazard_key,
            hazard.hazard_type,
            hazard.hazard_category,
        )
    active_hazards.sort(key=_hazard_sort_key)
    active_hazards_by_key = {hazard.hazard_key: hazard for hazard in active_hazards}
    selected_hazard = active_hazards_by_key.get(request.GET.get("hazard") or "")
    show_tropical_cyclone_track_layer = (
        _is_tropical_cyclone_hazard(
            selected_hazard
        )
    )

    available_years = list(
        active_reports.annotate(
            map_analysis_year=ExtractYear(damage_report_analysis_date_expression())
        )
        .exclude(map_analysis_year__isnull=True)
        .values_list("map_analysis_year", flat=True)
        .distinct()
        .order_by("-map_analysis_year")
    )

    # Prefer the current release year when it is present so the Dashboard opens
    # on the latest available data. Fall back to the newest prior year when
    # there is no current-year dataset to display.
    default_period_year = (
        current_year
        if current_year in available_years
        else next(
            (
                year
                for year in available_years
                if year < current_year
            ),
            current_year,
        )
    )

    selected_metric = "value"

    period = _normalize_period(
        request,
        active_reports,
        current_year,
        _default_period_year_for_incident(
            request,
            active_reports,
            default_period_year,
        ),
    )
    period.update(_selected_period_options(period, available_years))
    period.update(
        _damage_losses_discrete_period_selection(
            request,
            period,
            available_years,
        )
    )

    filters = {
        **period,
        "region": request.GET.get("region") or "",
        "province": request.GET.get("province") or "",
        "commodity_group": request.GET.get("commodity_group") or "",
        "commodity_subgroup": request.GET.get("commodity_subgroup") or "",
        "hazard": selected_hazard.hazard_key if selected_hazard else "",
        "metric": selected_metric,
    }
    filters = _normalize_scope_filter_values(
        active_reports,
        filters,
    )
    filters["incident"] = ""
    if filters["region"] == NCR_REGION_NAME:
        filters["province"] = ""

    region_options = sort_region_names(
        active_reports.exclude(location_psgc_key__region_name__isnull=True)
        .exclude(location_psgc_key__region_name="")
        .values_list("location_psgc_key__region_name", flat=True)
        .distinct()
    )

    province_source = active_reports
    if filters["region"]:
        province_source = province_source.filter(
            location_psgc_key__region_name=filters["region"]
        )

    province_options = []
    if filters["region"] != NCR_REGION_NAME:
        province_names = list(
            province_source.exclude(location_psgc_key__province_huc_name__isnull=True)
            .exclude(location_psgc_key__province_huc_name="")
            .values_list("location_psgc_key__province_huc_name", flat=True)
            .distinct()
            .order_by("location_psgc_key__province_huc_name")
        )
        province_options = [
            {
                "value": province_name,
                "label": reporting_area_filter_label(province_name),
            }
            for province_name in province_names
        ]

    province_cascade_options = []
    for option in sorted(
        active_reports.exclude(location_psgc_key__province_huc_name__isnull=True)
        .exclude(location_psgc_key__province_huc_name="")
        .exclude(location_psgc_key__region_name__isnull=True)
        .exclude(location_psgc_key__region_name="")
        .values(
            "location_psgc_key__region_name",
            "location_psgc_key__province_huc_name",
        )
        .distinct(),
        key=lambda item: (
            region_sort_key(item["location_psgc_key__region_name"]),
            str(item["location_psgc_key__province_huc_name"]).casefold(),
        ),
    ):
        region_name = option["location_psgc_key__region_name"]
        if region_name == NCR_REGION_NAME:
            continue
        province_name = option["location_psgc_key__province_huc_name"]
        province_cascade_options.append(
            {
                "value": province_name,
                "label": reporting_area_filter_label(province_name),
                "parent": region_name,
            }
        )

    commodity_group_options = _build_commodity_group_options(active_reports)
    commodity_subgroup_options = _build_commodity_subgroup_options(
        active_reports,
        filters["commodity_group"],
    )
    commodity_subgroup_cascade_options = _build_commodity_subgroup_cascade_options(
        active_reports
    )

    incident_option_filters = {
        **filters,
        "hazard": "",
        "incident": "",
    }
    incident_option_reports = _apply_dashboard_filters(
        active_reports,
        incident_option_filters,
    )

    incident_rows = list(
        incident_option_reports.filter(
            incident_key__hazard_key_id__in=tuple(
                active_hazards_by_key
            ),
        )
        .exclude(
            incident_key__isnull=True,
        )
        .values(
            "incident_key_id",
            "incident_key__incident_name",
            "incident_key__hazard_key_id",
        )
        .distinct()
        .order_by(
            "incident_key__hazard_key_id",
            "incident_key__incident_name",
            "incident_key_id",
        )
    )

    incident_cascade_options = [
        {
            "value": row["incident_key_id"],
            "label": (
                row["incident_key__incident_name"]
                or row["incident_key_id"]
            ),
            "parent": (
                row[
                    "incident_key__hazard_key_id"
                ]
            ),
        }
        for row in incident_rows
    ]

    requested_incident = (
        request.GET.get("incident") or ""
    )
    selected_incident = None

    if filters["hazard"]:
        selected_incident = next(
            (
                option
                for option in incident_cascade_options
                if (
                    option["value"]
                    == requested_incident
                    and option["parent"]
                    == filters["hazard"]
                )
            ),
            None,
        )

    filtered_reports = incident_option_reports

    if filters["hazard"]:
        filtered_reports = filtered_reports.filter(
            incident_key__hazard_key_id=filters["hazard"]
        )

    if selected_incident:
        filters["incident"] = (
            selected_incident["value"]
        )
        filtered_reports = filtered_reports.filter(
            incident_key_id=(
                selected_incident["value"]
            )
        )

    metric_config = METRIC_CONFIG[selected_metric]
    metric_field = metric_config["field"]

    totals = filtered_reports.aggregate(
        record_count=Count("damage_report_key"),
        **{
            f"{metric_key}_total": Sum(
                METRIC_CONFIG[metric_key]["field"]
            )
            for metric_key in MAP_CANVAS_METRIC_KEYS
        },
    )
    map_reports = filtered_reports
    if filters["province"]:
        comparison_filters = {
            **filters,
            "province": "",
        }
        map_reports = _apply_dashboard_filters(
            active_reports,
            comparison_filters,
        )

    map_data = _build_province_map_data(
        map_reports,
        metric_field,
    )
    map_data["hazards"] = _build_hazard_chart_data(filtered_reports)

    selected_incident_key = (
        selected_incident["value"]
        if selected_incident
        else ""
    )

    map_data["tropical_cyclone_tracks"] = (
        _build_selected_incident_tc_tracks(
            selected_incident_key
        )
        if (
            show_tropical_cyclone_track_layer
            and selected_incident_key
        )
        else []
    )
    # Operational tracks are live catalog data, but the Dashboard layer is
    # intentionally scoped to the selected incident's explicit TC links.
    # Without an incident filter, no operational track options are exposed.
    map_data["tropical_cyclone_operational_tracks"] = (
        _build_operational_tc_tracks(selected_incident_key)
    )

    map_config = {
        "metric_key": selected_metric,
        "metric_label": metric_config["label"],
        "metric_prefix": metric_config["prefix"],
        "metric_suffix": metric_config["suffix"],
        "metric_format": metric_config["format"],
        "metrics": {
            metric_key: {
                "label": (
                    METRIC_CONFIG[metric_key]["label"]
                ),
                "prefix": (
                    METRIC_CONFIG[metric_key]["prefix"]
                ),
                "suffix": (
                    METRIC_CONFIG[metric_key]["suffix"]
                ),
                "format": (
                    METRIC_CONFIG[metric_key]["format"]
                ),
                "province_field": (
                    MAP_CANVAS_PROVINCE_FIELDS[
                        metric_key
                    ]
                ),
                "total": _number(
                    totals[f"{metric_key}_total"]
                ),
            }
            for metric_key in MAP_CANVAS_METRIC_KEYS
        },
        "period_label": filters["period_label"],
        "commodity_label": (
            filters["commodity_subgroup"]
            or filters["commodity_group"]
            or "All Commodities"
        ),
        "hazard_label": (
            selected_hazard.display_label
            if selected_hazard
            else ""
        ),
        "hazard_key": filters["hazard"],
        "incident_label": (
            selected_incident["label"]
            if selected_incident
            else ""
        ),
        "show_tropical_cyclone_track_layer": (
            show_tropical_cyclone_track_layer
        ),
        "show_operational_tropical_cyclone_track_layer": bool(
            map_data["tropical_cyclone_operational_tracks"]
        ),
        "tropical_cyclone_incident_selected": (
            bool(selected_incident_key)
        ),
        "reset_extent_on_width_change": True,
        "location_label": (
            reporting_area_filter_label(
                filters["province"]
            )
            if filters["province"]
            else filters["region"] or "National"
        ),
        "region_options": [
            {
                "value": region_name,
                "label": short_region_label(region_name),
            }
            for region_name in region_options
        ],
        "base_region_name": filters["region"],
        "base_province_code": (
            next(
                (
                    province["psgc_code"]
                    for province in map_data["provinces"]
                    if reporting_area_filter_label(
                        province["province_name"]
                    )
                    == reporting_area_filter_label(
                        filters["province"]
                    )
                ),
                "",
            )
            if filters["province"]
            else ""
        ),
        "metric_total": _number(
            totals[f"{selected_metric}_total"]
        ),
        "record_count": int(_zero(totals["record_count"])),
        "province_count": len(map_data["provinces"]),
    }

    scope_filter_chips = _build_active_filter_chips(
        request,
        {
            **filters,
            "province": reporting_area_filter_label(
                filters["province"]
            ),
            "metric": "",
        },
        metric_config,
        metric_label="Map metric",
        include_defaults=True,
        include_period=False,
        default_labels={
            "region": "All Regions",
            "province": "All Provinces",
            "commodity_group": "All Commodity",
            "commodity_subgroup": "All Subgroups",
        },
    )
    period_remove_keys = [
        "period_mode",
        "years",
        "year",
        "year_all",
        "start_year",
        "end_year",
        "months",
        "month",
        "month_all",
        "start_month",
        "end_month",
    ]
    period_clear_url = _url_with_query(
        request,
        remove=period_remove_keys,
    )
    active_filter_chips = [
        {
            "label": filters["selected_year_label"],
            "clear_url": (
                ""
                if filters.get("period_mode") == "latest_year"
                else period_clear_url
            ),
        },
        {
            "label": filters["selected_month_label"],
            "clear_url": (
                ""
                if filters.get("period_mode") == "latest_year"
                and filters["selected_month_label"] == "All Months"
                else period_clear_url
            ),
        },
    ]

    if selected_hazard:
        active_filter_chips.append(
            {
                "label": selected_hazard.display_label,
                "clear_url": _url_with_query(
                    request,
                    remove=["hazard", "incident"],
                ),
            }
        )
    else:
        active_filter_chips.append({"label": "All Hazards", "clear_url": ""})
    if selected_incident:
        active_filter_chips.append(
            {
                "label": selected_incident["label"],
                "clear_url": _url_with_query(
                    request,
                    remove=["incident"],
                ),
            }
        )
    active_filter_chips.extend(scope_filter_chips)

    dashboard_reset_url = reverse("reports:dashboard")
    if request.GET.get("embed") == "1":
        dashboard_reset_url = f"{dashboard_reset_url}?embed=1"

    response = render(
        request,
        "reports/damage_losses.html",
        {
            "available_years": available_years,
            "month_options": [
                {
                    "value": month_number,
                    "label": calendar.month_name[month_number],
                    "short_label": calendar.month_abbr[month_number],
                }
                for month_number in range(1, 13)
            ],
            "date_modes": DATE_MODES,
            "active_hazards": active_hazards,
            "selected_hazard": selected_hazard,
            "selected_incident": selected_incident,
            "incident_cascade_options": (
                incident_cascade_options
            ),
            "region_options": region_options,
            "province_options": province_options,
            "province_cascade_options": province_cascade_options,
            "commodity_group_options": commodity_group_options,
            "commodity_subgroup_options": commodity_subgroup_options,
            "commodity_subgroup_cascade_options": commodity_subgroup_cascade_options,
            "selected_filters": {
                **filters,
                "province_label": reporting_area_filter_label(filters["province"]),
            },
            "selected_metric": metric_config,
            "record_count": _zero(totals["record_count"]),
            "metric_total": _zero(
                totals[f"{selected_metric}_total"]
            ),
            "map_data": map_data,
            "map_config": map_config,
            "active_filter_chips": active_filter_chips,
            "is_embedded": request.GET.get("embed") == "1",
            "dashboard_reset_url": dashboard_reset_url,
            "dashboard_navigation_url": _preserved_url(
                request,
                reverse("reports:analytics"),
            ),
        },
    )
    if request.GET.get("embed") == "1":
        response["X-Frame-Options"] = "SAMEORIGIN"
    return response


damage_losses = dashboard
