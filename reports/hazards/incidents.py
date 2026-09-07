from collections import defaultdict

from django.db.models import Count, Q, Sum

from reports.incident_attribution import incident_analysis_date
from reports.models import DamageReport


def build_incident_year_groups():
    """Aggregate active damage reports by dated incident and calendar year."""
    incident_rows = list(
        DamageReport.objects.filter(
            is_active=True,
        )
        .filter(
            Q(incident_key__incident_end_date__isnull=False)
            | Q(incident_key__incident_start_date__isnull=False)
        )
        .values(
            "incident_key",
            "incident_key__incident_name",
            "incident_key__incident_start_date",
            "incident_key__incident_end_date",
            "incident_key__hazard_key_id",
            "incident_key__hazard_key__hazard_type",
        )
        .annotate(
            record_count=Count("damage_report_key"),
            affected_farmers=Sum(
                "affected_farmers_fisherfolk_count"
            ),
            area_affected=Sum("area_affected_ha"),
            volume_loss=Sum("production_loss_mt"),
            value_loss=Sum("value_loss_php"),
        )
    )

    incidents_by_year = defaultdict(list)
    for row in incident_rows:
        start_date = row["incident_key__incident_start_date"]
        end_date = row["incident_key__incident_end_date"]
        analysis_date = incident_analysis_date(
            start_date,
            end_date,
            row["incident_key__hazard_key_id"],
        )
        incidents_by_year[analysis_date.year].append(
            {
                "incident_key": row["incident_key"],
                "incident_name": row[
                    "incident_key__incident_name"
                ],
                "hazard_key": row["incident_key__hazard_key_id"],
                "hazard_type": row[
                    "incident_key__hazard_key__hazard_type"
                ],
                "start_date": start_date,
                "end_date": end_date,
                "analysis_date": analysis_date,
                "record_count": row["record_count"],
                "affected_farmers": row["affected_farmers"] or 0,
                "area_affected": row["area_affected"] or 0,
                "volume_loss": row["volume_loss"] or 0,
                "value_loss": row["value_loss"] or 0,
            }
        )

    year_groups = []
    for year in sorted(incidents_by_year, reverse=True):
        incidents = sorted(
            incidents_by_year[year],
            key=lambda incident: (
                incident["analysis_date"],
                incident["incident_name"].casefold(),
            ),
        )
        totals = {
            metric: sum(incident[metric] for incident in incidents)
            for metric in (
                "affected_farmers",
                "area_affected",
                "volume_loss",
                "value_loss",
            )
        }
        ranked_incidents = sorted(
            (
                incident
                for incident in incidents
                if incident["value_loss"] > 0
            ),
            key=lambda incident: (
                -incident["value_loss"],
                incident["analysis_date"],
                incident["incident_name"].casefold(),
            ),
        )[:3]
        for rank, incident in enumerate(ranked_incidents, start=1):
            incident["severity_rank"] = rank
            incident["value_loss_share_display"] = (
                f"{incident['value_loss'] / totals['value_loss'] * 100:.1f}%"
            )

        year_groups.append(
            {
                "year": year,
                "incident_count": len(incidents),
                "incidents": incidents,
                "totals": totals,
            }
        )

    return year_groups
