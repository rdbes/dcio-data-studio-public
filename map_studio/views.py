import logging
import urllib.error
import urllib.request

from django.http import HttpResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET

from reports.authorization import viewer_required

logger = logging.getLogger(__name__)

PAGASA_TRACK_URL = "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/cyclone.dat"
PAGASA_TRACK_MAX_BYTES = 512 * 1024
PAGASA_TRACK_TIMEOUT_SECONDS = 10


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        """Keep the fixed upstream request on the reviewed PAGASA origin."""

        return None


@viewer_required
def home(request):
    """Render the Map Studio workspace directly inside the shared shell."""
    return render(request, "map_studio/home.html")


@require_GET
def public_home(request):
    """Render the read-only public Map Studio workspace."""
    return render(request, "map_studio/home.html")


@viewer_required
def workspace(request):
    """Redirect the retired standalone route to the unified workspace."""
    return redirect("map_studio:home")


def _pagasa_track_response():
    """Return the fixed PAGASA live-track feed through the current origin."""
    source_request = urllib.request.Request(
        PAGASA_TRACK_URL,
        headers={
            "Accept": "text/plain,*/*;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "RRDBESMapStudio/1.0 (+https://www.pagasa.dost.gov.ph/)",
        },
    )
    try:
        opener = urllib.request.build_opener(NoRedirects())
        with opener.open(
            source_request,
            timeout=PAGASA_TRACK_TIMEOUT_SECONDS,
        ) as source_response:
            content = source_response.read(PAGASA_TRACK_MAX_BYTES + 1)
    except (OSError, urllib.error.URLError):
        logger.exception("Unable to fetch the PAGASA live tropical-cyclone track")
        return HttpResponse("PAGASA live track is temporarily unavailable.\n", status=502)

    if len(content) > PAGASA_TRACK_MAX_BYTES:
        logger.warning("PAGASA live tropical-cyclone track exceeded the response limit")
        return HttpResponse("PAGASA live track response is too large.\n", status=502)

    response = HttpResponse(content, content_type="text/plain; charset=utf-8")
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@viewer_required
@require_GET
def pagasa_track(request):
    """Return the live track to authenticated local Map Studio users."""
    return _pagasa_track_response()


@require_GET
def public_pagasa_track(request):
    """Return the fixed live track from the public read-only renderer."""
    return _pagasa_track_response()
