"""Anonymous, read-only Agricultural Drought page for the public renderer."""

from django.shortcuts import render
from django.views.decorators.gzip import gzip_page

from reports.agricultural_drought.public import (
    build_public_agricultural_drought_context,
)


@gzip_page
def agricultural_drought(request):
    return render(
        request,
        "reports/agricultural_drought.html",
        build_public_agricultural_drought_context(request.GET),
    )
