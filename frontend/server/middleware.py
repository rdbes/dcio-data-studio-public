"""Bounded anonymous requests and security headers for the public renderer."""

from types import SimpleNamespace
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import DisallowedHost
from django.http import HttpResponse, HttpResponseNotAllowed

from reports.deployment_version import deployment_identity


def public_context(request):
    return {
        "LOCAL_MODE": False,
        "PUBLIC_RELEASE_RENDERER": True,
        "is_embedded": request.GET.get("embed") == "1",
        "can_manage_reports": False,
        "can_access_admin_link": False,
        **deployment_identity(),
    }


class PublicOnlyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.reject_unsafe_request(request)
        if response is None:
            request.user = SimpleNamespace(is_authenticated=False, is_staff=False)
            response = self.get_response(request)
        # All executable scripts are local assets. Never authorize script tags
        # by rewriting rendered HTML: that would also authorize injected markup.
        response["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; object-src 'none'; "
            "script-src 'self'; script-src-attr 'none'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://pubfiles.pagasa.dost.gov.ph; "
            "font-src 'self'; connect-src 'self'; frame-src 'self'; "
            "frame-ancestors 'self'; form-action 'self'"
        )
        response["X-Frame-Options"] = "SAMEORIGIN"
        response["X-Content-Type-Options"] = "nosniff"
        response["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        response["Strict-Transport-Security"] = "max-age=31536000"
        response["Cache-Control"] = "no-store"
        return response

    def reject_unsafe_request(self, request):
        try:
            host = request.get_host()
        except DisallowedHost:
            return HttpResponse("Invalid host.", status=400)
        bulletin_upload = (
            request.path.rstrip("/") == "/bulletin-checker"
            and request.method == "POST"
        )
        if request.method not in {"GET", "HEAD", "OPTIONS"} and not bulletin_upload:
            return HttpResponseNotAllowed(["GET", "HEAD"])
        if bulletin_upload:
            # This endpoint has no session or database mutations. Reject browser
            # cross-site submissions before spending resources parsing a CSV.
            origin = request.headers.get("Origin")
            if request.headers.get("Sec-Fetch-Site") == "cross-site":
                return HttpResponse("Cross-site uploads are not allowed.", status=403)
            if origin:
                try:
                    parsed_origin = urlsplit(origin)
                    valid_origin = (
                        parsed_origin.scheme in {"http", "https"}
                        and parsed_origin.netloc.lower() == host.lower()
                        and not parsed_origin.path
                        and not parsed_origin.query
                        and not parsed_origin.fragment
                    )
                except ValueError:
                    valid_origin = False
                if not valid_origin:
                    return HttpResponse("Cross-site uploads are not allowed.", status=403)
            length = request.META.get("CONTENT_LENGTH")
            if not length:
                return HttpResponse("Content-Length is required.", status=411)
            try:
                request_size = int(length)
            except (TypeError, ValueError):
                return HttpResponse("Invalid Content-Length.", status=400)
            if request_size < 0:
                return HttpResponse("Invalid Content-Length.", status=400)
            if request_size > settings.PUBLIC_MAX_REQUEST_BYTES:
                return HttpResponse("Bulletin CSV request is too large.", status=413)
        return None
