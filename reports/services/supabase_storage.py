"""Minimal Supabase Storage client used by the local publisher.

This module intentionally uses the standard library so the publishing command
does not add a large SDK to the Vercel function bundle.  The service-role key
must only be used from the local publishing environment.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


class SupabaseStorageError(RuntimeError):
    """Raised when a Supabase Storage request cannot be completed."""


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SupabaseStorageError(f"{name} must be configured.")
    return value


@dataclass(frozen=True)
class SupabaseStorageClient:
    base_url: str
    service_role_key: str
    bucket: str

    @classmethod
    def from_environment(cls, bucket: str | None = None):
        return cls(
            base_url=_required_env("SUPABASE_URL").rstrip("/"),
            service_role_key=_required_env("SUPABASE_SERVICE_ROLE_KEY"),
            bucket=(bucket or os.environ.get("SUPABASE_PUBLIC_BUCKET", "public-data")).strip(),
        )

    def _url(self, object_path: str) -> str:
        segments = [segment for segment in object_path.strip("/").split("/") if segment]
        if not segments or any(segment in {".", ".."} for segment in segments):
            raise SupabaseStorageError("Storage object paths must be relative and safe.")
        return "/".join(
            (
                self.base_url,
                "storage",
                "v1",
                "object",
                quote(self.bucket, safe=""),
                "/".join(quote(segment, safe="") for segment in segments),
            )
        )

    def request(self, method: str, object_path: str, *, body: bytes | None = None, content_type: str = "application/octet-stream") -> bytes:
        request = Request(
            self._url(object_path),
            data=body,
            method=method,
            headers={
                "Authorization": f"Bearer {self.service_role_key}",
                "apikey": self.service_role_key,
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise SupabaseStorageError(
                f"Supabase Storage {method} failed for {object_path}."
            ) from exc

    def upload_bytes(self, object_path: str, body: bytes, *, content_type: str) -> None:
        self.request("POST", object_path, body=body, content_type=content_type)

    def upload_json(self, object_path: str, payload: dict) -> None:
        self.upload_bytes(
            object_path,
            json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
            content_type="application/json",
        )

    def download_bytes(self, object_path: str) -> bytes:
        return self.request("GET", object_path)

    def download_json(self, object_path: str) -> dict:
        try:
            payload = json.loads(self.download_bytes(object_path).decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise SupabaseStorageError(
                f"Supabase Storage returned invalid JSON for {object_path}."
            ) from exc
        if not isinstance(payload, dict):
            raise SupabaseStorageError(
                f"Supabase Storage returned an invalid object for {object_path}."
            )
        return payload
