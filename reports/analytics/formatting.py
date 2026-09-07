from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

REGION_LABEL_ALIASES = {
    "NATIONAL CAPITAL REGION": "NCR",
    "NATIONAL CAPITAL REGION (NCR)": "NCR",
    "CORDILLERA ADMINISTRATIVE REGION": "CAR",
    "CORDILLERA ADMINISTRATIVE REGION (CAR)": "CAR",
    "REGION I": "Region I",
    "REGION I (ILOCOS REGION)": "Region I",
    "ILOCOS REGION": "Region I",
    "REGION II": "Region II",
    "REGION II (CAGAYAN VALLEY)": "Region II",
    "CAGAYAN VALLEY": "Region II",
    "REGION III": "Region III",
    "REGION III (CENTRAL LUZON)": "Region III",
    "CENTRAL LUZON": "Region III",
    "REGION IV-A": "Region IV-A",
    "REGION IV-A (CALABARZON)": "Region IV-A",
    "CALABARZON": "Region IV-A",
    "REGION IV-B": "MIMAROPA",
    "REGION IV-B (MIMAROPA)": "MIMAROPA",
    "MIMAROPA": "MIMAROPA",
    "MIMAROPA REGION": "MIMAROPA",
    "REGION V": "Region V",
    "REGION V (BICOL REGION)": "Region V",
    "BICOL REGION": "Region V",
    "REGION VI": "Region VI",
    "REGION VI (WESTERN VISAYAS)": "Region VI",
    "WESTERN VISAYAS": "Region VI",
    "REGION VII": "Region VII",
    "REGION VII (CENTRAL VISAYAS)": "Region VII",
    "CENTRAL VISAYAS": "Region VII",
    "REGION VIII": "Region VIII",
    "REGION VIII (EASTERN VISAYAS)": "Region VIII",
    "EASTERN VISAYAS": "Region VIII",
    "REGION IX": "Region IX",
    "REGION IX (ZAMBOANGA PENINSULA)": "Region IX",
    "ZAMBOANGA PENINSULA": "Region IX",
    "REGION X": "Region X",
    "REGION X (NORTHERN MINDANAO)": "Region X",
    "NORTHERN MINDANAO": "Region X",
    "REGION XI": "Region XI",
    "REGION XI (DAVAO REGION)": "Region XI",
    "DAVAO REGION": "Region XI",
    "REGION XII": "Region XII",
    "REGION XII (SOCCSKSARGEN)": "Region XII",
    "SOCCSKSARGEN": "Region XII",
    "REGION XIII": "Caraga",
    "REGION XIII (CARAGA)": "Caraga",
    "CARAGA": "Caraga",
    "NEGROS ISLAND REGION": "NIR",
    "NEGROS ISLAND REGION (NIR)": "NIR",
    "NIR": "NIR",
    "REGION XVIII": "NIR",
    "REGION XVIII (NEGROS ISLAND REGION)": "NIR",
    "BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO": "BARMM",
    "BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO (BARMM)": "BARMM",
    "BARMM": "BARMM",
}


def title_case_label(value: Any) -> str:
    """Title-case UI labels while preserving short all-caps codes."""
    text = " ".join(str(value or "").replace("\xa0", " ").split())
    if not text:
        return ""

    def replace_word(match: re.Match[str]) -> str:
        word = match.group(0)
        if word.isupper() and (len(word) <= 5 or any(char.isdigit() for char in word)):
            return word
        return word[:1].upper() + word[1:].lower()

    return re.sub(r"[A-Za-zÀ-ÖØ-öø-ÿ]+", replace_word, text)


def short_region_label(region_name: Any) -> str:
    """Return concise display label for region names."""
    if not region_name:
        return "Unspecified Region"

    normalized = " ".join(str(region_name).replace("\xa0", " ").split()).upper()

    if normalized in REGION_LABEL_ALIASES:
        return REGION_LABEL_ALIASES[normalized]

    if "MIMAROPA" in normalized:
        return "MIMAROPA"

    if "BANGSAMORO" in normalized or "BARMM" in normalized:
        return "BARMM"

    if "NATIONAL CAPITAL" in normalized or normalized == "NCR":
        return "NCR"

    if "CORDILLERA" in normalized or normalized == "CAR":
        return "CAR"

    if "CARAGA" in normalized:
        return "Caraga"

    if "NEGROS" in normalized or normalized == "NIR":
        return "NIR"

    return str(region_name)


def zero(value: Any) -> Any:
    """Return value or 0 if falsy."""
    return value or 0


def number(value: Any) -> float:
    """Safely convert value to float."""
    return float(value or 0)


def to_decimal(value: Any) -> Decimal:
    """Safely convert value to Decimal."""
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def trim_decimal_text(value: Decimal) -> str:
    """Format Decimal trimming trailing zeros."""
    return f"{value:.2f}".rstrip("0").rstrip(".")


def format_exact_value(value: Any, prefix: str = "", suffix: str = "") -> str:
    """Format numeric value with thousands separator and exact precision."""
    numeric = to_decimal(value)

    if numeric == numeric.to_integral_value():
        formatted = f"{numeric:,.0f}"
    else:
        formatted = f"{numeric:,.2f}"

    return f"{prefix}{formatted}{suffix}"


def format_compact_value(value: Any, prefix: str = "", suffix: str = "") -> str:
    """Format large numbers with compact scale suffixes (K, M, B, T)."""
    numeric = to_decimal(value)
    absolute_value = abs(numeric)

    scale_options = [
        (Decimal("1000000000000"), "T"),
        (Decimal("1000000000"), "B"),
        (Decimal("1000000"), "M"),
        (Decimal("1000"), "K"),
    ]

    for scale, label in scale_options:
        if absolute_value >= scale:
            scaled_value = numeric / scale

            if abs(scaled_value) >= 100:
                compact_value = f"{scaled_value:.0f}"
            elif abs(scaled_value) >= 10:
                compact_value = f"{scaled_value:.1f}"
            else:
                compact_value = f"{scaled_value:.2f}"

            return f"{prefix}{trim_decimal_text(Decimal(compact_value))}{label}{suffix}"

    return format_exact_value(numeric, prefix=prefix, suffix=suffix)


def format_percent_delta(current_value: Any, comparison_value: Any) -> dict[str, str]:
    """Calculate percentage change between current and comparison value."""
    current = to_decimal(current_value)
    comparison = to_decimal(comparison_value)

    if comparison == 0:
        return {"label": "", "direction": "flat"}

    delta = (((current - comparison) / comparison) * Decimal("100")).quantize(
        Decimal("0.01")
    )
    sign = "+" if delta > 0 else ""
    direction = "increase" if delta > 0 else "decrease" if delta < 0 else "flat"
    return {
        "label": f"{sign}{trim_decimal_text(delta)}%",
        "direction": direction,
    }


# Backwards compatibility aliases
_zero = zero
_number = number
_to_decimal = to_decimal
_trim_decimal_text = trim_decimal_text
_format_exact_value = format_exact_value
_format_compact_value = format_compact_value
_format_percent_delta = format_percent_delta
_short_region_label = short_region_label
_title_case_label = title_case_label
