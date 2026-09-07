from __future__ import annotations

from django.db.models import Count, Sum

from reports.analytics.formatting import number, short_region_label
from reports.map_reporting_areas import (
    NCR_REGION_CODE,
    reporting_area_display_name,
)


def build_province_reporting_area_totals(
    filtered_reports,
    metric_field,
    *,
    include_filter_value=False,
):
    """Aggregate normalized reports into Province/HUC map reporting areas."""

    rows = (
        filtered_reports.values(
            "location_psgc_key__province_huc_key__psgc_code",
            "location_psgc_key__province_huc_key__location_name",
            "location_psgc_key__province_huc_name",
            "location_psgc_key__province_huc_key__correspondence_code",
            "location_psgc_key__region_key__psgc_code",
            "location_psgc_key__region_name",
        )
        .annotate(
            record_count=Count("damage_report_key"),
            metric_value=Sum(metric_field),
            affected_farmers=Sum("affected_farmers_fisherfolk_count"),
            area_affected=Sum("area_affected_ha"),
            volume_loss=Sum("production_loss_mt"),
            value_loss=Sum("value_loss_php"),
        )
        .order_by("-metric_value")
    )

    reporting_areas = {}
    for row in rows:
        province_code = (
            row["location_psgc_key__province_huc_key__psgc_code"] or ""
        )
        region_code = row["location_psgc_key__region_key__psgc_code"] or ""
        reporting_code = (
            NCR_REGION_CODE if region_code == NCR_REGION_CODE else province_code
        )
        if not reporting_code:
            continue

        province_name = (
            row["location_psgc_key__province_huc_name"]
            or row["location_psgc_key__province_huc_key__location_name"]
            or "Unspecified Reporting Area"
        )
        defaults = {
            "province_name": reporting_area_display_name(
                reporting_code,
                province_name,
            ),
            "region_name": (
                row["location_psgc_key__region_name"] or "Unspecified Region"
            ),
            "short_region_label": short_region_label(
                row["location_psgc_key__region_name"]
            ),
            "psgc_key": f"PH{reporting_code}",
            "psgc_code": reporting_code,
            "correspondence_code": (
                row[
                    "location_psgc_key__province_huc_key__correspondence_code"
                ]
                if reporting_code == province_code
                else ""
            )
            or "",
            "metric_value": 0,
            "record_count": 0,
            "affected_farmers": 0,
            "area_affected": 0,
            "volume_loss": 0,
            "value_loss": 0,
        }
        if include_filter_value:
            defaults["filter_value"] = province_name

        reporting_area = reporting_areas.setdefault(reporting_code, defaults)
        reporting_area["metric_value"] += number(row["metric_value"])
        reporting_area["record_count"] += row["record_count"] or 0
        reporting_area["affected_farmers"] += number(row["affected_farmers"])
        reporting_area["area_affected"] += number(row["area_affected"])
        reporting_area["volume_loss"] += number(row["volume_loss"])
        reporting_area["value_loss"] += number(row["value_loss"])

    provinces = sorted(
        reporting_areas.values(),
        key=lambda area: area["metric_value"],
        reverse=True,
    )
    return {
        "provinces": provinces,
        "max_metric_value": max(
            (area["metric_value"] for area in provinces),
            default=0,
        ),
    }
