from __future__ import annotations

import calendar
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Prefetch, Q

from reports.climate.dry_days import (
    DRY_DAY_CLIMATOLOGY_END_YEAR,
    DRY_DAY_CLIMATOLOGY_START_YEAR,
    DRY_DAY_RAINFALL_THRESHOLD_MM,
)
from reports.location_ordering import region_sort_key, sort_region_names
from reports.models import ClimateLocation, DryDayNormal

_ONE_DECIMAL = Decimal("0.1")


@dataclass(frozen=True, slots=True)
class DryDayMonthSummary:
    month_number: int
    month_name: str
    location_count: int
    average_normal: Decimal | None
    average_normal_display: str
    minimum_normal: int | None
    maximum_normal: int | None


@dataclass(frozen=True, slots=True)
class DryDayHeatmapBand:
    key: str
    label: str
    minimum_days: int
    maximum_days: int


DRY_DAY_HEATMAP_BANDS = (
    DryDayHeatmapBand("0-5", "0–5 days", 0, 5),
    DryDayHeatmapBand("6-10", "6–10 days", 6, 10),
    DryDayHeatmapBand("11-15", "11–15 days", 11, 15),
    DryDayHeatmapBand("16-20", "16–20 days", 16, 20),
    DryDayHeatmapBand("21-25", "21–25 days", 21, 25),
    DryDayHeatmapBand("26-31", "26–31 days", 26, 31),
)


@dataclass(frozen=True, slots=True)
class DryDayNormalCell:
    value: int | None
    heatmap_band_key: str


@dataclass(frozen=True, slots=True)
class DryDayLocationRow:
    climate_location_key: str
    display_label: str
    published_label: str
    region_label: str
    geographic_scope: str
    geographic_scope_label: str
    monthly_cells: tuple[DryDayNormalCell, ...]
    annual_minimum: int | None
    annual_average: Decimal | None
    annual_average_display: str
    annual_maximum: int | None

    @property
    def monthly_normals(self) -> tuple[int | None, ...]:
        return tuple(cell.value for cell in self.monthly_cells)


@dataclass(frozen=True, slots=True)
class DryDaySourceDocument:
    document_title: str
    issue_date: object


@dataclass(frozen=True, slots=True)
class DryDayAnalysis:
    location_rows: tuple[DryDayLocationRow, ...]
    month_summaries: tuple[DryDayMonthSummary, ...]
    heatmap_bands: tuple[DryDayHeatmapBand, ...]
    region_options: tuple[str, ...]
    source_documents: tuple[DryDaySourceDocument, ...]
    selected_region: str
    search_query: str
    location_count: int
    normal_count: int
    expected_normal_count: int
    is_complete: bool
    climatology_start_year: int
    climatology_end_year: int
    rainfall_threshold_mm: Decimal


def _average(values: list[int]) -> Decimal | None:
    if not values:
        return None

    return (
        Decimal(sum(values)) / Decimal(len(values))
    ).quantize(
        _ONE_DECIMAL,
        rounding=ROUND_HALF_UP,
    )


def _display_decimal(value: Decimal | None) -> str:
    if value is None:
        return "—"

    return f"{value:.1f}"


def dry_day_heatmap_band_key(value: int | None) -> str:
    if value is None:
        return "missing"

    for band in DRY_DAY_HEATMAP_BANDS:
        if band.minimum_days <= value <= band.maximum_days:
            return band.key

    raise ValueError("Dry-day normal must be between 0 and 31.")


def build_dry_day_analysis(
    *,
    selected_region: str = "",
    search_query: str = "",
) -> DryDayAnalysis:
    selected_region = selected_region.strip()
    search_query = search_query.strip()[:160]

    base_locations = ClimateLocation.objects.filter(
        is_active=True
    )

    region_options = tuple(
        sort_region_names(
            base_locations.exclude(
                published_region_label=""
            )
            .values_list(
                "published_region_label",
                flat=True,
            )
            .order_by()
            .distinct()
        )
    )

    if selected_region not in region_options:
        selected_region = ""

    locations = base_locations

    if selected_region:
        locations = locations.filter(
            published_region_label=selected_region
        )

    if search_query:
        locations = locations.filter(
            Q(display_label__icontains=search_query)
            | Q(published_label__icontains=search_query)
            | Q(
                published_region_label__icontains=search_query
            )
        )

    normal_queryset = DryDayNormal.objects.filter(
        climatology_start_year=(
            DRY_DAY_CLIMATOLOGY_START_YEAR
        ),
        climatology_end_year=(
            DRY_DAY_CLIMATOLOGY_END_YEAR
        ),
        rainfall_threshold_mm=(
            DRY_DAY_RAINFALL_THRESHOLD_MM
        ),
        threshold_rule=DryDayNormal.ThresholdRule.LESS_THAN,
    ).order_by("month")

    locations = sorted(
        locations.prefetch_related(
            Prefetch(
                "dry_day_normals",
                queryset=normal_queryset,
                to_attr="analysis_normals",
            )
        ),
        key=lambda location: (
            region_sort_key(location.published_region_label),
            location.display_label.casefold(),
            location.climate_location_key,
        ),
    )

    month_values: dict[int, list[int]] = {
        month: []
        for month in range(1, 13)
    }
    source_documents: set[tuple[object, str]] = set()
    location_rows: list[DryDayLocationRow] = []
    normal_count = 0

    for location in locations:
        normals_by_month = {
            normal.month: normal
            for normal in location.analysis_normals
        }

        monthly_normals = tuple(
            (
                normals_by_month[month].normal_dry_days
                if month in normals_by_month
                else None
            )
            for month in range(1, 13)
        )

        available_values = [
            value
            for value in monthly_normals
            if value is not None
        ]

        for month, value in enumerate(
            monthly_normals,
            start=1,
        ):
            if value is not None:
                month_values[month].append(value)

        for normal in normals_by_month.values():
            source_documents.add(
                (
                    normal.source_issue_date,
                    normal.source_document_title,
                )
            )

        normal_count += len(available_values)
        annual_average = _average(available_values)

        location_rows.append(
            DryDayLocationRow(
                climate_location_key=(
                    location.climate_location_key
                ),
                display_label=location.display_label,
                published_label=location.published_label,
                region_label=(
                    location.published_region_label
                ),
                geographic_scope=(
                    location.geographic_scope
                ),
                geographic_scope_label=(
                    location.get_geographic_scope_display()
                ),
                monthly_cells=tuple(
                    DryDayNormalCell(
                        value=value,
                        heatmap_band_key=(
                            dry_day_heatmap_band_key(value)
                        ),
                    )
                    for value in monthly_normals
                ),
                annual_minimum=(
                    min(available_values)
                    if available_values
                    else None
                ),
                annual_average=annual_average,
                annual_average_display=(
                    _display_decimal(annual_average)
                ),
                annual_maximum=(
                    max(available_values)
                    if available_values
                    else None
                ),
            )
        )

    month_summaries: list[DryDayMonthSummary] = []

    for month in range(1, 13):
        values = month_values[month]
        average = _average(values)

        month_summaries.append(
            DryDayMonthSummary(
                month_number=month,
                month_name=calendar.month_name[month],
                location_count=len(values),
                average_normal=average,
                average_normal_display=(
                    _display_decimal(average)
                ),
                minimum_normal=(
                    min(values)
                    if values
                    else None
                ),
                maximum_normal=(
                    max(values)
                    if values
                    else None
                ),
            )
        )

    location_count = len(location_rows)
    expected_normal_count = location_count * 12

    source_rows = tuple(
        DryDaySourceDocument(
            issue_date=issue_date,
            document_title=document_title,
        )
        for issue_date, document_title in sorted(
            source_documents
        )
    )

    return DryDayAnalysis(
        location_rows=tuple(location_rows),
        month_summaries=tuple(month_summaries),
        heatmap_bands=DRY_DAY_HEATMAP_BANDS,
        region_options=region_options,
        source_documents=source_rows,
        selected_region=selected_region,
        search_query=search_query,
        location_count=location_count,
        normal_count=normal_count,
        expected_normal_count=expected_normal_count,
        is_complete=(
            normal_count == expected_normal_count
        ),
        climatology_start_year=(
            DRY_DAY_CLIMATOLOGY_START_YEAR
        ),
        climatology_end_year=(
            DRY_DAY_CLIMATOLOGY_END_YEAR
        ),
        rainfall_threshold_mm=(
            DRY_DAY_RAINFALL_THRESHOLD_MM
        ),
    )
