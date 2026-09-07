"""Vercel WSGI entry point backed only by the packaged public JSON release."""

import os

import django
from django.core.wsgi import get_wsgi_application


def create_application():
    os.environ["DJANGO_SETTINGS_MODULE"] = "frontend.server.settings"
    django.setup()
    from frontend.server.snapshot import initialize_snapshot

    initialize_snapshot()
    return get_wsgi_application()


app = create_application()
