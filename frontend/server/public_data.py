"""Authenticated public data endpoints for the Vercel renderer."""

from pathlib import Path

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_safe

from reports.services.public_data import load_public_json


@require_safe
def drought_snapshot(request):
    """Serve the approved drought snapshot through Django auth middleware.

    Supabase is used when configured as the public source; the bundled file is
    retained only as the local/offline fallback and is never a static route.
    """

    path = Path(settings.PUBLIC_DROUGHT_DATA_FILE)
    try:
        payload = load_public_json("modules/drought-current.json", path)
    except OSError:
        return JsonResponse({"detail": "Published drought data unavailable."}, status=503)
    response = JsonResponse(payload, json_dumps_params={"separators": (",", ":")})
    response["Cache-Control"] = "private, no-store"
    return response
