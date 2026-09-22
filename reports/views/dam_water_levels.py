"""Read-only Dam Water Levels module sourced directly from DOST-PAGASA."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from types import SimpleNamespace

from django.http import HttpResponse, JsonResponse
from django.shortcuts import render

from reports.dam_water_levels_report import (
    build_dam_water_levels_pdf,
    decode_rendered_chart_images,
    decode_rendered_summary_image,
)
from reports.dam_water_levels_source import (
    PAGASA_DAM_PAGE_URL,
    DamWaterLevelError,
    build_live_summary,
    fetch_pagasa_dam_chart,
    fetch_pagasa_dam_page,
    fetch_pagasa_dam_status_image,
    parse_pagasa_dam_water_levels,
)

logger = logging.getLogger(__name__)


def dam_water_levels(request):
    """Render the Data Studio-owned PAGASA dam monitor."""

    return render(request, "reports/dam_water_levels.html")


def dam_water_levels_data(request):
    """Return current PAGASA readings without depending on the sibling app."""

    dam_name = request.GET.get("dam", "").strip()
    try:
        payload = fetch_pagasa_dam_chart(dam_name) if dam_name else build_live_summary()
    except DamWaterLevelError:
        logger.exception("DOST-PAGASA Dam Water Levels request failed.")
        return JsonResponse(
            {"detail": "DOST-PAGASA dam data is currently unavailable."},
            status=502,
        )
    response = JsonResponse(payload)
    response["Cache-Control"] = "no-store"
    response["X-Data-Source"] = "direct-pagasa"
    return response


def _live_dam_report(
    rendered_chart_images: dict[str, bytes] | None = None,
    rendered_summary_image: bytes | None = None,
) -> bytes:
    parsed = parse_pagasa_dam_water_levels(fetch_pagasa_dam_page())
    grouped = defaultdict(list)
    for reading in parsed.readings:
        grouped[reading.dam_name].append(reading)

    dam_rows = []
    for dam_name in sorted(grouped):
        dam_readings = sorted(
            grouped[dam_name],
            key=lambda item: item.observed_at,
            reverse=True,
        )
        dam_rows.append({
            "dam": SimpleNamespace(name=dam_name),
            "current": dam_readings[0],
            "previous": dam_readings[1] if len(dam_readings) > 1 else None,
        })

    chart_payloads = {}
    for row in dam_rows:
        try:
            chart_payloads[row["dam"].name] = fetch_pagasa_dam_chart(row["dam"].name)
        except DamWaterLevelError:
            continue

    try:
        image_content, image_content_type = fetch_pagasa_dam_status_image()
    except DamWaterLevelError:
        image_content, image_content_type = None, "image/gif"

    snapshot = SimpleNamespace(
        source_url=PAGASA_DAM_PAGE_URL,
        source_observed_at=parsed.source_observed_at,
        status_image_content=image_content,
        status_image_content_type=image_content_type,
    )
    return build_dam_water_levels_pdf(
        snapshot=snapshot,
        dam_rows=dam_rows,
        chart_payloads=chart_payloads,
        source_url=PAGASA_DAM_PAGE_URL,
        rendered_chart_images=rendered_chart_images,
        rendered_summary_image=rendered_summary_image,
    )


def dam_water_levels_report(request):
    """Generate the report from direct PAGASA data inside Data Studio."""

    rendered_chart_images = None
    rendered_summary_image = None
    if request.method == "POST":
        try:
            raw_payload = json.loads(request.body or b"{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            raw_payload = {}
        rendered_chart_images = decode_rendered_chart_images(raw_payload.get("charts"))
        rendered_summary_image = decode_rendered_summary_image(raw_payload.get("summary_table"))

    try:
        content = _live_dam_report(rendered_chart_images, rendered_summary_image)
    except DamWaterLevelError:
        logger.exception("DOST-PAGASA Dam Water Levels report request failed.")
        return HttpResponse(
            "DOST-PAGASA dam data is currently unavailable.",
            status=502,
            content_type="text/plain; charset=utf-8",
        )

    response = HttpResponse(content, content_type="application/pdf")
    response["Content-Disposition"] = 'attachment; filename="dam-water-levels-monitoring-report.pdf"'
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
