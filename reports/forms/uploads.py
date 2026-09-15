from django import forms

from reports.constants import ImportStatus
from reports.models import DisasterIncident, ImportBatch

MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024


MAX_UPLOAD_SIZE_MB = 5


class UploadReportForm(forms.Form):
    upload_mode = forms.ChoiceField(
        choices=[("historical", "Historical Yearly"), ("current", "Current Incident")],
        initial="historical",
        widget=forms.RadioSelect
    )
    csv_file = forms.FileField(label="CSV file")
    source_year = forms.IntegerField(
        initial=2025,
        min_value=1900,
        max_value=2100,
        required=False
    )
    source_template = forms.ChoiceField(
        choices=[
            ("2025 wide damage report template", "2025 wide damage report template"),
        ],
        initial="2025 wide damage report template",
        required=False,
    )
    incident = forms.ModelChoiceField(
        queryset=DisasterIncident.objects.none(),
        required=False,
        label="Active Incident"
    )
    replaces_batch_key = forms.IntegerField(
        required=False,
        widget=forms.HiddenInput,
    )
    remarks = forms.CharField(widget=forms.Textarea, required=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["incident"].queryset = DisasterIncident.objects.filter(
            is_active=True,
            archived_at__isnull=True,
        )

    def clean_csv_file(self):
        f = self.cleaned_data["csv_file"]
        if not f.name.lower().endswith(".csv"):
            raise forms.ValidationError("Uploaded file must be a CSV file.")
        if f.size > MAX_UPLOAD_SIZE_BYTES:
            raise forms.ValidationError(f"CSV file must not exceed {MAX_UPLOAD_SIZE_MB} MB.")
        return f

    def clean(self):
        cleaned_data = super().clean()
        mode = cleaned_data.get("upload_mode")

        if mode == "historical":
            if not (cleaned_data.get("source_template") or "").strip():
                self.add_error("source_template", "Source template is required for historical uploads.")
        elif mode == "current":
            incident = cleaned_data.get("incident")
            if not incident:
                self.add_error("incident", "An active incident must be selected for current uploads.")
            elif incident.incident_start_date is None:
                self.add_error(
                    "incident",
                    "The selected incident must have a start date before report upload.",
                )

        replaces_batch_key = cleaned_data.get("replaces_batch_key")
        if replaces_batch_key:
            try:
                replacement_batch = ImportBatch.objects.get(
                    pk=replaces_batch_key,
                )
            except ImportBatch.DoesNotExist:
                self.add_error(None, "The report selected for update no longer exists.")
                return cleaned_data

            incident = cleaned_data.get("incident")
            if mode != "current":
                self.add_error(None, "Only current-incident reports can be updated.")
            elif replacement_batch.import_status != ImportStatus.IMPORTED:
                self.add_error(None, "Only an imported report can be updated.")
            elif not replacement_batch.current_incident_key:
                self.add_error(None, "The selected batch is not a current-incident report.")
            elif incident and str(incident.pk) != replacement_batch.current_incident_key:
                self.add_error(
                    "incident",
                    "The replacement must use the same active incident as the existing report.",
                )
            elif ImportBatch.objects.filter(
                replaces_batch_key=replacement_batch.pk,
            ).exclude(
                import_status__in=(ImportStatus.FAILED, ImportStatus.CANCELLED),
            ).exists():
                self.add_error(
                    None,
                    "This report already has an update in progress. Continue or delete that update first.",
                )
            else:
                self.replacement_batch = replacement_batch

        return cleaned_data


class BulletinCheckerForm(forms.Form):
    """Choose a stored incident or an in-memory approved-template CSV."""

    bulletin_title = forms.CharField(
        required=False,
        label="Bulletin title",
        max_length=200,
    )
    bulletin_number = forms.CharField(
        required=False,
        label="Bulletin No.",
        max_length=30,
        initial="01",
    )
    bulletin_final = forms.BooleanField(
        required=False,
        label="Final bulletin",
        initial=False,
    )
    bulletin_as_of = forms.CharField(
        required=False,
        label="Bulletin as of",
        max_length=120,
    )
    bulletin_time = forms.CharField(
        required=False,
        label="Bulletin time",
        max_length=20,
    )

    source_mode = forms.ChoiceField(
        choices=[
            ("existing", "Existing incident"),
            ("external", "Temporary external CSV"),
        ],
        initial="existing",
        widget=forms.HiddenInput,
    )
    incident = forms.ModelChoiceField(
        queryset=DisasterIncident.objects.none(),
        required=False,
        label="Incident",
    )
    csv_file = forms.FileField(
        required=False,
        label="Damage report CSV",
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["incident"].queryset = DisasterIncident.objects.filter(
            is_active=True,
            archived_at__isnull=True,
        )

    def clean_csv_file(self):
        uploaded = self.cleaned_data.get("csv_file")
        if uploaded is None:
            return uploaded
        if not uploaded.name.lower().endswith(".csv"):
            raise forms.ValidationError("Uploaded file must be a CSV file.")
        if uploaded.size > MAX_UPLOAD_SIZE_BYTES:
            raise forms.ValidationError(
                f"CSV file must not exceed {MAX_UPLOAD_SIZE_MB} MB."
            )
        return uploaded

    def clean(self):
        cleaned_data = super().clean()
        if cleaned_data.get("source_mode") == "existing":
            if not cleaned_data.get("incident"):
                self.add_error("incident", "Select one existing incident.")
        elif cleaned_data.get("source_mode") == "external":
            if not cleaned_data.get("csv_file"):
                self.add_error("csv_file", "Choose a damage report CSV.")
        return cleaned_data
