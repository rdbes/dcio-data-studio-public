"""Hazard Studio view boundary.

The hazard implementations remain in ``reports`` during the transition.
These exports make Hazard Studio the canonical route dependency while
preserving the existing compatibility imports.
"""

from reports.views.tropical_cyclone_frequency import tropical_cyclone_frequency
from reports.views.tropical_cyclone_similarity import tropical_cyclone_similarity
from reports.views.tropical_cyclone_tracks import tropical_cyclone_tracks
from reports.views.dam_water_levels import (
    dam_water_levels,
    dam_water_levels_data,
    dam_water_levels_report,
)
from reports.views.climate_data import climate_data, climate_roni
from reports.views.climate_types import climate_types

__all__ = [
    "tropical_cyclone_frequency",
    "tropical_cyclone_similarity",
    "tropical_cyclone_tracks",
    "dam_water_levels",
    "dam_water_levels_data",
    "dam_water_levels_report",
    "climate_data",
    "climate_roni",
    "climate_types",
]
