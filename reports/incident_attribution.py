from django.db.models import DateField, F
from django.db.models.functions import Coalesce


def incident_analysis_date(
    start_date,
    end_date,
    hazard_key,
):
    """Return the calendar date used to attribute incident totals."""
    return end_date or start_date


def damage_report_analysis_date_expression():
    """Build the ORM equivalent of ``incident_analysis_date``."""
    return Coalesce(
        F("incident_key__incident_end_date"),
        F("incident_key__incident_start_date"),
        output_field=DateField(),
    )
