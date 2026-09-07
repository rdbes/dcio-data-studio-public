"""Anonymous read-only requests and a nonce policy for shared templates."""

import re
import secrets
from types import SimpleNamespace

from django.http import HttpResponseNotAllowed


def public_context(request):
    return {
        "LOCAL_MODE": False,
        "PUBLIC_RELEASE_RENDERER": True,
        "is_embedded": request.GET.get("embed") == "1",
        "can_manage_reports": False,
        "can_access_admin_link": False,
    }


class PublicOnlyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            return HttpResponseNotAllowed(["GET", "HEAD"])
        request.user = SimpleNamespace(is_authenticated=False, is_staff=False)
        response = self.get_response(request)
        nonce = secrets.token_urlsafe(24)
        if response.get("Content-Type", "").startswith("text/html"):
            html = response.content.decode(response.charset)
            html = re.sub(r"<script(?=[\s>])", f'<script nonce="{nonce}"', html)
            response.content = html.encode(response.charset)
            response["Content-Length"] = len(response.content)
        response["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; object-src 'none'; "
            f"script-src 'self' 'nonce-{nonce}'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "font-src 'self'; connect-src 'self'; frame-src 'self'; "
            "frame-ancestors 'self'; form-action 'self'"
        )
        response["X-Frame-Options"] = "SAMEORIGIN"
        response["X-Content-Type-Options"] = "nosniff"
        response["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        response["Cache-Control"] = "no-store"
        return response
