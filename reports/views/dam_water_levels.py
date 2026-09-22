"""Read-only Dam Water Levels module sourced from the standalone monitor."""

from __future__ import annotations

import json
import logging
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.http import JsonResponse
from django.shortcuts import render

logger = logging.getLogger(__name__)

STANDALONE_DAM_API = "https://dam-water-levels-monitoring.vercel.app/api/dam_water_levels"


def dam_water_levels(request):
    """Render the standalone PAGASA dam snapshot inside Data Studio."""

    return render(request, "reports/dam_water_levels.html")


def dam_water_levels_data(request):
    """Proxy the standalone monitor API so refreshes remain same-origin.

    The page still opens from the packaged snapshot on an ordinary visit. The
    scheduled browser reload and manual refresh add ``refresh`` and reach this
    endpoint, which delegates to the standalone monitor's live/scheduled API
    without requiring browser CORS access to a second origin.
    """

    query: dict[str, str] = {}
    dam_name = request.GET.get("dam", "").strip()
    if dam_name:
        query["dam"] = dam_name
    if "refresh" in request.GET:
        query["refresh"] = request.GET.get("refresh", "1") or "1"
    source_url = f"{STANDALONE_DAM_API}?{urlencode(query)}" if query else STANDALONE_DAM_API
    try:
        source_request = Request(
            source_url,
            headers={
                "Accept": "application/json",
                "User-Agent": "DCIO Data Studio Dam Water Levels",
            },
        )
        with urlopen(source_request, timeout=12) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        logger.exception("Standalone Dam Water Levels API request failed.")
        return JsonResponse(
            {"detail": "DOST-PAGASA dam data is currently unavailable."},
            status=502,
        )
    if not isinstance(payload, dict):
        logger.error("Standalone Dam Water Levels API returned a non-object payload.")
        return JsonResponse(
            {"detail": "DOST-PAGASA dam data is currently unavailable."},
            status=502,
        )
    response = JsonResponse(payload)
    response["Cache-Control"] = "no-store"
    response["X-Data-Source"] = "standalone-dam-water-levels"
    return response
