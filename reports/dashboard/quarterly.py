from django.db.models import Sum
from django.db.models.functions import ExtractQuarter

from reports.analytics import METRIC_CONFIG, number
from reports.dashboard.aggregation import METRIC_FIELDS, nullable_sum
from reports.incident_attribution import damage_report_analysis_date_expression


def build_quarterly_breakdown(filtered_reports, period_label, *, observations=None):
    """Build Q1–Q4 totals from the dashboard's filtered report set."""

    if observations is not None:
        # Analytics already selected exact months/dates and capped elapsed-year
        # reporting. Keep missing quarters distinct from a recorded zero.
        return {
            "labels": ["Q1", "Q2", "Q3", "Q4"],
            "period_label": period_label,
            "analytics_mode": True,
            **{metric: [nullable_sum(row[metric] for row in observations
                                     if (row["analysis_date"].month - 1) // 3 == quarter)
                         for quarter in range(4)]
               for metric in METRIC_FIELDS},
        }

    rows = (
        filtered_reports
        .annotate(
            dashboard_analysis_date=damage_report_analysis_date_expression(),
        )
        .annotate(
            dashboard_quarter=ExtractQuarter("dashboard_analysis_date"),
        )
        .values("dashboard_quarter")
        .annotate(
            affected_farmers=Sum(METRIC_CONFIG["farmers"]["field"]),
            area_affected=Sum(METRIC_CONFIG["area"]["field"]),
            volume_loss=Sum(METRIC_CONFIG["volume"]["field"]),
            value_loss=Sum(METRIC_CONFIG["value"]["field"]),
        )
        .order_by("dashboard_quarter")
    )
    by_quarter = {
        int(row["dashboard_quarter"]): row
        for row in rows
        if row["dashboard_quarter"]
    }

    hazard_rows = (
        filtered_reports
        .annotate(
            dashboard_analysis_date=damage_report_analysis_date_expression(),
        )
        .annotate(
            dashboard_quarter=ExtractQuarter("dashboard_analysis_date"),
        )
        .values(
            "incident_key__hazard_key__hazard_key",
            "dashboard_quarter",
        )
        .annotate(
            affected_farmers=Sum(METRIC_CONFIG["farmers"]["field"]),
            area_affected=Sum(METRIC_CONFIG["area"]["field"]),
            volume_loss=Sum(METRIC_CONFIG["volume"]["field"]),
            value_loss=Sum(METRIC_CONFIG["value"]["field"]),
        )
        .order_by()
    )
    by_hazard = {}
    for row in hazard_rows:
        hazard_key = str(
            row.get("incident_key__hazard_key__hazard_key") or ""
        ).strip()
        quarter = row.get("dashboard_quarter")
        if not hazard_key or not quarter:
            continue
        hazard_breakdown = by_hazard.setdefault(
            hazard_key,
            {
                "labels": ["Q1", "Q2", "Q3", "Q4"],
                "affected_farmers": [0, 0, 0, 0],
                "area_affected": [0, 0, 0, 0],
                "volume_loss": [0, 0, 0, 0],
                "value_loss": [0, 0, 0, 0],
                "period_label": period_label,
            },
        )
        index = int(quarter) - 1
        if 0 <= index < 4:
            for metric_key in (
                "affected_farmers",
                "area_affected",
                "volume_loss",
                "value_loss",
            ):
                hazard_breakdown[metric_key][index] += number(
                    row.get(metric_key)
                )

    return {
        "labels": ["Q1", "Q2", "Q3", "Q4"],
        "affected_farmers": [
            number(by_quarter.get(quarter, {}).get("affected_farmers"))
            for quarter in range(1, 5)
        ],
        "area_affected": [
            number(by_quarter.get(quarter, {}).get("area_affected"))
            for quarter in range(1, 5)
        ],
        "volume_loss": [
            number(by_quarter.get(quarter, {}).get("volume_loss"))
            for quarter in range(1, 5)
        ],
        "value_loss": [
            number(by_quarter.get(quarter, {}).get("value_loss"))
            for quarter in range(1, 5)
        ],
        "period_label": period_label,
        "by_hazard": by_hazard,
    }
