"""Read-only square bulletin previews for exactly one incident."""
import logging
from datetime import datetime

from django.shortcuts import render
from django.utils import timezone

from reports.dashboard.bulletin import build_bulletin, build_external_bulletin
from reports.forms.uploads import BulletinCheckerForm
from reports.models import DamageReport, DisasterIncident
from reports.pipeline.common import (
    CONTEXT_HEADERS,
    get_staging_columns,
    normalize_psgc_key,
    psgc_key_format_error,
)
from reports.pipeline.loading import REQUIRED_CONTEXT_COLUMNS
from reports.services.uploads import (
    UploadContextError,
    UploadPreflightError,
    preflight_csv_upload,
    validate_upload_context,
)

logger = logging.getLogger(__name__)


def _format_bulletin_number(value):
    """Keep numeric bulletin numbers at a stable minimum two-character width."""
    raw = str(value or "").strip()
    if raw.isdigit():
        return str(int(raw)).zfill(2)
    return raw


def _normalize_bulletin_time(value):
    """Store bulletin times on an hour boundary, regardless of input minutes."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    for pattern in ("%H:%M", "%H:%M:%S", "%I:%M %p"):
        try:
            return datetime.strptime(raw, pattern).strftime("%H:00")
        except ValueError:
            continue
    return ""


def bulletin_checker(request):
    incidents = DisasterIncident.objects.filter(
        is_active=True,
        archived_at__isnull=True,
    ).order_by(
        "-incident_start_date", "incident_name"
    )
    form = BulletinCheckerForm(request.POST or None, request.FILES or None)
    selected = None
    bulletin = None
    source_label = ""
    source_date = ""
    selection_error = ""
    bulletin_title = ""
    bulletin_number = "01"
    bulletin_final = False
    now = timezone.localtime()
    bulletin_as_of = now.strftime("%B %-d, %Y")
    bulletin_time = now.strftime("%H:00")
    bulletin_display_as_of = ""
    if request.method == "POST":
        bulletin_title = str(request.POST.get("bulletin_title") or "").strip()
        bulletin_number = _format_bulletin_number(request.POST.get("bulletin_number")) or "01"
        bulletin_final = request.POST.get("bulletin_final") in {"on", "1", "true", "yes"}
        bulletin_as_of = str(request.POST.get("bulletin_as_of") or "").strip()
        bulletin_time = _normalize_bulletin_time(request.POST.get("bulletin_time"))

    def format_bulletin_time(value):
        raw = str(value or "").strip()
        for pattern in ("%H:%M", "%H:%M:%S", "%I:%M %p"):
            try:
                return datetime.strptime(raw, pattern).strftime("%I:00 %p")
            except ValueError:
                continue
        return raw

    def update_display_as_of():
        nonlocal bulletin_display_as_of
        formatted_time = format_bulletin_time(bulletin_time)
        if formatted_time and "|" not in bulletin_as_of:
            bulletin_display_as_of = f"{bulletin_as_of} | {formatted_time}" if bulletin_as_of else formatted_time
        else:
            bulletin_display_as_of = bulletin_as_of

    def apply_bulletin_metadata(default_title="", default_as_of=""):
        nonlocal bulletin_title, bulletin_number, bulletin_as_of
        bulletin_title = bulletin_title or default_title
        bulletin_number = _format_bulletin_number(bulletin_number) or "01"
        bulletin_as_of = bulletin_as_of or now.strftime("%B %-d, %Y")
        update_display_as_of()

    if request.method == "GET":
        keys = request.GET.getlist("incident")
        if keys:
            selected = incidents.filter(pk=keys[0]).first() if len(keys) == 1 else None
            if selected:
                bulletin = build_bulletin(
                    DamageReport.objects.filter(is_active=True, incident_key=selected)
                )
                source_label = selected.incident_name
                source_date = " – ".join(filter(None, [
                    selected.incident_start_date.strftime("%B %-d, %Y") if selected.incident_start_date else "",
                    selected.incident_end_date.strftime("%B %-d, %Y") if selected.incident_end_date else "",
                ]))
                apply_bulletin_metadata(selected.incident_name, source_date)
            else:
                selection_error = "Select one available incident to preview its bulletin."
    elif form.is_valid():
        if form.cleaned_data["source_mode"] == "existing":
            selected = form.cleaned_data["incident"]
            bulletin = build_bulletin(
                DamageReport.objects.filter(is_active=True, incident_key=selected)
            )
            source_label = selected.incident_name
            source_date = " – ".join(filter(None, [
                selected.incident_start_date.strftime("%B %-d, %Y") if selected.incident_start_date else "",
                selected.incident_end_date.strftime("%B %-d, %Y") if selected.incident_end_date else "",
            ]))
            apply_bulletin_metadata(selected.incident_name, source_date)
        else:
            try:
                csv_file = form.cleaned_data["csv_file"]
                preflight = preflight_csv_upload(csv_file.read())
                _validate_external_template(preflight)
                # Historical mode applies the same year/context preflight while
                # allowing an external incident that is not in the database.
                validate_upload_context(
                    preflight,
                    upload_mode="historical",
                    source_year=preflight.detected_year,
                )
                bulletin = build_external_bulletin(preflight)
                source_label = _external_title(preflight)
                source_date = str(preflight.detected_year or "").strip()
                apply_bulletin_metadata(source_label, source_date)
                if not bulletin["has_reports"]:
                    selection_error = "The validated CSV contains no non-zero commodity report values."
            except UnicodeDecodeError:
                form.add_error(
                    "csv_file",
                    "The CSV could not be read as UTF-8 text. Export it again as a UTF-8 CSV.",
                )
                selection_error = "The temporary CSV could not be used for a bulletin preview."
            except (UploadPreflightError, UploadContextError, ValueError) as exc:
                form.add_error("csv_file", str(exc))
                selection_error = "The temporary CSV could not be used for a bulletin preview."
            except Exception:
                logger.exception("Unexpected error preparing temporary bulletin CSV")
                form.add_error(
                    "csv_file",
                    "The temporary CSV could not be processed. Check the file and try again.",
                )
                selection_error = "The temporary CSV could not be used for a bulletin preview."

    context = {
        "incidents": incidents,
        "selected_incident": selected,
        "form": form,
        "bulletin": bulletin,
        "bulletin_source_label": source_label,
        "bulletin_source_date": source_date,
        "bulletin_title": bulletin_title,
        "bulletin_number": bulletin_number,
        "bulletin_final": bulletin_final,
        "bulletin_as_of": bulletin_as_of,
        "bulletin_time": bulletin_time,
        "bulletin_display_as_of": bulletin_display_as_of or bulletin_as_of,
        "selection_error": selection_error,
    }
    return render(request, "reports/bulletin_checker.html", context)


def _external_title(preflight):
    # A temporary CSV has no persisted incident record. Keep its editable
    # bulletin title explicit instead of presenting a derived calamity/month
    # label as though it were an incident name.
    return "Incident Name"


def _validate_external_template(preflight):
    """Apply the upload loader's required context contract without staging."""
    missing = sorted(REQUIRED_CONTEXT_COLUMNS - set(preflight.header_positions))
    if missing:
        raise UploadPreflightError(
            "CSV is missing required template columns: " + ", ".join(missing)
        )
    recognized_metrics = (
        set(preflight.header_positions) - set(CONTEXT_HEADERS.values())
    ) & set(get_staging_columns())
    if not recognized_metrics:
        raise UploadPreflightError(
            "CSV has no recognized damage-report metric columns. Use the Incident Upload Template."
        )
    positions = preflight.header_positions
    psgc_position = positions.get("raw_psgc_key")
    if psgc_position is not None:
        for source_row, values in preflight.rows:
            raw_psgc_key = values[psgc_position]
            format_error = psgc_key_format_error(raw_psgc_key)
            if format_error:
                raise UploadContextError(
                    f"Source row {source_row} has invalid PSGC KEY "
                    f"{normalize_psgc_key(raw_psgc_key)!r}. {format_error}"
                )
    contexts = set()
    for source_row, values in preflight.rows:
        required_values = {
            field: str(values[positions[field]]).strip()
            for field in REQUIRED_CONTEXT_COLUMNS
        }
        if any(not value for value in required_values.values()):
            raise UploadContextError(
                f"Source row {source_row} is missing required incident context."
            )
        contexts.add(tuple(required_values[field] for field in ("raw_year", "raw_month", "raw_category", "raw_calamity")))
    if len(contexts) != 1:
        raise UploadContextError(
            "Temporary bulletin CSVs must contain exactly one incident context "
            "(month, category, calamity, region, and year)."
        )
