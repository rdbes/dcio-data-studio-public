"""Central constants for the reports workflow.

Keep persisted database values here so views, services, pipelines, templates,
and tests do not repeat raw status strings in multiple places.
"""

from django.db import models


class ImportStatus(models.TextChoices):
    """Persisted import_batch.import_status values."""

    UPLOADED = "Uploaded", "Uploaded"
    INCIDENTS_EXTRACTED = "Incidents Extracted", "Incidents Extracted"
    INCIDENTS_CONFIRMED = "Incidents Confirmed", "Incidents Confirmed"
    VALIDATING = "Validating", "Validating"
    VALIDATED = "Validated", "Validated"
    READY_FOR_IMPORT = "Ready for Import", "Ready for Import"
    IMPORTED = "Imported", "Imported"
    FAILED = "Failed", "Failed"
    CANCELLED = "Cancelled", "Cancelled"


VALIDATION_ALLOWED_IMPORT_STATUSES = frozenset(
    {ImportStatus.INCIDENTS_CONFIRMED, ImportStatus.VALIDATED}
)
IMPORT_ALLOWED_IMPORT_STATUSES = frozenset(
    {ImportStatus.VALIDATED, ImportStatus.READY_FOR_IMPORT}
)
IMPORT_CONTROL_ALLOWED_IMPORT_STATUSES = frozenset(
    {
        ImportStatus.VALIDATED,
        ImportStatus.READY_FOR_IMPORT,
        ImportStatus.IMPORTED,
    }
)


class ValidationStatus(models.TextChoices):
    """Persisted import_batch.validation_status values."""

    PENDING = "Pending", "Pending"
    PASSED = "Passed", "Passed"
    PASSED_WITH_WARNINGS = "Passed with Warnings", "Passed with Warnings"
    FAILED = "Failed", "Failed"


PUBLICATION_STATUS_BADGE_CLASSES = {
    "validated": "badge-primary",
    "validation_failed": "badge-danger",
    "published": "badge-success",
    "superseded": "badge-secondary",
}


def publication_status_badge_class(status):
    """Return the shared badge class for a publication status value."""

    value = getattr(status, "value", status)
    normalized = str(value).casefold().replace(" ", "_")
    return PUBLICATION_STATUS_BADGE_CLASSES.get(normalized, "badge-secondary")


IMPORT_ALLOWED_VALIDATION_STATUSES = frozenset(
    {ValidationStatus.PASSED, ValidationStatus.PASSED_WITH_WARNINGS}
)


class MappingIssueStatus(models.TextChoices):
    """Persisted import_mapping_issue.status values."""

    MATCHED = "matched", "Matched"
    MATCHED_WITH_ALIAS = "matched_with_alias", "Matched with alias"
    MATCHED_WITH_FALLBACK = "matched_with_fallback", "Matched with fallback"
    AMBIGUOUS = "ambiguous", "Ambiguous"
    UNMAPPED = "unmapped", "Unmapped"
    MISSING_REQUIRED_VALUE = "missing_required_value", "Missing required value"
    INVALID = "invalid", "Invalid"
    REVIEW_SENSITIVE = "review_sensitive", "Review sensitive"
    SUGGESTED = "suggested", "Suggested"
    RESOLVED = "resolved", "Resolved"
    IGNORED = "ignored", "Ignored"


BLOCKING_MAPPING_ISSUE_STATUSES = frozenset(
    {
        MappingIssueStatus.AMBIGUOUS,
        MappingIssueStatus.UNMAPPED,
        MappingIssueStatus.MISSING_REQUIRED_VALUE,
        MappingIssueStatus.INVALID,
    }
)


class IncidentCandidateStatus:
    """Persisted incident_candidate.status values."""

    FOR_REVIEW = "For Review"
    CONFIRMED = "Confirmed"

    CHOICES = (
        (FOR_REVIEW, FOR_REVIEW),
        (CONFIRMED, CONFIRMED),
    )


class AuditAction:
    """Persisted report_audit_log.action_type values."""

    FINAL_IMPORT = "final_import"
    DELETE_IMPORTED_BATCH = "delete_imported_batch"
    DELETE_UNIMPORTED_BATCH = "delete_unimported_batch"
    ACCEPT_ACTIVE_UPDATE_OVERRIDE = "accept_active_update_override"

    CHOICES = (
        (FINAL_IMPORT, "Final Import"),
        (DELETE_IMPORTED_BATCH, "Delete Imported Batch"),
        (DELETE_UNIMPORTED_BATCH, "Delete Unimported Batch"),
        (ACCEPT_ACTIVE_UPDATE_OVERRIDE, "Accept Active Update Override"),
    )


ACTIVE_UPDATE_OVERRIDE_ISSUE_TYPES = frozenset(
    {
        "Cumulative Damage Decrease",
        "Previously Reported Location / Commodity Missing",
    }
)


class AuditStatus:
    """Persisted report_audit_log.action_status values."""

    SUCCESS = "success"
    FAILURE = "failure"

    CHOICES = (
        (SUCCESS, "Success"),
        (FAILURE, "Failure"),
    )


IMPORT_STATUS_BADGE_CLASSES = {
    ImportStatus.UPLOADED: "badge-info",
    ImportStatus.INCIDENTS_EXTRACTED: "badge-info",
    ImportStatus.INCIDENTS_CONFIRMED: "badge-primary",
    ImportStatus.VALIDATING: "badge-info",
    ImportStatus.VALIDATED: "badge-primary",
    ImportStatus.READY_FOR_IMPORT: "badge-success",
    ImportStatus.IMPORTED: "badge-success",
    ImportStatus.FAILED: "badge-danger",
    ImportStatus.CANCELLED: "badge-danger",
}


VALIDATION_STATUS_BADGE_CLASSES = {
    ValidationStatus.PENDING: "badge-secondary",
    ValidationStatus.PASSED: "badge-success",
    ValidationStatus.PASSED_WITH_WARNINGS: "badge-warning",
    ValidationStatus.FAILED: "badge-danger",
}


WORKFLOW_STATUS_STEPS = {
    ImportStatus.UPLOADED: 1,
    ImportStatus.INCIDENTS_EXTRACTED: 2,
    ImportStatus.INCIDENTS_CONFIRMED: 3,
    ImportStatus.VALIDATING: 3,
    ImportStatus.VALIDATED: 4,
    ImportStatus.READY_FOR_IMPORT: 4,
    ImportStatus.IMPORTED: 4,
}


WORKFLOW_STATUS_LABELS = {
    ImportStatus.UPLOADED: "Staging",
    ImportStatus.INCIDENTS_EXTRACTED: "Incidents",
    ImportStatus.INCIDENTS_CONFIRMED: "Validation",
    ImportStatus.VALIDATING: "Validation",
    ImportStatus.VALIDATED: "Import",
    ImportStatus.READY_FOR_IMPORT: "Import",
    ImportStatus.IMPORTED: "Complete",
}


WORKFLOW_STEP_URL_NAMES = {
    ImportStatus.UPLOADED: "reports:staging_summary",
    ImportStatus.INCIDENTS_EXTRACTED: "reports:incident_review",
    ImportStatus.INCIDENTS_CONFIRMED: "reports:validation_results",
    ImportStatus.VALIDATING: "reports:validation_results",
    ImportStatus.VALIDATED: "reports:import_controls",
    ImportStatus.READY_FOR_IMPORT: "reports:import_controls",
    ImportStatus.IMPORTED: "reports:batch_data",
}
