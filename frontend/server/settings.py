"""Public renderer settings; deliberately independent of local credentials."""

import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
SECRET_KEY = secrets.token_hex(32)
DEBUG = False
ALLOWED_HOSTS = ["*"]
LOCAL_MODE = False
PUBLIC_RELEASE_RENDERER = True
ROOT_URLCONF = "frontend.server.urls"
INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.humanize", "reports",
]
MIDDLEWARE = [
    "django.middleware.gzip.GZipMiddleware",
    "frontend.server.middleware.PublicOnlyMiddleware",
]
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
