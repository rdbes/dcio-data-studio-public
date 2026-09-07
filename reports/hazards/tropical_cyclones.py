from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Iterable

from reports.models import (
    DamageReport,
    DisasterIncident,
    DisasterIncidentTropicalCyclone,
    TropicalCyclone,
)

TROPICAL_CYCLONE_HAZARD_KEY = "HZD_TROPICAL_CYCLONE"

CYCLONE_NAME_ALIASES = {
    "Buchoy": "Butchoy",
    "Lani": "Lannie",
    "Nuri (Outside PAR)": "Nuri",
}


# Explicitly reviewed mappings for incidents containing multiple cyclones
# or non-cyclone weather systems.
#
# Monsoon, shear line, LPA, ITCZ, and similar systems are intentionally
# excluded because the heatmap counts tropical cyclones only.
REVIEWED_CYCLONE_COMPONENTS = {
    "INC_EGAY_FALCON_CONTINUOUS_RAIN_2011_06": (
        "Egay",
        "Falcon",
    ),
    "INC_PEDRING_QUIEL_2011_09": (
        "Pedring",
        "Quiel",
    ),
    "INC_LPA_AGATON_2014_01": (
        "Agaton",
    ),
    "INC_LUIS_MARIO_2014_09": (
        "Luis",
        "Mario",
    ),
    "INC_KAREN_LAWIN_2016_10": (
        "Karen",
        "Lawin",
    ),
    "INC_GORIO_HUANING_2017_07": (
        "Gorio",
        "Huaning",
    ),
    "INC_LANI_MARING_2017_09": (
        "Lannie",
        "Maring",
    ),
    "INC_HENRY_INDAY_JOSIE_2018_07": (
        "Henry",
        "Inday",
        "Josie",
    ),
    "INC_LPA_NIKA_OFEL_2020_10": (
        "Nika",
        "Ofel",
    ),
    "INC_FABIAN_HABAGAT_2021_07": (
        "Fabian",
    ),
    "INC_MAYMAY_NENENG_2022_10": (
        "Maymay",
        "Neneng",
    ),
    "INC_SW_MONSOON_EGAY_FALCON_2023_07": (
        "Egay",
        "Falcon",
    ),
    "INC_SOUTHWEST_MONSOON_ENHANCED_BY_GORING_2023_08": (
        "Goring",
    ),
    "INC_COMBINED_EFFECTS_OF_SOUTHWEST_MONSOON_AND_TY_CARINA_2024_07": (
        "Carina",
    ),
    "INC_COMBINED_EFFECTS_OF_THE_ENHANCED_SW_MONSOON_AND_TCS_FERDIE_GENER_AND_HELEN_2024_09": (
        "Ferdie",
        "Gener",
        "Helen",
    ),
    "INC_COMBINED_EFFECTS_OF_THE_TCS_KRISTINE_LEON_2024_10": (
        "Kristine",
        "Leon",
    ),
    "INC_COMBINED_EFFECTS_OF_THE_TCS_NIKA_OFEL_PEPITO_2024_11": (
        "Nika",
        "Ofel",
        "Pepito",
    ),
    "INC_TD_QUERUBIN_AND_SHEARLINE_2024_12": (
        "Querubin",
    ),
    "INC_COMBINED_EFFECTS_OF_SOUTHWEST_MONSOON_AND_TCS_CRISING_DANTE_AND_EMONG_2025_07": (
        "Crising",
        "Dante",
        "Emong",
    ),
    "INC_COMBINED_EFFECTS_OF_TYPHOON_BISING_AND_SOUTHWEST_MOONSON_2025_07": (
        "Bising",
    ),
    "INC_COMBINED_EFFECTS_OF_SWM_TC_MIRASOL_AND_NANDO_2025_09": (
        "Mirasol",
        "Nando",
    ),
    "INC_VERBENA_AND_SHEARLINE_2025_11": (
        "Verbena",
    ),
    "INC_COMBINED_EFFECTS_OF_NEM_SHEARLINE_AND_TC_WILMA_2025_12": (
        "Wilma",
    ),
}


_CYCLONE_PREFIX_RE = re.compile(
    r"^(?:"
    r"super\s+typhoon|"
    r"severe\s+tropical\s+storm|"
    r"tropical\s+storm|"
    r"tropical\s+depression|"
    r"tropical\s+cyclone|"
    r"typhoon|"
    r"sts|"
    r"sty|"
    r"td|"
    r"ty|"
    r"tc"
    r")\s+",
    re.IGNORECASE,
)

_UNREVIEWED_COMBINATION_RE = re.compile(
    r"(?:"
    r"[,&/]|"
    r"\b(?:"
    r"and|"
    r"combined|"
    r"monsoon|"
    r"moonson|"
    r"habagat|"
    r"shearline|"
    r"shear\s+line|"
    r"lpa|"
    r"itcz|"
    r"nem|"
    r"swm|"
    r"trough|"
    r"tcs?"
    r")\b"
    r")",
    re.IGNORECASE,
)

_NON_KEY_CHARACTER_RE = re.compile(r"[^A-Z0-9]+")


@dataclass(frozen=True)
class TropicalCycloneComponentPlan:
    incident_key: str
    incident_name: str
    incident_start_date: date
    occurrence_year: int
    occurrence_month: int
    cyclone_names: tuple[str, ...]
    attribution_method: str

    @property
    def is_reviewed_combination(self) -> bool:
        return self.incident_key in REVIEWED_CYCLONE_COMPONENTS


@dataclass(frozen=True)
class TropicalCycloneLinkSyncResult:
    """Describe idempotent incident-to-cyclone link synchronization."""

    incident_count: int
    links_created: int
    links_updated: int
    unmatched_incident_keys: tuple[str, ...]


DYNAMIC_LINK_NOTE = (
    "Automatically matched from the normalized incident name and the "
    "tropical-cyclone occurrence name."
)


def _normalized_match_text(value: str | None) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", str(value or ""))
        .encode("ascii", "ignore")
        .decode("ascii")
        .upper()
    )
    return re.sub(r"[^A-Z0-9]+", " ", ascii_value).strip()


def _cyclone_name_variants(cyclone: TropicalCyclone) -> tuple[str, ...]:
    names = {
        cyclone.cyclone_name,
        cyclone.international_name,
    }

    for alias, canonical in CYCLONE_NAME_ALIASES.items():
        if _normalized_match_text(canonical) in {
            _normalized_match_text(name)
            for name in names
            if name
        }:
            names.add(alias)
        if _normalized_match_text(alias) in {
            _normalized_match_text(name)
            for name in names
            if name
        }:
            names.add(canonical)

    return tuple(
        normalized
        for normalized in {
            _normalized_match_text(name)
            for name in names
            if name
        }
        if normalized
    )


def _incident_contains_cyclone_name(
    incident_name: str,
    cyclone: TropicalCyclone,
) -> bool:
    normalized_incident = (
        f" {_normalized_match_text(incident_name)} "
    )
    return any(
        f" {variant} " in normalized_incident
        for variant in _cyclone_name_variants(cyclone)
    )


def _create_incident_derived_cyclone(
    *,
    name: str,
    occurrence_year: int,
    start_date: date,
) -> TropicalCyclone:
    cyclone_key = cyclone_occurrence_key(name, occurrence_year)
    cyclone, _created = TropicalCyclone.objects.get_or_create(
        cyclone_key=cyclone_key,
        defaults={
            "cyclone_name": name,
            "occurrence_year": occurrence_year,
            "start_date": start_date,
            "catalog_source": (
                TropicalCyclone.CatalogSource.INCIDENT_DERIVED
            ),
            "is_active": True,
        },
    )
    if not cyclone.is_active:
        cyclone.is_active = True
        cyclone.save(update_fields=["is_active", "updated_at"])
    return cyclone


def _resolve_incident_cyclones(
    incident: DisasterIncident,
    catalog: list[TropicalCyclone],
) -> list[TropicalCyclone]:
    """Resolve a report to one or more known cyclone occurrences.

    Explicitly reviewed mappings remain authoritative. Other incidents use
    whole-name matching against the same-year cyclone catalog, so a combined
    report can link every named cyclone without treating monsoon/shear-line
    words as cyclone names.
    """
    if not incident.incident_start_date:
        return []

    occurrence_year = incident.incident_start_date.year
    candidates = [
        cyclone
        for cyclone in catalog
        if cyclone.occurrence_year == occurrence_year
        and cyclone.is_active
    ]
    reviewed_names = REVIEWED_CYCLONE_COMPONENTS.get(str(incident.pk))

    if reviewed_names is not None:
        resolved = []
        for name in reviewed_names:
            normalized_name = _normalized_match_text(
                CYCLONE_NAME_ALIASES.get(name, name)
            )
            match = next(
                (
                    cyclone
                    for cyclone in candidates
                    if normalized_name
                    in _cyclone_name_variants(cyclone)
                ),
                None,
            )
            if match is None:
                match = _create_incident_derived_cyclone(
                    name=CYCLONE_NAME_ALIASES.get(name, name),
                    occurrence_year=occurrence_year,
                    start_date=incident.incident_start_date,
                )
                candidates.append(match)
            if match not in resolved:
                resolved.append(match)
        return resolved

    resolved = [
        cyclone
        for cyclone in candidates
        if _incident_contains_cyclone_name(
            incident.incident_name,
            cyclone,
        )
    ]

    if resolved:
        return resolved

    # A plain, single-cyclone report may arrive before its catalog row. Keep
    # the existing direct-incident behavior by deriving that one occurrence;
    # mixed/combined reports intentionally remain unmatched until a known
    # cyclone catalog row is available.
    try:
        direct_name = cyclone_component_names(
            str(incident.pk),
            incident.incident_name,
        )[0]
    except ValueError:
        return []

    return [
        _create_incident_derived_cyclone(
            name=direct_name,
            occurrence_year=occurrence_year,
            start_date=incident.incident_start_date,
        )
    ]


def synchronize_incident_tropical_cyclone_links(
    incident_keys: Iterable[str] | None = None,
) -> TropicalCycloneLinkSyncResult:
    """Create/update idempotent links after normalized facts are available.

    This is safe to call after an upload or after a new operational cyclone
    arrives. It only considers active tropical-cyclone incidents with active
    damage facts; live operational tracks therefore remain independent when a
    cyclone has no report yet.
    """
    eligible = eligible_tropical_cyclone_incidents()
    if incident_keys is not None:
        eligible = eligible.filter(
            pk__in=[str(key) for key in incident_keys]
        )

    incidents = list(eligible)
    if not incidents:
        return TropicalCycloneLinkSyncResult(0, 0, 0, ())

    catalog = list(
        TropicalCyclone.objects.filter(is_active=True)
    )
    links_created = 0
    links_updated = 0
    unmatched: list[str] = []

    for incident in incidents:
        resolved = _resolve_incident_cyclones(incident, catalog)
        if not resolved:
            unmatched.append(str(incident.pk))
            continue
        for cyclone in resolved:
            if cyclone not in catalog:
                catalog.append(cyclone)

        attribution_method = (
            DisasterIncidentTropicalCyclone.AttributionMethod.COMBINED
            if len(resolved) > 1
            else DisasterIncidentTropicalCyclone.AttributionMethod.DIRECT
        )
        for cyclone in resolved:
            link, created = (
                DisasterIncidentTropicalCyclone.objects.get_or_create(
                    incident_key=incident,
                    cyclone_key=cyclone,
                    defaults={
                        "attribution_method": attribution_method,
                        "notes": DYNAMIC_LINK_NOTE,
                    },
                )
            )
            if created:
                links_created += 1
                continue

            if (
                link.attribution_method
                == DisasterIncidentTropicalCyclone.AttributionMethod.MANUAL
            ):
                continue

            changed_fields = []
            if link.attribution_method != attribution_method:
                link.attribution_method = attribution_method
                changed_fields.append("attribution_method")
            if not link.notes:
                link.notes = DYNAMIC_LINK_NOTE
                changed_fields.append("notes")
            if changed_fields:
                link.save(update_fields=[*changed_fields, "updated_at"])
                links_updated += 1

    return TropicalCycloneLinkSyncResult(
        incident_count=len(incidents),
        links_created=links_created,
        links_updated=links_updated,
        unmatched_incident_keys=tuple(unmatched),
    )


def cyclone_component_names(
    incident_key: str,
    incident_name: str,
) -> tuple[str, ...]:
    reviewed = REVIEWED_CYCLONE_COMPONENTS.get(incident_key)

    if reviewed is not None:
        normalized_names = tuple(
            CYCLONE_NAME_ALIASES.get(
                name.strip(),
                name.strip(),
            )
            for name in reviewed
            if name.strip()
        )

        if (
            not normalized_names
            or len(normalized_names) != len(set(normalized_names))
        ):
            raise ValueError(
                f"{incident_key}: invalid reviewed component mapping"
            )

        return normalized_names

    candidate = _CYCLONE_PREFIX_RE.sub(
        "",
        str(incident_name or "").strip(),
        count=1,
    ).strip(" .,-")

    if not candidate:
        raise ValueError(
            f"{incident_key}: cyclone name is blank"
        )

    if _UNREVIEWED_COMBINATION_RE.search(candidate):
        raise ValueError(
            f"{incident_key}: combined or mixed incident requires "
            "an explicit reviewed component mapping"
        )

    return (
        CYCLONE_NAME_ALIASES.get(candidate, candidate),
    )


def cyclone_occurrence_key(
    cyclone_name: str,
    occurrence_year: int,
) -> str:
    ascii_name = (
        unicodedata.normalize("NFKD", cyclone_name)
        .encode("ascii", "ignore")
        .decode("ascii")
        .upper()
    )
    normalized_name = _NON_KEY_CHARACTER_RE.sub(
        "_",
        ascii_name,
    ).strip("_")

    if not normalized_name:
        raise ValueError(
            f"Cannot construct a cyclone key for {cyclone_name!r}"
        )

    cyclone_key = f"TC_{normalized_name}_{occurrence_year}"

    if len(cyclone_key) > 100:
        raise ValueError(
            f"Cyclone key exceeds 100 characters: {cyclone_key}"
        )

    return cyclone_key


def eligible_tropical_cyclone_incidents():
    incident_ids = (
        DamageReport.objects
        .filter(
            is_active=True,
            incident_key__hazard_key_id=(
                TROPICAL_CYCLONE_HAZARD_KEY
            ),
        )
        .values_list("incident_key_id", flat=True)
        .distinct()
    )

    return (
        DisasterIncident.objects
        .filter(pk__in=incident_ids)
        .order_by(
            "incident_start_date",
            "incident_name",
            "incident_key",
        )
    )


def build_tropical_cyclone_component_plan(
    incidents: Iterable[DisasterIncident],
) -> list[TropicalCycloneComponentPlan]:
    plan = []

    for incident in incidents:
        if not incident.incident_start_date:
            raise ValueError(
                f"{incident.pk}: incident start date is required"
            )

        incident_key = str(incident.pk)
        cyclone_names = cyclone_component_names(
            incident_key,
            incident.incident_name,
        )

        plan.append(
            TropicalCycloneComponentPlan(
                incident_key=incident_key,
                incident_name=incident.incident_name,
                incident_start_date=incident.incident_start_date,
                occurrence_year=incident.incident_start_date.year,
                occurrence_month=incident.incident_start_date.month,
                cyclone_names=cyclone_names,
                attribution_method=(
                    "combined"
                    if incident_key
                    in REVIEWED_CYCLONE_COMPONENTS
                    else "direct"
                ),
            )
        )

    return plan
