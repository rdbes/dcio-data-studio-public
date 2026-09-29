"""Damage Matrix chart module."""

from django.shortcuts import render

from reports.damage_matrix import build_damage_matrix_payload


def damage_matrix(request):
    """Render the read-only chart view derived from the 2021 damage matrix."""

    return render(
        request,
        "reports/damage_matrix.html",
        {"damage_matrix_data": build_damage_matrix_payload()},
    )
