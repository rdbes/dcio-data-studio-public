"""Public renderer settings; deliberately independent of local credentials."""

import os
import secrets
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parents[2]
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY")
if not SECRET_KEY and os.environ.get("VERCEL"):
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be configured for the Vercel public renderer."
    )
SECRET_KEY = SECRET_KEY or secrets.token_hex(32)
DEBUG = False
PROJECT_NAME = "RRDBES"
ALLOWED_HOSTS = [
    host.strip().lower()
    for host in os.environ.get("PUBLIC_ALLOWED_HOSTS", "").split(",")
    if host.strip()
]
for variable in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
    if os.environ.get(variable):
        ALLOWED_HOSTS.append(os.environ[variable].strip().lower())
if not ALLOWED_HOSTS and not os.environ.get("VERCEL"):
    ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]
if not ALLOWED_HOSTS or any(
    "*" in host or host.startswith(".") or "/" in host for host in ALLOWED_HOSTS
):
    raise ImproperlyConfigured("Public deployment requires explicit allowed hostnames.")
LOCAL_MODE = False
PUBLIC_RELEASE_RENDERER = True
PUBLIC_DROUGHT_DATA_FILE = BASE_DIR / "data/drought/current.json"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_PUBLIC_BUCKET = os.environ.get("SUPABASE_PUBLIC_BUCKET", "public-data")
SUPABASE_PUBLIC_PREFIX = os.environ.get("SUPABASE_PUBLIC_PREFIX", "public")
PUBLIC_DATA_SOURCE = os.environ.get("PUBLIC_DATA_SOURCE", "bundled").strip().lower()
SUPABASE_AUTH_REQUIRED = os.environ.get("SUPABASE_AUTH_REQUIRED", "").strip().lower() in {
    "1", "true", "yes", "on",
}
if SUPABASE_AUTH_REQUIRED and not (SUPABASE_URL and SUPABASE_ANON_KEY):
    raise ImproperlyConfigured(
        "SUPABASE_URL and SUPABASE_ANON_KEY are required when Supabase Auth is enabled."
    )
if PUBLIC_DATA_SOURCE == "supabase" and not (
    SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
):
    raise ImproperlyConfigured(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase public data."
    )
LOGIN_URL = "/accounts/login/"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/accounts/login/"
ROOT_URLCONF = "frontend.server.urls"
INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.humanize", "reports",
]
MIDDLEWARE = [
    "frontend.server.middleware.PublicOnlyMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.gzip.GZipMiddleware",
]
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("PUBLIC_CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]
# Keep accepted uploads in memory even above Django's default 2.5 MiB spill
# threshold. Middleware bounds the whole request before multipart parsing.
PUBLIC_MAX_REQUEST_BYTES = 6 * 1024 * 1024
# Shared report forms are imported by the public URL allow-list. Keep their
# validation settings available even though public routes do not accept uploads.
AGRICULTURAL_DROUGHT_MAX_UPLOAD_BYTES = 250 * 1024 * 1024
PAGASA_RAINFALL_CONTEXT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
FILE_UPLOAD_HANDLERS = ["django.core.files.uploadhandler.MemoryFileUploadHandler"]
FILE_UPLOAD_MAX_MEMORY_SIZE = PUBLIC_MAX_REQUEST_BYTES
DATA_UPLOAD_MAX_MEMORY_SIZE = PUBLIC_MAX_REQUEST_BYTES
DATA_UPLOAD_MAX_NUMBER_FILES = 1
DATA_UPLOAD_MAX_NUMBER_FIELDS = 100
DATABASES = {"default": {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": os.environ.get("PUBLIC_SNAPSHOT_DB", "/tmp/rrdbes-public-snapshot.sqlite3"),
    "CONN_MAX_AGE": 60,
}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "Asia/Manila"
LANGUAGE_CODE = "en-us"
STATIC_URL = "/assets/"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"],
    "APP_DIRS": False,
    "OPTIONS": {
        "context_processors": [
            "django.template.context_processors.request",
            "frontend.server.middleware.public_context",
        ],
        "libraries": {
            "batch_tags": "reports.templatetags.batch_tags",
            "filter_tags": "reports.templatetags.filter_tags",
            "humanize": "django.contrib.humanize.templatetags.humanize",
        },
    },
}]
