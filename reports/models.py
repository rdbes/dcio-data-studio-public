# This is an auto-generated Django model module.
# You'll have to do the following manually to clean this up:
#   * Rearrange models' order
#   * Make sure each model has one field with primary_key=True
#   * Make sure each ForeignKey and OneToOneField has `on_delete` set to the desired behavior
#   * Remove `managed = False` lines if you wish to allow Django to create, modify, and delete the table
# Feel free to rename the models, but don't rename db_table values or field names.
from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models

from reports.constants import (
    AuditAction,
    AuditStatus,
    ImportStatus,
    IncidentCandidateStatus,
    MappingIssueStatus,
    ValidationStatus,
)


class DamageReport(models.Model):
    damage_report_key = models.BigAutoField(primary_key=True, db_comment='Generated surrogate primary key for one normalized damage report row.')
    import_batch_key = models.ForeignKey(
        'ImportBatch',
        models.DO_NOTHING,
        db_column='import_batch_key',
        blank=True,
        null=True,
        related_name='damage_reports',
        db_comment='Import batch that produced this normalized damage report row; null for legacy/manual rows.',
    )
    incident_key = models.ForeignKey('DisasterIncident', models.DO_NOTHING, db_column='incident_key')
    location_psgc_key = models.ForeignKey('RefPsgcLocation', models.DO_NOTHING, db_column='location_psgc_key', db_comment='Most-specific available standardized PSGC location from the cleaned source.')
    commodity_key = models.ForeignKey('RefCommodity', models.DO_NOTHING, db_column='commodity_key')
    area_totally_damaged_ha = models.DecimalField(max_digits=18, decimal_places=4, blank=True, null=True)
    area_partially_damaged_ha = models.DecimalField(max_digits=18, decimal_places=4, blank=True, null=True)
    area_affected_ha = models.DecimalField(max_digits=18, decimal_places=4, blank=True, null=True)
    production_loss_mt = models.DecimalField(max_digits=18, decimal_places=4, blank=True, null=True)
    value_loss_php = models.DecimalField(max_digits=20, decimal_places=2, blank=True, null=True)
    affected_farmers_fisherfolk_count = models.BigIntegerField(blank=True, null=True)
    affected_livestock_poultry_heads_count = models.BigIntegerField(blank=True, null=True)
    remarks = models.TextField(blank=True, null=True)
    is_active = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(db_comment='Last-update timestamp; application or database automation must set this on updates.')

    class Meta:
        managed = True
        db_table = 'damage_report'
        unique_together = (('incident_key', 'location_psgc_key', 'commodity_key'),)
        db_table_comment = 'Normalized fact table for reported agriculture and fisheries damage and loss metrics.'


class DisasterIncident(models.Model):
    incident_key = models.CharField(primary_key=True, max_length=100)
    incident_name = models.CharField(max_length=200)
    hazard_key = models.ForeignKey('RefHazard', models.DO_NOTHING, db_column='hazard_key', db_comment='Required hazard classification referencing ref_hazard.hazard_key.')
    incident_start_date = models.DateField(blank=True, null=True)
    incident_end_date = models.DateField(blank=True, null=True)
    is_active = models.BooleanField()
    archived_at = models.DateTimeField(blank=True, null=True)
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        models.SET_NULL,
        blank=True,
        null=True,
        related_name="archived_disaster_incidents",
    )
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(db_comment='Last-update timestamp; application or database automation must set this on updates.')

    class Meta:
        managed = True
        db_table = 'disaster_incident'
        db_table_comment = 'Standardized disaster or hazard incidents linked to a reference hazard type.'


class ImportBatch(models.Model):
    import_batch_key = models.BigAutoField(primary_key=True)
    file_name = models.TextField()
    source_year = models.IntegerField()
    source_template = models.TextField(blank=True, null=True)
    replaces_batch_key = models.BigIntegerField(
        blank=True,
        null=True,
        db_comment='Imported current-incident batch replaced atomically by this upload, retained as a lineage snapshot after replacement.',
    )
    report_first_uploaded_at = models.DateTimeField(
        blank=True,
        null=True,
        db_comment='Timestamp when the first report for this Current Incident lineage was uploaded; carried forward across replacements.',
    )
    import_type = models.CharField(max_length=32)
    import_status = models.CharField(
        max_length=32,
        choices=ImportStatus.choices,
        db_comment='Current stage of the documented yearly import workflow.',
    )
    validation_status = models.CharField(
        max_length=32,
        choices=ValidationStatus.choices,
        db_comment='Current batch validation result; initialized as Pending.',
    )
    active_update_override_accepted = models.BooleanField(
        default=False,
        db_comment=(
            "Data Manager explicitly accepted active-report cumulative "
            "comparison findings for this replacement batch."
        ),
    )
    total_raw_rows = models.BigIntegerField()
    total_incident_candidates = models.BigIntegerField()
    total_error_count = models.BigIntegerField()
    total_warning_count = models.BigIntegerField()
    file_hash = models.TextField(unique=True, blank=True, null=True)
    total_duplicate_rows = models.BigIntegerField(default=0)
    remarks = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(db_comment='Last-update timestamp; later application or database automation must refresh it.')

    @property
    def current_incident_key(self) -> str:
        """Return the selected current-incident key encoded by the upload workflow."""
        source_template = self.source_template or ""
        if self.import_type != "User Upload" or not source_template.startswith("Incident:"):
            return ""
        return source_template.removeprefix("Incident:").strip()

    class Meta:
        managed = True
        db_table = 'import_batch'
        constraints = [
            models.CheckConstraint(
                condition=models.Q(import_status__in=ImportStatus.values),
                name="chk_import_batch_status",
            ),
            models.CheckConstraint(
                condition=models.Q(validation_status__in=ValidationStatus.values),
                name="chk_import_batch_validation_status",
            ),
        ]
        db_table_comment = 'Tracks one import attempt for one yearly raw damage-report file.'


class ImportValidationIssue(models.Model):
    validation_issue_key = models.BigAutoField(primary_key=True)
    import_batch_key = models.ForeignKey(ImportBatch, models.DO_NOTHING, db_column='import_batch_key')
    stg_raw_key = models.ForeignKey('StgDamageReportRaw', models.DO_NOTHING, db_column='stg_raw_key', blank=True, null=True, db_comment='Optional staging-row relationship; null for batch-level or file-level issues.')
    issue_level = models.CharField(max_length=16)
    issue_type = models.TextField()
    field_name = models.TextField(blank=True, null=True)
    expected_value = models.TextField(blank=True, null=True)
    actual_value = models.TextField(blank=True, null=True, db_comment='Raw uploaded value associated with the issue, preserved as text.')
    difference_value = models.DecimalField(max_digits=10, decimal_places=5, blank=True, null=True)  # max_digits and decimal_places have been guessed, as this database handles decimal fields as float
    issue_message = models.TextField()
    is_resolved = models.BooleanField()
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(db_comment='Last-update timestamp; later application or database automation must refresh it.')

    class Meta:
        managed = True
        db_table = 'import_validation_issue'
        db_table_comment = 'Stores informational, warning, and error findings produced before final import.'


class ImportMappingIssue(models.Model):
    """Grouped mapping issue detected for one import batch.

    This stores source-value uncertainty at the batch level. For example, if
    500 rows contain the same unmapped hazard value, the system should store
    one grouped issue with row count and sample row numbers, not 500 noisy
    row-level messages.

    Catch-all references such as Unknown and Others should be recorded only as
    explicit suggestions or reviewed resolutions. They must not be used as
    automatic fallback mappings for every unmapped source value.
    """

    mapping_issue_key = models.BigAutoField(primary_key=True)
    import_batch_key = models.ForeignKey(
        ImportBatch,
        models.DO_NOTHING,
        db_column="import_batch_key",
        related_name="mapping_issues",
    )
    stg_raw_key = models.ForeignKey(
        "StgDamageReportRaw",
        models.DO_NOTHING,
        db_column="stg_raw_key",
        blank=True,
        null=True,
        db_comment="Optional sample staging row related to this grouped mapping issue.",
    )
    domain = models.CharField(
        max_length=64,
        db_comment="Mapping domain such as hazard, commodity, location, month, year, sector, or incident.",
    )
    source_field = models.TextField(
        blank=True,
        null=True,
        db_comment="Source CSV field or combined context that caused the mapping issue.",
    )
    raw_value = models.TextField(
        blank=True,
        null=True,
        db_comment="Raw source value or combined raw context preserved for review.",
    )
    normalized_value = models.TextField(
        blank=True,
        null=True,
        db_comment="Normalized raw value used for matching and grouping.",
    )
    source_row_count = models.BigIntegerField(
        default=0,
        db_comment="Number of source rows affected by this grouped mapping issue.",
    )
    sample_rows = ArrayField(
        models.BigIntegerField(),
        default=list,
        blank=True,
        db_comment="Small sample of source row numbers affected by this issue.",
    )
    status = models.CharField(
        max_length=32,
        choices=MappingIssueStatus.choices,
        default=MappingIssueStatus.UNMAPPED,
        db_comment="Mapping status such as unmapped, ambiguous, suggested, resolved, ignored, or invalid.",
    )
    confidence_level = models.CharField(
        max_length=16,
        default="none",
        db_comment="Confidence level from the mapping resolver: high, medium, low, or none.",
    )
    suggested_key = models.TextField(
        blank=True,
        null=True,
        db_comment="Optional suggested approved reference key.",
    )
    suggested_label = models.TextField(
        blank=True,
        null=True,
        db_comment="Human-readable label for the suggested approved reference key.",
    )
    suggested_requires_review = models.BooleanField(
        default=False,
        db_comment="True when the suggestion points to an explicit value that still requires review.",
    )
    message = models.TextField(
        blank=True,
        null=True,
        db_comment="Human-readable explanation of the mapping issue.",
    )
    required_action = models.TextField(
        blank=True,
        null=True,
        db_comment="Clear instruction for the user or administrator.",
    )
    is_resolved = models.BooleanField(default=False)
    resolved_key = models.TextField(blank=True, null=True)
    resolved_label = models.TextField(blank=True, null=True)
    resolved_requires_review = models.BooleanField(
        default=False,
        db_comment="True when the approved resolution uses an alias that still requires review.",
    )
    resolved_by = models.TextField(blank=True, null=True)
    resolved_at = models.DateTimeField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.import_batch_key_id} · {self.domain} · {self.raw_value or self.normalized_value}"

    class Meta:
        managed = True
        db_table = "import_mapping_issue"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=MappingIssueStatus.values),
                name="chk_mapping_issue_status",
            ),
        ]
        indexes = [
            models.Index(fields=["import_batch_key", "domain"], name="idx_mapping_issue_batch_domain"),
            models.Index(fields=["import_batch_key", "is_resolved"], name="idx_mapping_issue_resolved"),
            models.Index(fields=["domain", "normalized_value"], name="idx_mapping_issue_lookup"),
            models.Index(fields=["status"], name="idx_mapping_issue_status"),
        ]
        db_table_comment = "Grouped source-value mapping issues detected during import review and validation."


class RefCommodity(models.Model):
    commodity_key = models.CharField(primary_key=True, max_length=100, db_comment='Stable primary key using the uppercase CMD_ naming convention.')
    main_sector = models.CharField(max_length=32)
    level_2_group = models.CharField(max_length=150, blank=True, null=True)
    level_3_group = models.CharField(max_length=150, blank=True, null=True)
    is_active = models.BooleanField()
    archived_at = models.DateTimeField(blank=True, null=True)
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        models.SET_NULL,
        blank=True,
        null=True,
        related_name="archived_ref_commodities",
    )
    remarks = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(db_comment='Last-update timestamp; application or database automation must set this on updates.')

    def __str__(self) -> str:
        parts = [self.main_sector]
        if self.level_2_group:
            parts.append(self.level_2_group)
        if self.level_3_group:
            parts.append(self.level_3_group)
        return " > ".join(parts)

    class Meta:
        managed = True
        db_table = 'ref_commodity'
        unique_together = (('main_sector', 'level_2_group', 'level_3_group'),)
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(
                    commodity_key__in=(
                        "CMD_OTHERS",
                        "CMD_UNKNOWN",
                        "CMD_CROPS_OTHER",
                        "CMD_CROPS_UNKNOWN",
                    )
                ),
                name="chk_ref_commodity_no_generic_catchall",
            ),
        ]
        db_table_comment = 'Master reference for standardized agriculture and fisheries commodity classifications.'


class RefHazard(models.Model):
    hazard_key = models.CharField(primary_key=True, max_length=64, db_comment='Stable primary key using the uppercase HZD_ naming convention.')
    hazard_category = models.CharField(max_length=32)
    hazard_type = models.CharField(max_length=100)
    common_raw_terms = ArrayField(
        models.TextField(),
        default=list,
        db_comment='Common source terms that may map to this standardized hazard type.',
    )
    is_active = models.BooleanField()
    archived_at = models.DateTimeField(blank=True, null=True)
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        models.SET_NULL,
        blank=True,
        null=True,
        related_name="archived_ref_hazards",
    )
    def __str__(self) -> str:
        if self.hazard_category and self.hazard_type:
            return f"{self.hazard_category} - {self.hazard_type}"
        return self.hazard_type or self.hazard_category or self.hazard_key

    class Meta:
        managed = True
        db_table = 'ref_hazard'
        unique_together = (('hazard_category', 'hazard_type'),)
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(
                    hazard_key__in=("HZD_OTHERS", "HZD_UNKNOWN")
                ),
                name="chk_ref_hazard_no_generic_catchall",
            ),
        ]
        db_table_comment = 'Master reference for standardized hazard categories and hazard types.'


class RefMappingAlias(models.Model):
    """Approved reusable mappings from raw CSV terms to reference keys.

    This table stores user-input variations such as "Palay", "Sept.", or
    "Marine Oil Spill" without polluting the official reference tables.

    Hazard aliases must point to explicit approved reference records. Unknown
    or generic Others source values remain unresolved until specifically
    classified.
    """

    alias_key = models.BigAutoField(primary_key=True)
    domain = models.CharField(
        max_length=64,
        db_comment="Mapping domain such as hazard, commodity, location, month, year, sector, or incident.",
    )
    raw_term = models.TextField(
        db_comment="Original or approved source term variation from uploaded CSV files."
    )
    normalized_term = models.TextField(
        db_comment="Normalized value used for matching raw source terms."
    )
    mapped_key = models.TextField(
        db_comment="Approved target reference key, such as HZD_OIL_SPILL or CMD_RICE."
    )
    mapped_label = models.TextField(
        blank=True,
        null=True,
        db_comment="Human-readable approved target label for admin/review screens.",
    )
    confidence_level = models.CharField(
        max_length=16,
        default="high",
        db_comment="Approved confidence level: high, medium, low, or none.",
    )
    requires_review = models.BooleanField(
        default=False,
        db_comment="True when this alias requires explicit review before use.",
    )
    is_active = models.BooleanField(default=True)
    approved_by = models.TextField(blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.domain}: {self.raw_term} → {self.mapped_key}"

    class Meta:
        managed = True
        db_table = "ref_mapping_alias"
        unique_together = (("domain", "normalized_term", "mapped_key"),)
        indexes = [
            models.Index(fields=["domain", "normalized_term"], name="idx_ref_alias_lookup"),
            models.Index(fields=["domain", "mapped_key"], name="idx_ref_alias_target"),
            models.Index(fields=["is_active"], name="idx_ref_alias_active"),
        ]
        db_table_comment = "Approved reusable source-term aliases for mapping uploaded CSV values to controlled reference keys."


class RefPsgcLocation(models.Model):
    psgc_key = models.CharField(primary_key=True, max_length=12, db_comment='Primary relationship key in the format PH plus the official 10-digit PSGC code.')
    psgc_code = models.CharField(unique=True, max_length=10)
    correspondence_code = models.CharField(max_length=9, blank=True, null=True)
    location_name = models.TextField()
    geographic_level = models.CharField(max_length=32)
    parent_psgc_key = models.ForeignKey('self', models.DO_NOTHING, db_column='parent_psgc_key', blank=True, null=True, db_comment='Immediate parent location; null for a top-level region.')
    region_key = models.ForeignKey('self', models.DO_NOTHING, db_column='region_key', related_name='refpsgclocation_region_key_set', blank=True, null=True)
    province_huc_key = models.ForeignKey('self', models.DO_NOTHING, db_column='province_huc_key', related_name='refpsgclocation_province_huc_key_set', blank=True, null=True)
    city_municipality_key = models.ForeignKey('self', models.DO_NOTHING, db_column='city_municipality_key', related_name='refpsgclocation_city_municipality_key_set', blank=True, null=True)
    barangay_key = models.ForeignKey('self', models.DO_NOTHING, db_column='barangay_key', related_name='refpsgclocation_barangay_key_set', blank=True, null=True)
    region_name = models.TextField(blank=True, null=True)
    province_huc_name = models.TextField(blank=True, null=True)
    city_municipality_name = models.TextField(blank=True, null=True)
    barangay_name = models.TextField(blank=True, null=True)
    is_active = models.BooleanField()
    psgc_version = models.TextField()
    psgc_reference_date = models.DateField()
    source_agency = models.TextField()
    source_notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField(db_comment='Last-update timestamp; application or database automation must set this on updates.')
    archived_at = models.DateTimeField(blank=True, null=True)
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        models.SET_NULL,
        blank=True,
        null=True,
        related_name="archived_ref_psgc_locations",
    )

    def __str__(self) -> str:
        level = self.geographic_level or ""
        name = self.location_name or ""
        if level.upper() in ("MUNICIPALITY", "CITY") and self.province_huc_name:
            return f"{name} ({self.province_huc_name}) [{level}]"
        return f"{name} [{level}]"

    class Meta:
        managed = True
        db_table = 'ref_psgc_location'
        db_table_comment = 'Master reference for official PSGC locations and their hierarchy.'
        indexes = [
            models.Index(
                fields=("correspondence_code",),
                name="idx_psgc_correspondence",
            ),
        ]


class StgDamageReportRaw(models.Model):
    stg_raw_key = models.BigAutoField(primary_key=True)
    import_batch_key = models.ForeignKey(ImportBatch, models.DO_NOTHING, db_column='import_batch_key')
    source_row_number = models.BigIntegerField(db_comment='Original source-file row number used to trace validation findings.')
    raw_year = models.TextField(blank=True, null=True)
    raw_region = models.TextField(blank=True, null=True)
    raw_province = models.TextField(blank=True, null=True)
    raw_category = models.TextField(blank=True, null=True)
    raw_calamity = models.TextField(blank=True, null=True, db_comment='Unmodified calamity text used later for incident extraction and confirmation.')
    raw_month = models.TextField(blank=True, null=True)
    raw_payload = models.JSONField(
        default=dict,
        db_comment="Unmodified source metric values keyed by canonical cleaned header.",
    )
    created_at = models.DateTimeField()

    class Meta:
        managed = True
        db_table = 'stg_damage_report_raw'
        unique_together = (('import_batch_key', 'source_row_number'),)
        db_table_comment = 'Preserves one original damage-report row with searchable context and a compact raw metric payload.'


class IncidentCandidate(models.Model):
    STATUS_FOR_REVIEW = IncidentCandidateStatus.FOR_REVIEW
    STATUS_CONFIRMED = IncidentCandidateStatus.CONFIRMED
    STATUS_CHOICES = IncidentCandidateStatus.CHOICES

    incident_candidate_key = models.BigAutoField(primary_key=True, db_column="incident_candidate_key")
    import_batch = models.ForeignKey(ImportBatch, on_delete=models.DO_NOTHING, db_column="import_batch_key", related_name="incident_candidates")
    incident_key = models.TextField(db_column="incident_key")
    incident_name = models.TextField(db_column="incident_name")
    raw_year = models.TextField(db_column="raw_year", blank=True, null=True)
    raw_month = models.TextField(db_column="raw_month", blank=True, null=True)
    raw_category = models.TextField(db_column="raw_category", blank=True, null=True)
    raw_calamity = models.TextField(db_column="raw_calamity", blank=True, null=True)
    hazard_key = models.TextField(db_column="hazard_key", blank=True, null=True)
    incident_start_date = models.DateField(db_column="incident_start_date", blank=True, null=True)
    incident_end_date = models.DateField(db_column="incident_end_date", blank=True, null=True)
    source_row_count = models.IntegerField(db_column="source_row_count", default=0)
    status = models.CharField(
        max_length=16,
        db_column="status",
        choices=STATUS_CHOICES,
        default=STATUS_FOR_REVIEW,
    )
    notes = models.TextField(db_column="notes", blank=True, default="")
    created_at = models.DateTimeField(db_column="created_at", auto_now_add=True)
    updated_at = models.DateTimeField(db_column="updated_at", auto_now=True)

    class Meta:
        managed = True
        db_table = "incident_candidate"
        db_table_comment = "Extracted incident candidates awaiting or having completed reviewer confirmation. Replaces the former data/processed/*.csv file-based workflow."
        constraints = [
            models.UniqueConstraint(
                fields=["import_batch", "incident_key"],
                name="uq_incident_candidate_batch_incident_key",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=[IncidentCandidateStatus.FOR_REVIEW, IncidentCandidateStatus.CONFIRMED]),
                name="chk_incident_candidate_status",
            ),
            models.CheckConstraint(
                condition=~models.Q(incident_key=""),
                name="chk_incident_candidate_key_not_blank",
            ),
        ]

    def __str__(self):
        return self.incident_name

class ReportAuditLog(models.Model):
    audit_log_key = models.BigAutoField(primary_key=True)
    action_type = models.CharField(
        max_length=64,
        choices=AuditAction.CHOICES,
        db_comment="Workflow action being audited.",
    )
    action_status = models.CharField(
        max_length=16,
        choices=AuditStatus.CHOICES,
        db_comment="Outcome of the audited workflow action.",
    )
    import_batch_key_snapshot = models.BigIntegerField(
        blank=True,
        null=True,
        db_comment="Import batch key captured at action time; kept as a snapshot so the audit remains even if the batch is later deleted.",
    )
    file_name_snapshot = models.TextField(blank=True, null=True)
    import_status_snapshot = models.CharField(max_length=32, blank=True, null=True)
    validation_status_snapshot = models.CharField(max_length=32, blank=True, null=True)
    message = models.TextField(blank=True, default="")
    metadata = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = True
        db_table = "report_audit_log"
        db_table_comment = "Append-only audit trail for important report import and delete workflow actions."
        indexes = [
            models.Index(fields=["action_type", "action_status"], name="idx_report_audit_action"),
            models.Index(fields=["import_batch_key_snapshot"], name="idx_report_audit_batch"),
            models.Index(fields=["created_at"], name="idx_report_audit_created"),
        ]

    def __str__(self):
        return f"{self.action_type} - {self.action_status} - {self.created_at}"




class TropicalCyclone(models.Model):
    """One named tropical-cyclone occurrence.

    Official DOST-PAGASA catalog records and temporary JMA-derived fallback
    records may exist without a linked disaster incident or agricultural
    damage report. Legacy incident-derived rows are retained separately
    through ``catalog_source``.
    """

    class CatalogSource(models.TextChoices):
        INCIDENT_DERIVED = (
            "incident_derived",
            "Incident-derived record",
        )
        PAGASA_ANNUAL_REPORT = (
            "pagasa_annual_report",
            "DOST-PAGASA annual report",
        )
        PAGASA_PRELIMINARY_REPORT = (
            "pagasa_preliminary_report",
            "DOST-PAGASA preliminary report",
        )
        PAGASA_OPERATIONAL_TRACK = (
            "pagasa_operational_track",
            "DOST-PAGASA operational track",
        )
        JMA_BEST_TRACK_DERIVED = (
            "jma_best_track_derived",
            "JMA best-track derived fallback",
        )

    cyclone_key = models.CharField(
        primary_key=True,
        max_length=100,
        db_comment=(
            "Stable cyclone occurrence key, such as TC_TISOY_2019."
        ),
    )
    cyclone_name = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        db_comment=(
            "Normalized PAGASA local tropical-cyclone name, when assigned."
        ),
    )
    international_name = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        db_comment=(
            "International tropical-cyclone name when supplied by the "
            "official source."
        ),
    )
    occurrence_year = models.PositiveSmallIntegerField(
        db_comment=(
            "Calendar year assigned to the occurrence by its source catalog."
        ),
    )
    start_date = models.DateField(
        blank=True,
        null=True,
        db_comment=(
            "Basin-wide tropical-cyclone development date when supplied by "
            "the official source; null when unknown."
        ),
    )
    end_date = models.DateField(
        blank=True,
        null=True,
        db_comment=(
            "Basin-wide dissipation or post-tropical transition date when "
            "supplied by the official source; null when unknown."
        ),
    )
    first_tracked_within_par_at = models.DateTimeField(
        blank=True,
        null=True,
        db_comment=(
            "UTC start of the cyclone's first continuous passage within "
            "the Philippine Area of Responsibility."
        ),
    )
    last_tracked_within_par_at = models.DateTimeField(
        blank=True,
        null=True,
        db_comment=(
            "UTC end of the cyclone's final continuous passage within "
            "the Philippine Area of Responsibility."
        ),
    )
    peak_intensity = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        db_comment=(
            "Basin-wide peak tropical-cyclone classification stated by "
            "the source."
        ),
    )
    peak_intensity_within_par = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        db_comment=(
            "Peak tropical-cyclone classification reached within the "
            "Philippine Area of Responsibility."
        ),
    )
    catalog_source = models.CharField(
        max_length=32,
        choices=CatalogSource.choices,
        default=CatalogSource.INCIDENT_DERIVED,
        db_comment=(
            "Whether the occurrence came from an official catalog, a "
            "temporary derived fallback, or an agricultural damage-report "
            "incident."
        ),
    )
    source_agency = models.CharField(
        max_length=150,
        blank=True,
        null=True,
        db_comment="Agency responsible for the source occurrence record.",
    )
    source_record_id = models.CharField(
        max_length=150,
        blank=True,
        null=True,
        db_comment=(
            "Stable identifier or annual-report sequence supplied by the "
            "source agency."
        ),
    )
    source_document_title = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        db_comment="Title of the official source document.",
    )
    source_document_url = models.URLField(
        max_length=500,
        blank=True,
        null=True,
        db_comment="Official source or publication URL.",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        display_name = (
            self.cyclone_name
            or self.international_name
            or "Unnamed Tropical Cyclone"
        )
        return f"{display_name} ({self.occurrence_year})"

    class Meta:
        managed = True
        db_table = "tropical_cyclone"
        constraints = [
            models.UniqueConstraint(
                fields=("cyclone_name", "occurrence_year"),
                name="uq_tc_name_year",
            ),
            models.UniqueConstraint(
                fields=("source_agency", "source_record_id"),
                condition=(
                    models.Q(source_agency__isnull=False)
                    & models.Q(source_record_id__isnull=False)
                ),
                name="uq_tc_source_record",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(start_date__isnull=True)
                    | models.Q(end_date__isnull=True)
                    | models.Q(end_date__gte=models.F("start_date"))
                ),
                name="ck_tc_dates_chronological",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(first_tracked_within_par_at__isnull=True)
                    | models.Q(last_tracked_within_par_at__isnull=True)
                    | models.Q(
                        last_tracked_within_par_at__gte=models.F(
                            "first_tracked_within_par_at"
                        )
                    )
                ),
                name="ck_tc_par_dates_chronological",
            ),
        ]
        indexes = [
            models.Index(
                fields=("occurrence_year", "cyclone_name"),
                name="idx_tc_year_name",
            ),
            models.Index(
                fields=("catalog_source", "start_date"),
                name="idx_tc_source_start",
            ),
            models.Index(
                fields=(
                    "catalog_source",
                    "first_tracked_within_par_at",
                ),
                name="idx_tc_source_par_first",
            ),
        ]
        db_table_comment = (
            "Official and incident-derived named tropical-cyclone "
            "occurrences used by hazard analytics."
        )


class TropicalCycloneTrackPoint(models.Model):
    """One archived analyzed tropical-cyclone position."""

    class SourceType(models.TextChoices):
        PAGASA_OPERATIONAL_ANALYSIS = (
            "pagasa_operational_analysis",
            "PAGASA operational analysis",
        )
        PAGASA_WARNING_BEST_TRACK = (
            "pagasa_warning_best_track",
            "PAGASA warning best track",
        )
        PAGASA_PRELIMINARY_BEST_TRACK = (
            "pagasa_preliminary_best_track",
            "PAGASA preliminary best track",
        )
        PAGASA_BEST_TRACK_FINAL = (
            "pagasa_best_track_final",
            "PAGASA finalized best track",
        )
        JMA_BEST_TRACK_FINAL = (
            "jma_best_track_final",
            "JMA finalized best track",
        )

    track_point_key = models.BigAutoField(
        primary_key=True,
    )
    cyclone_key = models.ForeignKey(
        TropicalCyclone,
        on_delete=models.CASCADE,
        related_name="track_points",
        db_column="cyclone_key",
    )
    source_agency = models.CharField(
        max_length=64,
    )
    source_type = models.CharField(
        max_length=40,
        choices=SourceType.choices,
    )
    valid_at = models.DateTimeField(
        db_comment=(
            "UTC validity time of the analyzed "
            "cyclone position."
        ),
    )
    latitude = models.DecimalField(
        max_digits=6,
        decimal_places=3,
    )
    longitude = models.DecimalField(
        max_digits=7,
        decimal_places=3,
    )
    intensity_code = models.CharField(
        max_length=16,
        blank=True,
    )
    source_grade = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
        db_comment=(
            "Raw classification grade supplied by "
            "the source agency."
        ),
    )
    central_pressure_hpa = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
    )
    maximum_wind_kt = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
    )
    source_url = models.URLField(
        max_length=500,
        blank=True,
    )
    collected_at = models.DateTimeField(
        auto_now_add=True,
    )
    updated_at = models.DateTimeField(
        auto_now=True,
    )

    def __str__(self) -> str:
        return (
            f"{self.cyclone_key_id} "
            f"{self.valid_at.isoformat()}"
        )

    class Meta:
        managed = True
        db_table = "tropical_cyclone_track_point"
        ordering = (
            "valid_at",
            "track_point_key",
        )
        constraints = [
            models.UniqueConstraint(
                fields=(
                    "cyclone_key",
                    "source_agency",
                    "source_type",
                    "valid_at",
                ),
                name="uq_tc_track_source_time",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(latitude__gte=-90)
                    & models.Q(latitude__lte=90)
                ),
                name="ck_tc_track_latitude",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(longitude__gte=-180)
                    & models.Q(longitude__lte=180)
                ),
                name="ck_tc_track_longitude",
            ),
        ]
        indexes = [
            models.Index(
                fields=(
                    "cyclone_key",
                    "valid_at",
                ),
                name="idx_tc_track_cyclone_time",
            ),
            models.Index(
                fields=(
                    "source_agency",
                    "source_type",
                    "valid_at",
                ),
                name="idx_tc_track_source_time",
            ),
        ]
        db_table_comment = (
            "Archived operational and finalized "
            "tropical-cyclone coordinates."
        )


class DisasterIncidentTropicalCyclone(models.Model):
    """Associates one reporting incident with its component cyclones.

    A combined calamity report can therefore link to multiple cyclone
    occurrences without duplicating the underlying damage-report rows.
    """

    class AttributionMethod(models.TextChoices):
        DIRECT = "direct", "Single-cyclone incident"
        COMBINED = "combined", "Combined incident"
        MANUAL = "manual", "Manually reviewed"

    incident_cyclone_key = models.BigAutoField(primary_key=True)
    incident_key = models.ForeignKey(
        "DisasterIncident",
        models.CASCADE,
        db_column="incident_key",
        related_name="tropical_cyclone_links",
    )
    cyclone_key = models.ForeignKey(
        TropicalCyclone,
        models.PROTECT,
        db_column="cyclone_key",
        related_name="incident_links",
    )
    attribution_method = models.CharField(
        max_length=16,
        choices=AttributionMethod.choices,
        db_comment=(
            "How the cyclone was attributed to the reporting incident."
        ),
    )
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = True
        db_table = "disaster_incident_tropical_cyclone"
        constraints = [
            models.UniqueConstraint(
                fields=("incident_key", "cyclone_key"),
                name="uq_incident_tc",
            ),
        ]
        db_table_comment = (
            "Reviewed component tropical cyclones associated with each "
            "disaster reporting incident."
        )
