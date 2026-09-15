"""Small, user-visible deployment identity shared by local and public modes."""

from __future__ import annotations

import json
import os
import subprocess
from functools import lru_cache
from pathlib import Path

from django.conf import settings


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
def _local_revision(base_dir: str) -> str:
    configured = os.environ.get("APP_SOURCE_REVISION")
    if configured:
        return _short_revision(configured)

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
        return "unknown"
    return f"{_short_revision(revision)}{'+dirty' if dirty else ''}"


@lru_cache(maxsize=1)
def deployment_identity() -> dict[str, str]:
    """Return the stable labels rendered in the sidebar footer."""
    public = bool(getattr(settings, "PUBLIC_RELEASE_RENDERER", False))
    base_dir = Path(settings.BASE_DIR)

    if public:
        deployment = _read_json(base_dir / "deployment-manifest.json")
        release = _read_json(base_dir / "data" / "releases" / "current.json")
        revision = _short_revision(deployment.get("source_revision"))
        data_version = str(release.get("release_version") or "unknown")
        environment = "Vercel public deployment"
    else:
        revision = _local_revision(str(base_dir))
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

    return {
        "app_version": APP_VERSION,
        "deployment_code_version": revision,
        "deployment_data_version": data_version,
        "deployment_environment": environment,
    }
