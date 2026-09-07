"""Shared ordering helpers for Philippine administrative regions."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

# Numbered regions follow administrative sequence. NCR and BARMM are
# deliberately placed at the bottom of region selectors and summaries.
_REGION_RANKS = {
    "CAR": 0,
    "REGION I": 10,
    "REGION II": 20,
    "REGION III": 30,
    "REGION IV-A": 40,
    "MIMAROPA": 45,
    "REGION V": 50,
    "REGION VI": 60,
    "NIR": 65,
    "REGION VII": 70,
    "REGION VIII": 80,
    "REGION IX": 90,
    "REGION X": 100,
    "REGION XI": 110,
    "REGION XII": 120,
    "CARAGA": 130,
    "NCR": 900,
    "BARMM": 910,
}

_REGION_NUMBER_PATTERN = re.compile(
    r"\bREGION\s+"
    r"(IV-A|IV-B|XVIII|XIII|XII|XI|IX|VIII|VII|VI|IV|III|II|I|X|V)"
    r"\b"
)

_NUMBERED_REGION_ALIASES = {
    "I": "REGION I",
    "II": "REGION II",
    "III": "REGION III",
    "IV": "REGION IV-A",
    "IV-A": "REGION IV-A",
    "IV-B": "MIMAROPA",
    "V": "REGION V",
    "VI": "REGION VI",
    "VII": "REGION VII",
    "VIII": "REGION VIII",
    "IX": "REGION IX",
    "X": "REGION X",
    "XI": "REGION XI",
    "XII": "REGION XII",
    "XIII": "CARAGA",
    "XVIII": "NIR",
}

_NAMED_REGION_ALIASES = (
    ("NATIONAL CAPITAL", "NCR"),
    ("NCR", "NCR"),
    ("CORDILLERA", "CAR"),
    ("MIMAROPA", "MIMAROPA"),
    ("CALABARZON", "REGION IV-A"),
    ("ILOCOS REGION", "REGION I"),
    ("CAGAYAN VALLEY", "REGION II"),
    ("CENTRAL LUZON", "REGION III"),
    ("BICOL REGION", "REGION V"),
    ("WESTERN VISAYAS", "REGION VI"),
    ("NEGROS ISLAND", "NIR"),
    ("CENTRAL VISAYAS", "REGION VII"),
    ("EASTERN VISAYAS", "REGION VIII"),
    ("ZAMBOANGA PENINSULA", "REGION IX"),
    ("NORTHERN MINDANAO", "REGION X"),
    ("DAVAO REGION", "REGION XI"),
    ("SOCCSKSARGEN", "REGION XII"),
    ("CARAGA", "CARAGA"),
    ("BANGSAMORO", "BARMM"),
    ("BARMM", "BARMM"),
    ("AUTONOMOUS REGION IN MUSLIM MINDANAO", "BARMM"),
)


def _normalized_region_text(region_name: Any) -> str:
    """Return a stable uppercase value for matching and fallback sorting."""
    return " ".join(
        str(region_name or "")
        .replace("\xa0", " ")
        .replace("–", "-")
        .replace("—", "-")
        .split()
    ).upper()


def canonical_region_order_key(region_name: Any) -> str:
    """Resolve common PSGC and display-name variants to one ordering key."""
    normalized = _normalized_region_text(region_name)

    if not normalized:
        return ""

    # Resolve named/special regions before numbered-region matching.
    for fragment, canonical_name in _NAMED_REGION_ALIASES:
        if fragment in normalized:
            return canonical_name

    numbered_match = _REGION_NUMBER_PATTERN.search(normalized)
    if numbered_match:
        return _NUMBERED_REGION_ALIASES[numbered_match.group(1)]

    if normalized in {"CAR", "NIR"}:
        return normalized

    return normalized


def region_sort_key(region_name: Any) -> tuple[int, str]:
    """Sort regions administratively, with unknown names before NCR/BARMM."""
    canonical_name = canonical_region_order_key(region_name)
    normalized = _normalized_region_text(region_name)

    return (
        _REGION_RANKS.get(canonical_name, 800),
        normalized.casefold(),
    )


def short_region_label(region_name: Any) -> str:
    """Return a compact region label while preserving unknown names."""
    if not region_name:
        return "Unspecified Region"

    canonical_name = canonical_region_order_key(region_name)
    if canonical_name not in _REGION_RANKS:
        return str(region_name)

    if canonical_name.startswith("REGION "):
        return f"Region {canonical_name.removeprefix('REGION ')}"

    if canonical_name == "CARAGA":
        return "Caraga"

    return canonical_name


def sort_region_names(region_names: Iterable[Any]) -> list[Any]:
    """Return region values using the shared administrative sequence."""
    return sorted(region_names, key=region_sort_key)
