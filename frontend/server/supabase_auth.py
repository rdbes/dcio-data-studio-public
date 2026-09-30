"""Small server-side Supabase Auth adapter for the public renderer.

The public renderer deliberately does not use the local Django user database.
Supabase is the identity provider for a Vercel deployment.  The access token
stays in an HttpOnly cookie and is checked against Supabase's Auth API before a
request is allowed through.  Role claims come from ``app_metadata`` so a user
cannot promote themselves through editable profile metadata.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from http import HTTPStatus
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from django import forms
from django.conf import settings
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme


TOKEN_COOKIE_NAME = "rrdbes_supabase_access_token"


class _GroupQuery:
    def __init__(self, names: set[str]):
        self._names = names

    def exists(self) -> bool:
        return bool(self._names)


class _Groups:
    def __init__(self, names: set[str]):
        self._names = names

    def filter(self, *, name: str):
        return _GroupQuery({name} if name in self._names else set())


@dataclass(frozen=True)
class SupabaseUser:
    """Django-compatible identity used by the public renderer."""

    id: str
    email: str
    role: str
    groups: _Groups
    is_staff: bool = False
    is_superuser: bool = False
    is_active: bool = True
    is_authenticated: bool = True

    def get_username(self) -> str:
        return self.email or self.id

    def get_email(self) -> str:
        return self.email

    def get_full_name(self) -> str:
        return self.email or self.id

    def __str__(self) -> str:
        return self.get_username()


class SupabaseLoginForm(forms.Form):
    username = forms.CharField(max_length=320)
    password = forms.CharField(widget=forms.PasswordInput, max_length=1024)


def _base_url() -> str:
    return str(getattr(settings, "SUPABASE_URL", "") or "").rstrip("/")


def _anon_key() -> str:
    return str(getattr(settings, "SUPABASE_ANON_KEY", "") or "")


def _request_json(method: str, path: str, *, token: str = "", payload=None):
    base = _base_url()
    key = _anon_key()
    if not base or not key:
        return None
    body = None
    headers = {
        "Accept": "application/json",
        "apikey": key,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = UrlRequest(
        f"{base}{path}",
        data=body,
        headers=headers,
        method=method,
    )
    try:
        with urlopen(request, timeout=8) as response:
            if response.status < HTTPStatus.OK or response.status >= HTTPStatus.MULTIPLE_CHOICES:
                return None
            raw = response.read()
    except (HTTPError, URLError, TimeoutError, OSError):
        return None
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _normalise_role(value) -> str:
    aliases = {
        "admin": "Administrator",
        "administrator": "Administrator",
        "data_manager": "Data Manager",
        "data-manager": "Data Manager",
        "data manager": "Data Manager",
        "analyst": "Analyst",
        "reviewer": "Reviewer",
        "viewer": "Viewer",
    }
    return aliases.get(str(value or "").strip().lower(), "Viewer")


def _user_from_payload(payload: dict) -> SupabaseUser | None:
    user_id = str(payload.get("id") or "").strip()
    if not user_id:
        return None
    app_metadata = payload.get("app_metadata")
    app_metadata = app_metadata if isinstance(app_metadata, dict) else {}
    raw_roles = app_metadata.get("roles")
    if isinstance(raw_roles, str):
        raw_roles = [raw_roles]
    role_names = {
        _normalise_role(role)
        for role in (raw_roles if isinstance(raw_roles, list) else [])
    }
    role = _normalise_role(app_metadata.get("role") or next(iter(role_names), "Viewer"))
    role_names.add(role)
    if role == "Administrator":
        role_names.update({"Data Manager", "Viewer"})
    elif role in {"Data Manager", "Reviewer", "Analyst"}:
        role_names.add("Viewer")
    return SupabaseUser(
        id=user_id,
        email=str(payload.get("email") or "").strip(),
        role=role,
        groups=_Groups(role_names),
        is_staff=role in {"Administrator", "Data Manager"},
        is_superuser=role == "Administrator",
    )


def authenticate_request(request) -> SupabaseUser | None:
    """Resolve the request's bearer/cookie token through Supabase Auth."""

    token = request.headers.get("Authorization", "")
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    else:
        token = request.COOKIES.get(TOKEN_COOKIE_NAME, "").strip()
    if not token:
        return None
    payload = _request_json("GET", "/auth/v1/user", token=token)
    return _user_from_payload(payload) if payload else None


def authenticate_credentials(username: str, password: str) -> dict | None:
    """Exchange an email/password pair for a Supabase session."""

    encoded = urlencode({"grant_type": "password"})
    return _request_json(
        "POST",
        f"/auth/v1/token?{encoded}",
        payload={"email": username, "password": password},
    )


def safe_next_url(request, candidate: str | None) -> str:
    if candidate and url_has_allowed_host_and_scheme(
        candidate,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return candidate
    return reverse("reports:dashboard")


def attach_session_cookie(response, session: dict):
    token = str(session.get("access_token") or "")
    if not token:
        return response
    max_age = session.get("expires_in")
    try:
        max_age = max(60, int(max_age))
    except (TypeError, ValueError):
        max_age = 3600
    response.set_cookie(
        TOKEN_COOKIE_NAME,
        token,
        max_age=max_age,
        httponly=True,
        secure=bool(getattr(settings, "SESSION_COOKIE_SECURE", True)),
        samesite="Lax",
        path="/",
    )
    return response


def clear_session_cookie(response):
    response.delete_cookie(TOKEN_COOKIE_NAME, path="/")
    return response
