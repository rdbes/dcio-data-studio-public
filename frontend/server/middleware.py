"""Bounded public-renderer requests, authentication, and security headers."""

from types import SimpleNamespace
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from django.core.exceptions import DisallowedHost
from django.http import HttpResponse, HttpResponseNotAllowed
from django.urls import reverse

from reports.deployment_version import deployment_identity
from reports.authorization import can_access_admin_link, is_data_manager, is_viewer

from .supabase_auth import authenticate_request


def public_context(request):
    user = getattr(request, "user", SimpleNamespace(
        is_authenticated=False,
        is_staff=False,
        is_superuser=False,
        groups=SimpleNamespace(filter=lambda **kwargs: SimpleNamespace(exists=lambda: False)),
    ))
    data_studio = SimpleNamespace(
        key="data_studio", name="Data Studio", short_name="Data Studio",
        theme="data-studio", logo_path="img/dala-logo.png",
        home_url_name="reports:dashboard",
    )
    drought_monitor = SimpleNamespace(
        key="drought_monitor", name="Drought Monitor", short_name="Drought Monitor",
        theme="drought-monitor", logo_path="img/drought-monitor-logo.png",
        home_url_name="drought_monitor:agricultural_drought",
    )
    crop_studio = SimpleNamespace(
        key="crop_studio", name="Crop Studio", short_name="Crop Studio",
        theme="crop-studio", logo_path="img/crop-studio-logo.png",
        home_url_name="crop_studio:home",
    )
    hazard_studio = SimpleNamespace(
        key="hazard_studio", name="Weather and Climate Data", short_name="Weather and Climate Data",
        theme="hazard-studio", logo_path="img/hazard-studio-logo.png",
        home_url_name="hazard_studio:home",
    )
    map_studio = SimpleNamespace(
        key="map_studio", name="Map Studio", short_name="Map Studio",
        theme="map-studio", logo_path="img/map-studio-logo.png",
        home_url_name="map_studio:home",
    )
    if request.path.startswith("/drought-monitor/"):
        active_app = drought_monitor
    elif request.path.startswith("/crop-studio/"):
        active_app = crop_studio
    elif request.path.startswith("/hazard-studio/"):
        active_app = hazard_studio
    elif request.path.startswith("/map-studio/"):
        active_app = map_studio
    else:
        active_app = data_studio
    can_manage = is_data_manager(user)
    can_view = is_viewer(user)
    return {
        "LOCAL_MODE": False,
        "project_name": settings.PROJECT_NAME,
        "PUBLIC_RELEASE_RENDERER": True,
        "is_embedded": request.GET.get("embed") == "1",
        "can_view_analytics": can_view,
        "can_manage_reports": can_manage,
        "can_access_admin_link": can_access_admin_link(user),
        "platform_apps": (data_studio, hazard_studio, drought_monitor, crop_studio, map_studio),
        "platform_active_app": active_app,
        **deployment_identity(),
    }


class PublicOnlyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.user = authenticate_request(request) or SimpleNamespace(
            is_authenticated=False,
            is_staff=False,
            is_superuser=False,
            groups=SimpleNamespace(filter=lambda **kwargs: SimpleNamespace(exists=lambda: False)),
        )
        response = self.reject_unsafe_request(request)
        if response is None and self.authentication_required(request):
            response = redirect_to_login(request.get_full_path(), reverse("login"))
        if response is None:
            response = self.get_response(request)
        # All executable scripts are local assets. Never authorize script tags
        # by rewriting rendered HTML: that would also authorize injected markup.
        response["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; object-src 'none'; "
            "script-src 'self'; script-src-attr 'none'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://pubfiles.pagasa.dost.gov.ph; "
            "font-src 'self'; connect-src 'self' https://pubfiles.pagasa.dost.gov.ph; frame-src 'self'; "
            "frame-ancestors 'self'; form-action 'self'"
        )
        response["X-Frame-Options"] = "SAMEORIGIN"
        response["X-Content-Type-Options"] = "nosniff"
        response["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        response["Strict-Transport-Security"] = "max-age=31536000"
        response["Cache-Control"] = "no-store"
        return response

    @staticmethod
    def authentication_required(request):
        if not getattr(settings, "SUPABASE_AUTH_REQUIRED", False):
            return False
        if getattr(request.user, "is_authenticated", False):
            return False
        path = request.path.rstrip("/") or "/"
        if path in {"/accounts/login", "/accounts/logout", "/health"}:
            return False
        if path.startswith(("/assets/", "/static/")):
            return False
        return True

    def reject_unsafe_request(self, request):
        try:
            host = request.get_host()
        except DisallowedHost:
            return HttpResponse("Invalid host.", status=400)
        public_post = (
            request.method == "POST"
            and request.path.rstrip("/") in {
                "/bulletin-checker",
                "/dam-water-levels/report",
                "/accounts/login",
            }
        )
        if request.method not in {"GET", "HEAD", "OPTIONS"} and not public_post:
            return HttpResponseNotAllowed(["GET", "HEAD"])
        if public_post:
            # These endpoints have no session or database mutations. Reject
            # cross-site submissions before parsing CSV or rendered chart data.
            origin = request.headers.get("Origin")
            if request.headers.get("Sec-Fetch-Site") == "cross-site":
                return HttpResponse("Cross-site submissions are not allowed.", status=403)
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
                    return HttpResponse("Cross-site submissions are not allowed.", status=403)
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
                return HttpResponse("Public request is too large.", status=413)
        return None
