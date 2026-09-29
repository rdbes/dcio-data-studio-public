"""Read-only municipality-level susceptible rice area release."""

from __future__ import annotations

import logging
from pathlib import Path

from django.conf import settings
from django.shortcuts import render

from reports.services.public_data import load_public_json

logger = logging.getLogger(__name__)


def _sra_drought_data_path() -> Path:
    if getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
        return Path(settings.BASE_DIR) / "data" / "sra" / "sra-drought-2026-2027.json"
    return Path(settings.BASE_DIR) / "static" / "data" / "sra-drought-2026-2027.json"


def _load_sra_drought_data() -> dict:
    try:
        payload = load_public_json(
            "modules/sra-drought-2026-2027.json",
            _sra_drought_data_path(),
        )
    except OSError:
        logger.exception("Unable to load the susceptible rice area release")
        return {}
    return payload if isinstance(payload, dict) else {}


def susceptible_rice_areas(request):
    """Render municipality-level susceptible rice areas and classifications."""

    return render(
        request,
        "reports/seed_distribution.html",
        {"sra_drought": True, "seed_distribution_data": _load_sra_drought_data()},
    )
