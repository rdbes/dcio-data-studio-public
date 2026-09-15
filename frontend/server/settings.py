"""Public renderer settings; deliberately independent of local credentials."""

import os
import secrets
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parents[2]
SECRET_KEY = secrets.token_hex(32)
DEBUG = False
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
ROOT_URLCONF = "frontend.server.urls"
INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.humanize", "reports",
]
MIDDLEWARE = [
    "frontend.server.middleware.PublicOnlyMiddleware",
    "django.middleware.gzip.GZipMiddleware",
]
# Keep accepted uploads in memory even above Django's default 2.5 MiB spill
# threshold. Middleware bounds the whole request before multipart parsing.
PUBLIC_MAX_REQUEST_BYTES = 6 * 1024 * 1024
FILE_UPLOAD_HANDLERS = ["django.core.files.uploadhandler.MemoryFileUploadHandler"]
FILE_UPLOAD_MAX_MEMORY_SIZE = PUBLIC_MAX_REQUEST_BYTES
DATA_UPLOAD_MAX_MEMORY_SIZE = PUBLIC_MAX_REQUEST_BYTES
DATA_UPLOAD_MAX_NUMBER_FILES = 1
DATA_UPLOAD_MAX_NUMBER_FIELDS = 100
DATABASES = {"default": {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": os.environ.get("PUBLIC_SNAPSHOT_DB", "/tmp/dcio-public-snapshot.sqlite3"),
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
