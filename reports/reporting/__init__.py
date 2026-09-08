"""Public services for DCIO Data Studio report generation."""

from __future__ import annotations

from .dataset import build_report_dataset
from .formatting import (
    EXCEL_CONTENT_TYPE,
    REPORT_PREVIEW_ROW_LIMIT,
)
from .options import (
    CONSOLIDATION_LABELS,
    CONSOLIDATION_OPTIONS,
    METRIC_OPTIONS,
    build_report_generation_context,
)
from .preview import build_report_workbook_preview
from .workbook import (
    ReportWorkbookResult,
    build_report_workbook,
)


def __getattr__(name):
    """Load the upload-only service only when the local workflow needs it."""
    if name in {
        "IncidentUploadTemplateResult",
        "build_incident_upload_template",
    }:
        from .upload_template import (
            IncidentUploadTemplateResult,
            build_incident_upload_template,
        )

        return {
            "IncidentUploadTemplateResult": IncidentUploadTemplateResult,
            "build_incident_upload_template": build_incident_upload_template,
        }[name]
    raise AttributeError(name)

__all__ = [
    "CONSOLIDATION_LABELS",
    "CONSOLIDATION_OPTIONS",
    "EXCEL_CONTENT_TYPE",
    "METRIC_OPTIONS",
    "REPORT_PREVIEW_ROW_LIMIT",
    "ReportWorkbookResult",
    "build_report_dataset",
    "build_report_generation_context",
    "build_incident_upload_template",
    "build_report_workbook",
    "build_report_workbook_preview",
    "IncidentUploadTemplateResult",
]
