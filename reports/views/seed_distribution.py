"""Read-only 2027DS seed distribution release for the Drought Monitor."""

from __future__ import annotations

import logging
from pathlib import Path

from django.conf import settings
from django.shortcuts import render

from reports.services.public_data import load_public_json

logger = logging.getLogger(__name__)


def _seed_distribution_data_path() -> Path:
    """Resolve the bundled snapshot for the active local or public renderer."""

    if getattr(settings, "PUBLIC_RELEASE_RENDERER", False):
        return Path(settings.BASE_DIR) / "data" / "seed" / "seed-distribution-2027ds.json"
    return Path(settings.BASE_DIR) / "static" / "data" / "seed-distribution-2027ds.json"


def _load_seed_distribution_data() -> dict:
    try:
        payload = load_public_json(
            "modules/seed-distribution-2027ds.json",
            _seed_distribution_data_path(),
        )
    except OSError:
        logger.exception("Unable to load the bundled 2027DS seed distribution release")
        return {}
    return payload if isinstance(payload, dict) else {}


def seed_distribution(request):
    """Render the static seed distribution map and breakdown."""

    return render(
        request,
        "reports/seed_distribution.html",
        {"seed_distribution_data": _load_seed_distribution_data()},
    )
