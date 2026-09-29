"""Program area map and location breakdown for Drought Monitor."""

import json
import logging
from pathlib import Path

from django.conf import settings
from django.shortcuts import render

from reports.services.public_data import load_public_json

logger = logging.getLogger(__name__)


def program_areas(request):
    directory = "data/program" if getattr(settings, "PUBLIC_RELEASE_RENDERER", False) else "static/data"
    try:
        payload = load_public_json(
            "modules/program-areas.json",
            Path(settings.BASE_DIR) / directory / "program-areas.json",
        )
    except OSError:
        logger.exception("Unable to load program areas")
        payload = {}
    return render(request, "reports/seed_distribution.html", {
        "program_areas": True,
        "seed_distribution_data": payload,
    })
