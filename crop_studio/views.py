"""Crop Studio view boundary.

The implementation still lives in ``reports`` while the module is migrated.
Keeping the public symbol here gives local and public Crop Studio routes a
stable owner without breaking legacy ``reports.views`` imports or tests.
"""

from reports.views.crop_production import crop_production


def damage_matrix(request):
    """Render the private Damage Matrix without importing it into public code."""

    from reports.views.damage_matrix import damage_matrix as render_damage_matrix

    return render_damage_matrix(request)

__all__ = ["crop_production", "damage_matrix"]
