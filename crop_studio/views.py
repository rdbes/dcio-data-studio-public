"""Crop Studio view boundary.

The implementation still lives in ``reports`` while the module is migrated.
Keeping the public symbol here gives local and public Crop Studio routes a
stable owner without breaking legacy ``reports.views`` imports or tests.
"""

from reports.views.crop_production import crop_production
from reports.views.damage_matrix import damage_matrix

__all__ = ["crop_production", "damage_matrix"]
