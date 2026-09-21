"""Small, user-visible deployment identity shared by local and public modes."""

from __future__ import annotations

import json
import logging
import os
import subprocess
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.db.models import Max
from django.utils import timezone

logger = logging.getLogger(__name__)


# Semantic version for the application interface and workflow. Keep this
# separate from the source revision and data-release version shown beside it.
APP_VERSION = "1.0.0"


def _short_revision(value: object) -> str:
    revision = str(value or "").strip()
    return revision[:12] if revision else "unknown"


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


@lru_cache(maxsize=1)
def _local_revision(base_dir: str) -> tuple[str, bool]:
    configured = os.environ.get("APP_SOURCE_REVISION")
    if configured:
        return _short_revision(configured), False

    root = Path(base_dir)
    try:
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown", False
    return _short_revision(revision), bool(dirty)


def _latest_local_data_update() -> datetime | None:
    """Return the newest import update timestamp from the local database."""
    try:
        from reports.models import ImportBatch

        return ImportBatch.objects.aggregate(
            latest=Max("updated_at")
        )["latest"]
    except Exception:
        logger.debug("Unable to read local database freshness.", exc_info=True)
        return None


def _local_data_is_newer_than_release(
    release: dict, latest_update: datetime | None
) -> bool:
    """Flag local database changes that are newer than the exported release."""
    generated_at = str(release.get("generated_at") or "").strip()
    if not generated_at or latest_update is None:
        return False
    try:
        generated_timestamp = datetime.fromisoformat(generated_at)
    except (TypeError, ValueError):
        return False
    if generated_timestamp.tzinfo is None and latest_update.tzinfo is not None:
        generated_timestamp = generated_timestamp.replace(tzinfo=latest_update.tzinfo)
    return latest_update > generated_timestamp


def deployment_identity() -> dict[str, object]:
    """Return the stable labels rendered in the sidebar footer."""
    public = bool(getattr(settings, "PUBLIC_RELEASE_RENDERER", False))
    base_dir = Path(settings.BASE_DIR)

    if public:
        deployment = _read_json(base_dir / "deployment-manifest.json")
        release = _read_json(base_dir / "data" / "releases" / "current.json")
        revision = _short_revision(deployment.get("source_revision"))
        data_version = str(release.get("release_version") or "unknown")
        environment = "Vercel public deployment"
        is_dirty = False
        dirty_reason = ""
    else:
        revision, code_is_dirty = _local_revision(str(base_dir))
        configured_data_version = os.environ.get("APP_DATA_VERSION")
        release = _read_json(
            base_dir / "public_release" / "data" / "releases" / "current.json"
        )
        data_version = str(
            configured_data_version
            or release.get("release_version")
            or "local-db"
        )
        environment = "Local Django deployment"
        latest_update = _latest_local_data_update()
        if latest_update:
            data_version = timezone.localtime(latest_update).date().isoformat()
        data_is_dirty = _local_data_is_newer_than_release(release, latest_update)
        dirty_reasons = []
        if code_is_dirty:
            dirty_reasons.append("uncommitted local code changes")
        if data_is_dirty:
            dirty_reasons.append("local database is newer than exported release")
        is_dirty = bool(dirty_reasons)
        dirty_reason = "; ".join(dirty_reasons)

    return {
        "app_version": APP_VERSION,
        "deployment_code_version": revision,
        "deployment_data_version": data_version,
        "deployment_exported_data_version": str(
            release.get("release_version") or data_version
        ),
        "deployment_environment": environment,
        "deployment_is_dirty": is_dirty,
        "deployment_dirty_reason": dirty_reason,
    }
