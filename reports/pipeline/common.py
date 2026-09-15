"""Shared parsing, mapping, and matching rules for report ingestion."""

from __future__ import annotations

import calendar
import json
import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from psycopg import sql

NUMERIC_TOLERANCE = Decimal("0.01")

EXPECTED_INCIDENT_COUNTS = {
    2025: 39,
}

CONTEXT_HEADERS = {
    "year": "raw_year",
    "region": "raw_region",
    "province": "raw_province",
    "psgc_key": "raw_psgc_key",
    "category": "raw_category",
    "calamity": "raw_calamity",
    "month": "raw_month",
}

# Accept the source-system spelling as a backwards-compatible alias, while
# keeping one canonical staging field and one template label.
CONTEXT_HEADER_ALIASES = {
    "psgc_code": "raw_psgc_key",
}

PSGC_KEY_PATTERN = re.compile(r"^PH\d{10}$")


def normalize_psgc_key(value: object) -> str:
    """Normalize an uploaded PSGC relationship key without changing digits."""
    return "" if value is None else str(value).strip().upper()


def psgc_key_format_error(value: object) -> str | None:
    """Return a user-safe format error for an optional PSGC key value."""
    normalized = normalize_psgc_key(value)
    if not normalized or PSGC_KEY_PATTERN.fullmatch(normalized):
        return None
    return (
        "PSGC KEY must be PH followed by exactly 10 digits "
        "(for example, PH0102800000)."
    )

CATEGORY_REFERENCE_ALIASES = {
    "plant pest and diseases": "Plant Pest and Disease",
    "other weather system": "Other Weather System",
    "other weather systems": "Other Weather System",
    "weather systems": "Other Weather System",
}

GENERIC_HAZARD_CONTEXT_TERMS = {"others", "unknown"}

REGION_REFERENCE_ALIASES = {
    "barmm": "Bangsamoro Autonomous Region In Muslim Mindanao (BARMM)",
    "car": "Cordillera Administrative Region (CAR)",
    "ncr": "National Capital Region (NCR)",
    "nir": "Negros Island Region (NIR)",
    "rfo i": "Region I (Ilocos Region)",
    "rfo ii": "Region II (Cagayan Valley)",
    "rfo iii": "Region III (Central Luzon)",
    "rfo iva": "Region IV-A (CALABARZON)",
    "rfo ivb": "MIMAROPA Region",
    "rfo v": "Region V (Bicol Region)",
    "rfo vi": "Region VI (Western Visayas)",
    "rfo vii": "Region VII (Central Visayas)",
    "rfo viii": "Region VIII (Eastern Visayas)",
    "rfo ix": "Region IX (Zamboanga Peninsula)",
    "rfo x": "Region X (Northern Mindanao)",
    "rfo xi": "Region XI (Davao Region)",
    "rfo xii": "Region XII (SOCCSKSARGEN)",
    "rfo xiii": "Region XIII (Caraga)",
}

# Approved source-specific location corrections for the 2025 historical file.
# Keys preserve the raw region/province context so broad name replacement is
# not applied to unrelated sources.
LOCATION_REFERENCE_ALIASES = {
    ("barmm", "maguindanao"): "Maguindanao del Norte",
}

# Each source group maps raw fields to the final damage_report metric columns.
COMMODITY_GROUPS = {
    "RICE": {
        "commodity_key": "CMD_CROPS_RICE",
        "metrics": {
            "affected_farmers_fisherfolk_count": "rice_nof",
            "area_totally_damaged_ha": "rice_aa_td",
            "area_partially_damaged_ha": "rice_aa_pd",
            "area_affected_ha": "rice_aa_tot",
            "production_loss_mt": "rice_pl_vol",
            "value_loss_php": "rice_pl_val",
        },
    },
    "Y_CORN": {
        "commodity_key": "CMD_CROPS_CORN_YELLOW",
        "metrics": {
            "affected_farmers_fisherfolk_count": "y_corn_nof",
            "area_totally_damaged_ha": "y_corn_aa_td",
            "area_partially_damaged_ha": "y_corn_aa_pd",
            "area_affected_ha": "y_corn_aa_tot",
            "production_loss_mt": "y_corn_pl_vol",
            "value_loss_php": "y_corn_pl_val",
        },
    },
    "W_CORN": {
        "commodity_key": "CMD_CROPS_CORN_WHITE",
        "metrics": {
            "affected_farmers_fisherfolk_count": "w_corn_nof",
            "area_totally_damaged_ha": "w_corn_aa_td",
            "area_partially_damaged_ha": "w_corn_aa_pd",
            "area_affected_ha": "w_corn_aa_tot",
            "production_loss_mt": "w_corn_pl_vol",
            "value_loss_php": "w_corn_pl_val",
        },
    },
    "CASS": {
        "commodity_key": "CMD_CROPS_CASSAVA",
        "metrics": {
            "affected_farmers_fisherfolk_count": "cass_nof",
            "area_totally_damaged_ha": "cass_aa_td",
            "area_partially_damaged_ha": "cass_aa_pd",
            "area_affected_ha": "cass_aa_tot",
            "production_loss_mt": "cass_pl_vol",
            "value_loss_php": "cass_pl_val",
        },
    },
    "VEG": {
        "commodity_key": "CMD_CROPS_HVC_VEGETABLES",
        "metrics": {
            "affected_farmers_fisherfolk_count": "veg_nof",
            "area_totally_damaged_ha": "veg_aa_td",
            "area_partially_damaged_ha": "veg_aa_pd",
            "area_affected_ha": "veg_aa_tot",
            "production_loss_mt": "veg_pl_vol",
            "value_loss_php": "veg_pl_val",
        },
    },
    "FRU": {
        "commodity_key": "CMD_CROPS_HVC_FRUITS",
        "metrics": {
            "affected_farmers_fisherfolk_count": "fru_nof",
            "area_totally_damaged_ha": "fru_aa_td",
            "area_partially_damaged_ha": "fru_aa_pd",
            "area_affected_ha": "fru_aa_tot",
            "production_loss_mt": "fru_pl_vol",
            "value_loss_php": "fru_pl_val",
        },
    },
    "MANGO": {
        "commodity_key": "CMD_CROPS_HVC_MANGO",
        "metrics": {
            "affected_farmers_fisherfolk_count": "mango_nof",
            "area_totally_damaged_ha": "mango_aa_td",
            "area_partially_damaged_ha": "mango_aa_pd",
            "area_affected_ha": "mango_aa_tot",
            "production_loss_mt": "mango_pl_vol",
            "value_loss_php": "mango_pl_val",
        },
    },
    "BNNA": {
        "commodity_key": "CMD_CROPS_HVC_BANANA",
        "metrics": {
            "affected_farmers_fisherfolk_count": "bnna_nof",
            "area_totally_damaged_ha": "bnna_aa_td",
            "area_partially_damaged_ha": "bnna_aa_pd",
            "area_affected_ha": "bnna_aa_tot",
            "production_loss_mt": "bnna_pl_vol",
            "value_loss_php": "bnna_pl_val",
        },
    },
    "COMM": {
        "commodity_key": "CMD_CROPS_HVC_PLANTATION",
        "metrics": {
            "affected_farmers_fisherfolk_count": "comm_nof",
            "area_totally_damaged_ha": "comm_aa_td",
            "area_partially_damaged_ha": "comm_aa_pd",
            "area_affected_ha": "comm_aa_tot",
            "production_loss_mt": "comm_pl_vol",
            "value_loss_php": "comm_pl_val",
        },
    },
    "ROOT": {
        "commodity_key": "CMD_CROPS_HVC_ROOT",
        "metrics": {
            "affected_farmers_fisherfolk_count": "root_nof",
            "area_totally_damaged_ha": "root_aa_td",
            "area_partially_damaged_ha": "root_aa_pd",
            "area_affected_ha": "root_aa_tot",
            "production_loss_mt": "root_pl_vol",
            "value_loss_php": "root_pl_val",
        },
    },
    "ORNA": {
        "commodity_key": "CMD_CROPS_HVC_ORNAMENTAL",
        "metrics": {
            "affected_farmers_fisherfolk_count": "orna_nof",
            "area_totally_damaged_ha": "orna_aa_td",
            "area_partially_damaged_ha": "orna_aa_pd",
            "area_affected_ha": "orna_aa_tot",
            "production_loss_mt": "orna_pl_vol",
            "value_loss_php": "orna_pl_val",
        },
    },
    "FIBE": {
        "commodity_key": "CMD_CROPS_FIBER",
        "metrics": {
            "affected_farmers_fisherfolk_count": "fibe_nof",
            "area_totally_damaged_ha": "fibe_aa_td",
            "area_partially_damaged_ha": "fibe_aa_pd",
            "area_affected_ha": "fibe_aa_tot",
            "production_loss_mt": "fibe_pl_vol",
            "value_loss_php": "fibe_pl_val",
        },
    },
    "COCO": {
        "commodity_key": "CMD_CROPS_COCONUT",
        "metrics": {
            "affected_farmers_fisherfolk_count": "coco_nof",
            "area_totally_damaged_ha": "coco_aa_td",
            "area_partially_damaged_ha": "coco_aa_pd",
            "area_affected_ha": "coco_aa_tot",
            "value_loss_php": "coco_pl_val",
        },
    },
    "SUGR": {
        "commodity_key": "CMD_CROPS_SUGARCANE",
        "metrics": {
            "affected_farmers_fisherfolk_count": "sugr_nof",
            "area_totally_damaged_ha": "sugr_aa_td",
            "area_partially_damaged_ha": "sugr_aa_pd",
            "area_affected_ha": "sugr_aa_tot",
            "production_loss_mt": "sugr_pl_vol",
            "value_loss_php": "sugr_pl_val",
        },
    },
    "TBCO": {
        "commodity_key": "CMD_CROPS_TOBACCO",
        "metrics": {
            "affected_farmers_fisherfolk_count": "tbco_nof",
            "area_totally_damaged_ha": "tbco_aa_td",
            "area_partially_damaged_ha": "tbco_aa_pd",
            "area_affected_ha": "tbco_aa_tot",
            "production_loss_mt": "tbco_pl_vol",
            "value_loss_php": "tbco_pl_val",
        },
    },
    "FISH_A": {
        "commodity_key": "CMD_FISHERIES_PRODUCE",
        "metrics": {
            "affected_farmers_fisherfolk_count": "fish_nof_a",
            "production_loss_mt": "fish_pl_vol",
            "value_loss_php": "fish_pl_val_a",
        },
    },
    "FISH_B": {
        "commodity_key": "CMD_FISHERIES_GEAR_FACILITY_EQUIPMENT",
        "metrics": {
            "affected_farmers_fisherfolk_count": "fish_nof_b",
            "value_loss_php": "fish_pl_val_b",
        },
    },
    "LIVE": {
        "commodity_key": "CMD_LIVESTOCK_POULTRY",
        "metrics": {
            "affected_farmers_fisherfolk_count": "live_nof",
            "affected_livestock_poultry_heads_count": "live_noh",
            "value_loss_php": "live_pl_val",
        },
    },
    "IRRIG_SSIS": {
        "commodity_key": "CMD_AMEF_IRRIGATION_SSIS",
        "metrics": {
            "affected_farmers_fisherfolk_count": "irrig_ssis_nof",
            "value_loss_php": "irrig_ssis_pl_val",
        },
    },
    "IRRIG_NIA": {
        "commodity_key": "CMD_AMEF_IRRIGATION_NIS",
        "metrics": {
            "affected_farmers_fisherfolk_count": "irrig_nia_nof",
            "value_loss_php": "irrig_nia_pl_val",
        },
    },
    "INFRA": {
        "commodity_key": "CMD_AMEF_FACILITIES",
        "metrics": {
            "affected_farmers_fisherfolk_count": "infra_nof",
            "value_loss_php": "infra_pl_val",
        },
    },
    "EQP": {
        "commodity_key": "CMD_AMEF_MACHINERIES_EQUIPMENT",
        "metrics": {
            "affected_farmers_fisherfolk_count": "eqp_nof",
            "value_loss_php": "eqp_pl_val",
        },
    },
}

COUNT_METRICS = {
    "affected_farmers_fisherfolk_count",
    "affected_livestock_poultry_heads_count",
}
COUNT_RAW_FIELDS = {
    str(raw_field)
    for group in COMMODITY_GROUPS.values()
    for final_field, raw_field in group["metrics"].items()
    if final_field in COUNT_METRICS
}
VALIDATION_ONLY_METRIC_FIELDS = {
    *(f"total_{suffix}" for suffix in ("nof", "aa_td", "aa_pd", "aa_tot", "pl_vol", "pl_val")),
    *(f"corn_{suffix}" for suffix in ("nof", "aa_td", "aa_pd", "aa_tot", "pl_vol", "pl_val")),
    *(f"hvcc_{suffix}" for suffix in ("nof", "aa_td", "aa_pd", "aa_tot", "pl_vol", "pl_val")),
    "fish_pl_val",
    "infeqp_nof",
    "infeqp_pl_val",
}
KNOWN_STAGING_METRIC_FIELDS = {
    *(str(raw_field) for group in COMMODITY_GROUPS.values() for raw_field in group["metrics"].values()),
    *VALIDATION_ONLY_METRIC_FIELDS,
}

NULL_TOKENS = {
    "",
    "-",
    "--",
    "–",
    "—",
    "n/a",
    "na",
    "not applicable",
    "not available",
    "nil",
    "null",
}
NORMALIZED_NULL_TOKENS = {
    normalize
    for token in NULL_TOKENS
    if (normalize := re.sub(r"[^a-z0-9]+", " ", token.casefold()).strip())
}


class IngestionRuleError(ValueError):
    """Raised when a controlled ingestion value cannot be normalized safely."""


def clean_header(raw_header: str) -> str:
    """Convert a source header to its canonical staging-column name."""
    cleaned = raw_header.strip().lower()
    cleaned = re.sub(r"[^a-z0-9]+", "_", cleaned)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return CONTEXT_HEADER_ALIASES.get(
        cleaned,
        CONTEXT_HEADERS.get(cleaned, cleaned),
    )


def get_staging_columns() -> list[str]:
    """Return the canonical source columns accepted by the staging loader."""
    return [*CONTEXT_HEADERS.values(), *sorted(KNOWN_STAGING_METRIC_FIELDS)]


def expand_staging_row(row: dict[str, object]) -> dict[str, object]:
    """Expose compact JSON metrics through the flat interface used by the pipeline."""
    expanded = dict(row)
    payload = expanded.get("raw_payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise IngestionRuleError(
                "Staging metric payload is not valid JSON."
            ) from exc
        if not isinstance(payload, dict):
            raise IngestionRuleError(
                "Staging metric payload must be a JSON object."
            )
    if isinstance(payload, dict):
        expanded["raw_payload"] = payload
        expanded.update(
            {
                field_name: payload.get(field_name)
                for field_name in KNOWN_STAGING_METRIC_FIELDS
            }
        )
    return expanded


@dataclass(frozen=True)
class LocationReference:
    psgc_key: str
    location_name: str
    geographic_level: str
    region_key: str


def normalize_term(value: object) -> str:
    text = "" if value is None else str(value)
    ascii_value = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    normalized = re.sub(r"[^a-z0-9]+", " ", ascii_value.casefold())
    return " ".join(normalized.split())


def clean_incident_key_part(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    cleaned = re.sub(r"[^A-Z0-9]+", "_", ascii_value.upper())
    return re.sub(r"_+", "_", cleaned).strip("_")


def parse_year(raw_year: object) -> int | None:
    try:
        year = int(str(raw_year).strip())
    except (TypeError, ValueError):
        return None
    return year if 1 <= year <= 9999 else None


@dataclass(frozen=True)
class IncidentPeriod:
    start_year: int
    start_month: int
    end_year: int
    end_month: int

    @property
    def start_date(self) -> str:
        return f"{self.start_year:04d}-{self.start_month:02d}-01"

    @property
    def end_date(self) -> str:
        last_day = calendar.monthrange(self.end_year, self.end_month)[1]
        return f"{self.end_year:04d}-{self.end_month:02d}-{last_day:02d}"

    @property
    def month_label(self) -> str:
        start_label = calendar.month_name[self.start_month]
        end_label = calendar.month_name[self.end_month]

        if self.start_year == self.end_year and self.start_month == self.end_month:
            return start_label

        if self.start_year == self.end_year:
            return f"{start_label} - {end_label}"

        return f"{self.start_year} {start_label} - {self.end_year} {end_label}"


def parse_month(raw_month: object) -> int | None:
    normalized = normalize_term(raw_month)
    month_aliases = {
        normalize_term(calendar.month_name[index]): index
        for index in range(1, 13)
    }
    month_aliases.update(
        {
            normalize_term(calendar.month_abbr[index]): index
            for index in range(1, 13)
        }
    )
    month_aliases["sept"] = 9

    return month_aliases.get(normalized)


def _extract_month_mentions(raw_month: object) -> list[tuple[int | None, int]]:
    """Return ordered (explicit_year, month_number) mentions from a raw month field."""
    text = "" if raw_month is None else str(raw_month)
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()

    month_terms: list[str] = []
    for index in range(1, 13):
        month_terms.append(calendar.month_name[index])
        month_terms.append(calendar.month_abbr[index])
    month_terms.append("Sept")

    month_pattern = "|".join(
        re.escape(term)
        for term in sorted(set(month_terms), key=len, reverse=True)
        if term
    )
    pattern = re.compile(
        rf"(?:(?P<year>\d{{4}})\s*)?(?P<month>{month_pattern})\.?",
        re.IGNORECASE,
    )

    mentions: list[tuple[int | None, int]] = []
    for match in pattern.finditer(ascii_text):
        month = parse_month(match.group("month"))
        if month is None:
            continue
        mentions.append((parse_year(match.group("year")), month))

    return mentions


def parse_incident_period(raw_year: object, raw_month: object) -> IncidentPeriod | None:
    """Parse single-month and multi-month incident periods.

    Supports historical values such as:
    - January
    - January - July
    - July, August
    - October - February
    - 2022 December - January
    """
    source_year = parse_year(raw_year)
    if source_year is None:
        return None

    mentions = _extract_month_mentions(raw_month)
    if not mentions:
        return None

    start_explicit_year, start_month = mentions[0]
    end_explicit_year, end_month = mentions[-1]

    if len(mentions) == 1:
        year = start_explicit_year or source_year
        return IncidentPeriod(
            start_year=year,
            start_month=start_month,
            end_year=year,
            end_month=start_month,
        )

    crosses_year = end_month < start_month

    if start_explicit_year is not None:
        start_year = start_explicit_year
    elif crosses_year:
        start_year = source_year - 1
    else:
        start_year = source_year

    if end_explicit_year is not None:
        end_year = end_explicit_year
    elif crosses_year:
        end_year = start_year + 1
    else:
        end_year = start_year

    return IncidentPeriod(
        start_year=start_year,
        start_month=start_month,
        end_year=end_year,
        end_month=end_month,
    )


def build_incident_key(raw_calamity: object, raw_year: object, raw_month: object, source_row_number: int | None = None) -> str:
    calamity_key = clean_incident_key_part(str(raw_calamity or "").strip())
    period = parse_incident_period(raw_year, raw_month)
    if not calamity_key or period is None:
        return ""
    key = f"INC_{calamity_key}_{period.start_year:04d}_{period.start_month:02d}"
    return key


def fetch_latest_batch(cursor, schema_name: str, source_year: int = 2025, file_name: str = "damage_report_2025.csv"):
    cursor.execute(
        sql.SQL(
            """
            SELECT *
            FROM {}.import_batch
            WHERE source_year = %s
              AND file_name = %s
            ORDER BY import_batch_key DESC
            LIMIT 1
            """
        ).format(sql.Identifier(schema_name)),
        (source_year, file_name),
    )
    row = cursor.fetchone()
    if row is not None and not isinstance(row, dict):
        colnames = [desc[0] for desc in cursor.description]
        row = dict(zip(colnames, row))
    return row


def fetch_batch_by_key(cursor, schema_name: str, batch_id: int, *, for_update: bool = False):
    """Fetch one staging batch by its stable primary key."""
    cursor.execute(
        sql.SQL(
            "SELECT * FROM {}.import_batch WHERE import_batch_key = %s"
        ).format(sql.Identifier(schema_name)) + sql.SQL(" FOR UPDATE" if for_update else ""),
        (batch_id,),
    )
    row = cursor.fetchone()
    if row is not None and not isinstance(row, dict):
        colnames = [desc[0] for desc in cursor.description]
        row = dict(zip(colnames, row))
    return row


def parse_raw_decimal(value: object) -> Decimal | None:
    raw = "" if value is None else str(value).strip()
    if (
        not raw
        or raw.casefold() in NULL_TOKENS
        or normalize_term(raw) in NORMALIZED_NULL_TOKENS
    ):
        return None

    negative_parentheses = raw.startswith("(") and raw.endswith(")")
    cleaned = raw.replace(",", "").replace("₱", "").replace("$", "").strip()
    if negative_parentheses:
        cleaned = "-" + cleaned[1:-1].strip()
    try:
        parsed = Decimal(cleaned)
    except InvalidOperation as exc:
        raise IngestionRuleError(f"Invalid numeric value: {raw!r}") from exc
    if not parsed.is_finite():
        raise IngestionRuleError(f"Non-finite numeric value: {raw!r}")
    return parsed


def decimal_to_count(value: Decimal | None, field_name: str) -> int | None:
    if value is None:
        return None
    if value != value.to_integral_value():
        raise IngestionRuleError(
            f"Count field {field_name} is not a whole number: {value}"
        )
    return int(value)


def load_hazard_lookup(cursor, schema_name: str) -> dict[str, set[str]]:
    """Return normalized canonical hazard types mapped to possible keys.

    Matching is strict against the official ``hazard_type`` values. Explicitly
    approved hazard aliases remain available through ``ref_mapping_alias``.
    """
    cursor.execute(
        sql.SQL(
            """
            SELECT hazard_key, hazard_type
            FROM {}.ref_hazard
            WHERE is_active = true
            """
        ).format(sql.Identifier(schema_name))
    )
    rows = cursor.fetchall()
    colnames = [desc[0] for desc in cursor.description]

    lookup: dict[str, set[str]] = {}
    for r in rows:
        row = dict(zip(colnames, r)) if not isinstance(r, dict) else r
        hazard_key = row["hazard_key"]
        hazard_type = row["hazard_type"]
        normalized = normalize_term(hazard_type)
        if normalized:
            lookup.setdefault(normalized, set()).add(hazard_key)

    cursor.execute(
        sql.SQL(
            """
            SELECT raw_term, normalized_term, mapped_key
            FROM {}.ref_mapping_alias
            WHERE domain = %s
              AND is_active = true
            """
        ).format(sql.Identifier(schema_name)),
        ["hazard"],
    )
    alias_rows = cursor.fetchall()
    alias_colnames = [desc[0] for desc in cursor.description]

    for r in alias_rows:
        row = dict(zip(alias_colnames, r)) if not isinstance(r, dict) else r
        mapped_key = row["mapped_key"]
        normalized = normalize_term(row["raw_term"]) or normalize_term(
            row["normalized_term"]
        )
        if normalized:
            lookup.setdefault(normalized, set()).add(mapped_key)

    return lookup


def map_hazard_key(
    raw_category: object,
    lookup: dict[str, set[str]],
    raw_calamity: object | None = None,
) -> str:
    """Map source hazard text to one approved hazard key.

    Most historical files store the broad hazard group in Category and the
    specific event type in Calamity. For example:

        Category = Human-Induced
        Calamity = Oil Spill

    In that case, Category alone is too broad to map safely. Try Category
    first for existing behavior, then fall back to Calamity when Category
    does not produce exactly one approved ref_hazard match.
    """

    def find_unique_match(raw_value: object) -> str:
        normalized = normalize_term(raw_value)
        if normalized in GENERIC_HAZARD_CONTEXT_TERMS:
            # Broad source categories must never resolve to the specific
            # Geologic Others record. Use the calamity/event field instead.
            return ""
        reference_term = CATEGORY_REFERENCE_ALIASES.get(
            normalized, str(raw_value or "")
        )
        matches = lookup.get(normalize_term(reference_term), set())
        # Reference labels are editable in the Libraries workspace. If a
        # deployed label still uses the source spelling, retain the explicit
        # category alias instead of treating the otherwise valid hazard as
        # unmapped.
        if not matches and normalized != normalize_term(reference_term):
            matches = lookup.get(normalized, set())
        return next(iter(matches)) if len(matches) == 1 else ""

    return find_unique_match(raw_category) or find_unique_match(raw_calamity)


def location_name_variants(value: object) -> set[str]:
    normalized = normalize_term(value)
    variants = {normalized}
    if normalized.startswith("city of "):
        variants.add(normalized.removeprefix("city of "))
    if normalized.endswith(" city"):
        variants.add(normalized.removesuffix(" city"))
    return {variant for variant in variants if variant}


class LocationMatcher:
    """Match staged region/province labels to active PSGC references."""

    def __init__(self, references: list[LocationReference]):
        self.by_psgc_key: dict[str, LocationReference] = {}
        self.region_by_name: dict[str, list[LocationReference]] = {}
        self.exact_by_region_and_name: dict[
            tuple[str, str], list[LocationReference]
        ] = {}
        self.specific_by_region_and_name: dict[
            tuple[str, str], list[LocationReference]
        ] = {}

        for reference in references:
            self.by_psgc_key[normalize_psgc_key(reference.psgc_key)] = reference
            if reference.geographic_level == "REGION":
                for variant in location_name_variants(reference.location_name):
                    self.region_by_name.setdefault(variant, []).append(reference)
                continue
            if reference.geographic_level not in {
                "PROVINCE",
                "HUC",
                "ICC",
                "COMPONENT_CITY",
                "SPECIAL_GEOGRAPHIC_AREA",
            }:
                continue
            exact_key = (
                reference.region_key,
                normalize_term(reference.location_name),
            )
            self.exact_by_region_and_name.setdefault(exact_key, []).append(reference)
            for variant in location_name_variants(reference.location_name):
                key = (reference.region_key, variant)
                self.specific_by_region_and_name.setdefault(key, []).append(reference)

    def lookup_psgc_key(self, raw_psgc_key: object) -> LocationReference | None:
        """Return the active reference represented by a canonical PSGC key."""
        normalized = normalize_psgc_key(raw_psgc_key)
        return self.by_psgc_key.get(normalized) if normalized else None

    def match(self, raw_region: object, raw_province: object) -> LocationReference | None:
        normalized_region = normalize_term(raw_region)
        official_region_name = REGION_REFERENCE_ALIASES.get(
            normalized_region,
            str(raw_region or ""),
        )
        region_matches = self.region_by_name.get(normalize_term(official_region_name), [])
        if len(region_matches) != 1:
            return None
        region = region_matches[0]

        normalized_province = normalize_term(raw_province)
        if not normalized_province or normalized_province in {
            normalized_region,
            "ncr",
        }:
            return region

        official_province_name = LOCATION_REFERENCE_ALIASES.get(
            (normalized_region, normalized_province),
            str(raw_province or ""),
        )

        # Prefer the exact official name. This keeps a raw province such as
        # "Iloilo" linked to Iloilo province instead of becoming ambiguous
        # with "City of Iloilo" through relaxed city-name variants.
        exact_matches = self.exact_by_region_and_name.get(
            (region.psgc_key, normalize_term(official_province_name)),
            [],
        )
        if len(exact_matches) == 1:
            return exact_matches[0]
        if len(exact_matches) > 1:
            return None

        specific_matches: dict[str, LocationReference] = {}
        for variant in location_name_variants(official_province_name):
            for match in self.specific_by_region_and_name.get(
                (region.psgc_key, variant), []
            ):
                specific_matches[match.psgc_key] = match
        if len(specific_matches) != 1:
            return None
        return next(iter(specific_matches.values()))


def load_location_matcher(cursor, schema_name: str) -> LocationMatcher:
    cursor.execute(
        sql.SQL(
            """
            SELECT psgc_key, location_name, geographic_level, region_key
            FROM {}.ref_psgc_location
            WHERE is_active = true
            """
        ).format(sql.Identifier(schema_name))
    )
    
    rows = cursor.fetchall()
    colnames = [desc[0] for desc in cursor.description]
    
    references = []
    for r in rows:
        row = dict(zip(colnames, r)) if not isinstance(r, dict) else r
        references.append(
            LocationReference(
                psgc_key=row["psgc_key"],
                location_name=row["location_name"],
                geographic_level=row["geographic_level"],
                region_key=row["region_key"],
            )
        )
    return LocationMatcher(references)
