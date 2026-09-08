"""Report Generation page and stateless Excel download."""

import logging

from django.conf import settings
from django.http import HttpResponse, HttpResponseNotFound
from django.shortcuts import render
from django.views.decorators.http import require_GET

from ..reporting import (
    EXCEL_CONTENT_TYPE,
    build_report_generation_context,
    build_report_workbook,
    build_report_workbook_preview,
)

logger = logging.getLogger(__name__)


def _download_status_cookie_name(request):
    """Return a safe client-visible download status cookie name."""
    token = request.GET.get(
        "download_token",
        "",
    ).strip()

    if not 16 <= len(token) <= 80:
        return ""

    if not all(
        character.isalnum()
        or character in "-_"
        for character in token
    ):
        return ""

    return f"report_download_{token}"


@require_GET
def report_generation(request):
    """Render filters or return the selected Excel workbook."""
    download_status_cookie = (
        _download_status_cookie_name(request)
    )

    if request.GET.get("template") == "incident-upload":
        if getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
            return HttpResponseNotFound()
        from ..reporting import build_incident_upload_template

        result = build_incident_upload_template()
        response = HttpResponse(
            result.content,
            content_type=result.content_type,
        )
        response["Content-Disposition"] = (
            'attachment; filename="'
            f'{result.filename}"'
        )
        response["Cache-Control"] = "private, no-store"
        return response

    if request.GET.get("download") == "1":
        try:
            result = build_report_workbook(
                request
            )
        except Exception as error:
            logger.exception(
                "Public report workbook generation failed: %s",
                error.__class__.__name__,
            )
            if download_status_cookie:
                response = HttpResponse(
                    "Report download failed.",
                    status=500,
                    content_type=(
                        "text/plain; charset=utf-8"
                    ),
                )
                response.set_cookie(
                    download_status_cookie,
                    "error",
                    max_age=120,
                    path="/",
                    samesite="Lax",
                )
                return response

            raise

        response = HttpResponse(
            result.content,
            content_type=EXCEL_CONTENT_TYPE,
        )

        response[
            "Content-Disposition"
        ] = (
            'attachment; filename="'
            f'{result.filename}"'
        )

        response["Cache-Control"] = (
            "private, no-store"
        )

        if download_status_cookie:
            response.set_cookie(
                download_status_cookie,
                "success",
                max_age=120,
                path="/",
                samesite="Lax",
            )

        return response

    context = (
        build_report_generation_context(
            request
        )
    )

    if request.GET.get("preview") == "1":
        context["workbook_preview"] = (
            build_report_workbook_preview(
                request,
                row_limit=10,
            )
        )

    return render(
        request,
        "reports/report_generation.html",
        context,
    )
