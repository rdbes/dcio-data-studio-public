"""Load approved public snapshots from local files or Supabase Storage."""

from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path

from django.conf import settings

from reports.services.supabase_storage import SupabaseStorageClient, SupabaseStorageError


def _storage_client() -> SupabaseStorageClient:
    return SupabaseStorageClient.from_environment(
        getattr(settings, "SUPABASE_PUBLIC_BUCKET", None)
    )


def _storage_object(object_name: str) -> bytes:
    prefix = str(
        getattr(settings, "SUPABASE_PUBLIC_PREFIX", "public")
        or os.environ.get("SUPABASE_PUBLIC_PREFIX", "public")
    ).strip("/")
    if not prefix or not object_name or object_name.startswith("/") or ".." in object_name.split("/"):
        raise SupabaseStorageError("Invalid public snapshot object path.")
    client = _storage_client()
    manifest = client.download_json(f"{prefix}/current/manifest.json")
    active_prefix = str(manifest.get("active_prefix") or "").strip("/")
    if not active_prefix:
        raise SupabaseStorageError("Public snapshot manifest has no active prefix.")
    file_entry = manifest.get("files", {}).get(object_name)
    if not isinstance(file_entry, dict):
        raise SupabaseStorageError("Public snapshot object is not in the active manifest.")
    raw = client.download_bytes(f"{active_prefix}/{object_name}")
    expected_size = file_entry.get("byte_size")
    expected_hash = file_entry.get("sha256")
    if not isinstance(expected_size, int) or len(raw) != expected_size:
        raise SupabaseStorageError("Public snapshot object size does not match its manifest.")
    if not isinstance(expected_hash, str) or hashlib.sha256(raw).hexdigest() != expected_hash:
        raise SupabaseStorageError("Public snapshot object digest does not match its manifest.")
    return raw


def load_public_json(object_name: str, fallback_path: Path) -> dict:
    """Load one public object, failing closed when Supabase is the source."""

    if getattr(settings, "PUBLIC_DATA_SOURCE", "bundled") == "supabase":
        try:
            raw = _storage_object(object_name)
        except SupabaseStorageError as exc:
            raise OSError("Published Supabase data is unavailable.") from exc
    else:
        raw = fallback_path.read_bytes()
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise OSError("Published public data is invalid JSON.") from exc
    if not isinstance(payload, dict):
        raise OSError("Published public data must be a JSON object.")
    return payload
