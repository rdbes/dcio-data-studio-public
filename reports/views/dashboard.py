from __future__ import annotations

import calendar

from django.core.paginator import Paginator
from django.db.models import Sum
from django.db.models.functions import ExtractYear
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone

from reports.analytics import (
    DATE_MODES,
    LEGACY_PERIOD_KEYS,
    METRIC_CONFIG,
    annual_analysis_excluded_years,
    apply_dashboard_filters,
    apply_scope_filters,
    build_active_filter_chips,
    build_commodity_group_options,
    build_commodity_subgroup_cascade_options,
    build_commodity_subgroup_options,
    build_filter_context,
    commodity_group_filter,
    commodity_group_from_row,
    discrete_period_selection,
    format_compact_value,
    format_exact_value,
    format_percent_delta,
    hazard_display_label,
    hazard_sort_key,
    normalize_period,
    normalize_scope_filter_values,
    number,
    preserved_url,
    selected_period_options,
    short_region_label,
    url_with_query,
    zero,
)
from reports.dashboard import (
    ANNUAL_SUMMARY_PAGE_SIZE,
    COMPARISON_WINDOW_OPTIONS,
    FARMERS_AVERAGE_START_YEAR,
    KPI_COMPARISON_WINDOW,
    build_annual_summary,
    build_chart_breakdowns,
    build_commodity_pie,
    build_hazard_pie,
    build_kpi_card,
    build_monthly_line,
    build_province_chart,
    build_quarterly_breakdown,
    build_region_chart,
    build_subgroup_pie,
    comparison_period,
    five_year_periods,
    rolling_window_metric_cards,
)
from reports.dashboard.aggregation import (
    CHART_METRICS,
    annual_reference,
    annual_selection,
    metric_start_years,
    nullable_sum,
    period_windows,
    report_observations,
    select_observations,
    summarize_observations,
    year_label,
)
from reports.dashboard.kpis import comparison_delta, previous_period_references
from reports.incident_attribution import (
    damage_report_analysis_date_expression,
)
from reports.location_ordering import region_sort_key, sort_region_names
from reports.models import DamageReport, RefHazard

# Backwards compatibility re-exports for private helpers
_short_region_label = short_region_label
_zero = zero
_number = number
_format_exact_value = format_exact_value
_format_compact_value = format_compact_value
_format_percent_delta = format_percent_delta
_build_kpi_card = build_kpi_card
_build_region_chart = build_region_chart
_build_province_chart = build_province_chart
_build_commodity_pie = build_commodity_pie
_build_subgroup_pie = build_subgroup_pie
_build_hazard_pie = build_hazard_pie
_normalize_period = normalize_period
_commodity_group_from_row = commodity_group_from_row
_commodity_group_filter = commodity_group_filter
_build_commodity_group_options = build_commodity_group_options
_build_commodity_subgroup_options = build_commodity_subgroup_options
_build_commodity_subgroup_cascade_options = build_commodity_subgroup_cascade_options
_normalize_scope_filter_values = normalize_scope_filter_values
_apply_dashboard_filters = apply_dashboard_filters
_apply_scope_filters = apply_scope_filters
_build_annual_summary = build_annual_summary
_hazard_display_label = hazard_display_label
_hazard_sort_key = hazard_sort_key
_build_monthly_line = build_monthly_line
_build_filter_context = build_filter_context
_selected_period_options = selected_period_options
_url_with_query = url_with_query
_preserved_url = preserved_url
_build_active_filter_chips = build_active_filter_chips


def analytics(request):
    """Show a visual analytics dashboard from normalized damage_report records."""
    current_year = timezone.now().year
    excluded_years = annual_analysis_excluded_years(current_year)
    active_reports = DamageReport.objects.filter(is_active=True)

    active_hazards = list(
        RefHazard.objects.filter(
            is_active=True,
            archived_at__isnull=True,
        ).order_by("hazard_key")
    )
    for hazard in active_hazards:
        hazard.display_label = _hazard_display_label(
            hazard.hazard_key,
            hazard.hazard_type,
            hazard.hazard_category,
        )

    active_hazards.sort(key=_hazard_sort_key)

    active_hazards_by_key = {
        hazard.hazard_key: hazard for hazard in active_hazards
    }
    requested_hazard_keys = list(dict.fromkeys(request.GET.getlist("hazard")))
    selected_hazards = [
        active_hazards_by_key[key]
        for key in requested_hazard_keys
        if key in active_hazards_by_key
    ]
    selected_hazard_keys = [hazard.hazard_key for hazard in selected_hazards]
    selected_hazard_label = (
        ", ".join(hazard.display_label for hazard in selected_hazards)
        if selected_hazards and len(selected_hazards) < len(active_hazards)
        else "All Hazards"
    )

    available_years = list(
        active_reports.annotate(
            dashboard_analysis_year=ExtractYear(
                damage_report_analysis_date_expression()
            )
        )
        .exclude(dashboard_analysis_year__isnull=True)
        .values_list("dashboard_analysis_year", flat=True)
        .distinct()
        .order_by("-dashboard_analysis_year")
    )

    default_period_year = current_year

    selected_metric = "value"
    metric_config = METRIC_CONFIG[selected_metric]
    period = _normalize_period(
        request,
        active_reports,
        current_year,
        default_period_year,
    )

    period_years = [
        *available_years,
        period["effective_date_from"].year,
        period["effective_date_to"].year,
    ]
    period_year_min = min(period_years)
    period_year_max = max(period_years)
    period.update(
        {
            "period_year_min": period_year_min,
            "period_year_max": period_year_max,
            "period_month_max_index": (period_year_max - period_year_min + 1) * 12 - 1,
            "period_month_start_index": (
                (period["effective_date_from"].year - period_year_min) * 12
                + period["effective_date_from"].month
                - 1
            ),
            "period_month_end_index": (
                (period["effective_date_to"].year - period_year_min) * 12
                + period["effective_date_to"].month
                - 1
            ),
            **_selected_period_options(period, available_years),
        }
    )
    period.update(discrete_period_selection(request, period, available_years))

    filters = {
        **period,
        "region": request.GET.get("region") or "",
        "province": request.GET.get("province") or "",
        "commodity_group": request.GET.get("commodity_group") or "",
        "commodity_subgroup": request.GET.get("commodity_subgroup") or "",
        "hazard": selected_hazard_keys,
        "hazard_label": selected_hazard_label,
    }
    filters = _normalize_scope_filter_values(active_reports, filters)

    region_options = sort_region_names(
        active_reports.exclude(location_psgc_key__region_name__isnull=True)
        .exclude(location_psgc_key__region_name="")
        .values_list("location_psgc_key__region_name", flat=True)
        .distinct()
    )

    province_source = active_reports
    if filters["region"]:
        province_source = province_source.filter(
            location_psgc_key__region_name=filters["region"]
        )

    province_options = list(
        province_source.exclude(location_psgc_key__province_huc_name__isnull=True)
        .exclude(location_psgc_key__province_huc_name="")
        .values_list("location_psgc_key__province_huc_name", flat=True)
        .distinct()
        .order_by("location_psgc_key__province_huc_name")
    )
    province_cascade_options = sorted(
        active_reports.exclude(location_psgc_key__province_huc_name__isnull=True)
        .exclude(location_psgc_key__province_huc_name="")
        .exclude(location_psgc_key__region_name__isnull=True)
        .exclude(location_psgc_key__region_name="")
        .values(
            "location_psgc_key__region_name",
            "location_psgc_key__province_huc_name",
        )
        .distinct(),
        key=lambda option: (
            region_sort_key(option["location_psgc_key__region_name"]),
            str(option["location_psgc_key__province_huc_name"]).casefold(),
        ),
    )

    commodity_group_options = _build_commodity_group_options(active_reports)
    commodity_subgroup_options = _build_commodity_subgroup_options(
        active_reports,
        filters["commodity_group"],
    )
    commodity_subgroup_cascade_options = _build_commodity_subgroup_cascade_options(active_reports)

    today = timezone.localdate()
    filtered_reports = _apply_dashboard_filters(active_reports, filters).filter(
        dashboard_analysis_date__lte=today,
    )
    scope_reports = _apply_scope_filters(active_reports, filters).alias(
        dashboard_analysis_date=damage_report_analysis_date_expression()
    ).filter(
        dashboard_analysis_date__lte=today,
    )

    observations = report_observations(scope_reports)
    monthly_windows = period_windows(filters, today)
    monthly_observations = select_observations(observations, monthly_windows)
    annual_filters = annual_selection(filters)
    windows = period_windows(annual_filters, today)
    selected_observations = select_observations(observations, windows)
    num_years = len(windows)
    is_multi_year = num_years > 1
    starts = metric_start_years(filters)
    selected_stats = summarize_observations(selected_observations, excluded_years, starts)
    totals = {metric: stat["total"] for metric, stat in selected_stats.items()}
    totals["record_count"] = sum(row["record_count"] for row in selected_observations)
    comparison = comparison_period(
        request.GET.get("comparison_window"),
        sorted({row["analysis_date"].year for row in observations}),
        min(windows, default=filters["effective_date_from"].year) - 1,
        excluded_years,
    )
    filters["comparison_window"] = comparison["window"]
    historical_observations = [
        row for row in observations
        if row["analysis_date"].year in comparison["years"]
    ]
    lumped_years = set()
    if filters["commodity_subgroup"]:
        parent_scope = _apply_scope_filters(active_reports, {**filters, "commodity_subgroup": ""})
        parent_observations = report_observations(parent_scope)
        lumped_years = {row["analysis_date"].year for row in parent_observations
                        if not row["commodity_key__level_3_group"]}
        historical_observations = [row for row in historical_observations
                                   if row["analysis_date"].year not in lumped_years]
        selected_stats = summarize_observations(selected_observations, excluded_years | lumped_years, starts)
    reference = annual_reference(historical_observations, excluded_years, starts)
    comparison_averages = {metric: stat["average"] for metric, stat in reference.items()}
    # The annual summary is a scope history table. Keep it independent from
    # the selected year/month window so changing the period filter never hides
    # years from the historical record. Charts and KPIs continue to use the
    # selected years above.
    annual_summary_rows, annual_trends = _build_annual_summary(observations, excluded_years)
    historical_summary_rows = annual_summary_rows
    summary_stats = summarize_observations(observations, excluded_years, starts)
    annual_summary_total = {metric: stat["total"] for metric, stat in summary_stats.items()}
    annual_summary_average = {metric: stat["average"] for metric, stat in summary_stats.items()}
    annual_summary_year_count = len(annual_summary_rows)
    annual_summary_average_year_counts = {metric: stat["year_count"] for metric, stat in summary_stats.items()}
    annual_summary_average_year_count = len({row["year"] for row in annual_summary_rows} - set(excluded_years))
    for chart_metric, rows in annual_trends.items():
        for row in rows:
            row["average_value"] = annual_summary_average[CHART_METRICS[chart_metric]]
    annual_five_year_periods = five_year_periods(historical_summary_rows, excluded_years, starts)
    comparison_window_cards = rolling_window_metric_cards(
        historical_summary_rows, available_years, filters["effective_date_to"].year,
        excluded_years, starts,
    )
    quarterly_breakdown = build_quarterly_breakdown(
        filtered_reports, annual_filters["period_label"], observations=selected_observations,
    )
    is_full_calendar_year_period = bool(windows) and all(
        len(intervals) == 12
        and intervals[0][0].month == 1 and intervals[0][0].day == 1
        and intervals[-1][1].month == 12 and intervals[-1][1].day == 31
        for intervals in windows.values()
    )

    annual_summary_paginator = Paginator(
        annual_summary_rows,
        ANNUAL_SUMMARY_PAGE_SIZE,
    )
    annual_summary_page = annual_summary_paginator.get_page(request.GET.get("page"))

    annual_summary_empty_rows = range(
        max(
            0,
            annual_summary_page.paginator.per_page
            - len(annual_summary_page.object_list),
        )
    )
    annual_summary_query_params = request.GET.copy()
    annual_summary_query_params.pop("page", None)

    # Top 10 incidents by value loss
    top_incidents_qs = (
        filtered_reports.exclude(incident_key__isnull=True)
        .values(
            "incident_key",
            "incident_key__incident_name",
            "incident_key__incident_start_date",
            "incident_key__incident_end_date",
        )
        .annotate(
            analysis_date=damage_report_analysis_date_expression(),
            value_loss=Sum("value_loss_php"),
            affected_farmers=Sum("affected_farmers_fisherfolk_count"),
            area_affected=Sum("area_affected_ha"),
            volume_loss=Sum("production_loss_mt"),
        )
        .order_by(
            "-value_loss",
            "-analysis_date",
            "incident_key",
        )[:10]
    )
    top_incidents = []
    for idx, row in enumerate(top_incidents_qs, 1):
        name = row["incident_key__incident_name"] or ""
        analysis_date = row["analysis_date"]
        if analysis_date:
            month_name = analysis_date.strftime("%B")
            if is_multi_year:
                display_name = f"{name} ({month_name}, {analysis_date.year})"
            else:
                display_name = f"{name} ({month_name})"
        else:
            display_name = name

        top_incidents.append(
            {
                "rank": idx,
                "display_name": display_name,
                "affected_farmers": _zero(row["affected_farmers"]),
                "area_affected": _zero(row["area_affected"]),
                "volume_loss": _zero(row["volume_loss"]),
                "value_loss": _zero(row["value_loss"]),
            }
        )

    kpi_history = [row for row in observations if row["analysis_date"].year not in lumped_years]
    previous_year, previous_reference, kpi_reference = previous_period_references(
        kpi_history,
        windows,
        selected_stats,
        excluded_years,
        starts,
        multi_year=is_multi_year,
        comparison_window=int(KPI_COMPARISON_WINDOW),
    )
    kpi_cards = []
    kpi_primary_label = (
        "Reported-year average" if is_multi_year and is_full_calendar_year_period
        else "Reported selected-period average" if is_multi_year
        else "Reported year total" if is_full_calendar_year_period
        else "Reported selected-period total"
    )
    for chart_metric, metric in CHART_METRICS.items():
        config = METRIC_CONFIG[chart_metric]
        stat, baseline = selected_stats[metric], kpi_reference[metric]
        value = stat["average"] if is_multi_year else stat["total"]
        comparable = (
            comparison["enabled"] and value is not None and baseline["average"] is not None
            and baseline["year_count"] >= 2
            and (bool(stat["years"]) if is_multi_year else min(windows, default=0) >= starts[metric])
        )
        card = _build_kpi_card(
            key=metric, label=config["label"], value=value,
            prefix=config["prefix"], suffix=config["suffix"],
            description="Reported observations for the selected scope; missing values are not zero.",
        )
        card["context"] = {
            "primary_label": kpi_primary_label,
            "show_period_total": is_multi_year,
            "period_total_display": _format_compact_value(stat["total"], prefix=config["prefix"], suffix=config["suffix"]) if stat["total"] is not None else "Not available",
            "period_total_exact": _format_exact_value(stat["total"], prefix=config["prefix"], suffix=config["suffix"]) if stat["total"] is not None else "Not available",
            "selected_annual_average_value": value,
            "comparison_average_value": baseline["average"],
            "comparison_delta": comparison_delta(value, baseline, minimum_years=2),
            "comparison_label": (
                f"{previous_year - int(KPI_COMPARISON_WINDOW) + 1}–{previous_year}"
                if previous_year
                else f"previous {KPI_COMPARISON_WINDOW}-year"
            ),
            "period_label": annual_filters["period_label"] + (" year-to-date" if current_year in windows and not is_multi_year else ""),
            "comparison_basis_label": "annual avg" if comparison["enabled"] else "",
            "comparison_note": (
                "Comparison off" if comparison["window"] == "none"
                else f"{baseline['year_count']} prior reporting years; same months/dates" if comparable
                else "Comparison unavailable: fewer than two comparable reporting years"
            ),
            "coverage_note": f"{stat['reported']:,} of {stat['records']:,} rows have this metric",
            "average_years": year_label(stat["years"]) if is_multi_year else "",
            "previous_year_delta": comparison_delta(value, previous_reference[metric]),
            "previous_year": previous_year,
        }
        kpi_cards.append(card)

    filter_context = _build_filter_context(annual_filters, available_years)
    filter_context["time_label"] = annual_filters["period_label"] + (" (year-to-date)" if current_year in windows else "")
    filter_context.update(
        {
            "comparison_enabled": comparison["enabled"],
            "comparison_label": comparison["label"],
            "comparison_window": comparison["window"],
        }
    )

    period_clear_url = _url_with_query(
        request,
        remove=list(LEGACY_PERIOD_KEYS),
        updates={"period_mode": "latest_year"},
    )
    active_filter_chips = [
        {
            "label": filters["selected_year_label"],
            "clear_url": (
                ""
                if filters["period_mode"] == "latest_year"
                else period_clear_url
            ),
        },
        {
            "label": filters["selected_month_label"],
            "clear_url": (
                ""
                if filters["period_mode"] == "latest_year"
                else period_clear_url
            ),
        },
    ]
    if selected_hazards and selected_hazard_label != "All Hazards":
        active_filter_chips.append(
            {
                "label": selected_hazard_label,
                "clear_url": _url_with_query(
                    request,
                    remove=["hazard"],
                ),
            }
        )
    else:
        active_filter_chips.append({"label": "All Hazards", "clear_url": ""})
    active_filter_chips.extend(
        _build_active_filter_chips(
            request,
            filters,
            include_defaults=True,
            include_period=False,
            default_labels={
                "region": "All Regions",
                "commodity_group": "All Commodity",
            },
        )
    )

    chart_context = {
        "windows": windows, "filters": filters, "excluded_years": excluded_years,
        "multi_year": is_multi_year, "comparison_enabled": comparison["enabled"],
    }
    chart_data = {
        "comparison": comparison,
        **build_chart_breakdowns(selected_observations, historical_observations, **chart_context),
        "monthly_line": _build_monthly_line(monthly_observations, [], **{
            **chart_context, "windows": monthly_windows, "comparison_enabled": False,
        }),
        "annual_trends": annual_trends,
        "is_multi_year": is_multi_year,
        "filter_context": filter_context,
        "selected_years": sorted(windows),
        "has_subgroups": any(row["commodity_key__level_3_group"] for row in selected_observations),
    }
    quality_notes = [
        "Averages use years with reported values. Missing records and unavailable metrics are not zero; field presence does not establish complete reporting.",
        "Historical categories changed in 2022–2023. Comparisons use prior years with the requested detail; parent totals are not allocated to subgroups.",
        "Farmer counts and affected hectares may recur across incidents or commodities. PHP values are nominal. Months refer to incident end dates, falling back to start dates.",
    ]
    if current_year in windows:
        quality_notes.append(f"{current_year} is provisional through {today:%d %b %Y}; it is excluded from multi-year averages but retained in period totals.")
    if lumped_years:
        quality_notes.append(f"Subgroup comparisons exclude years with unspecified parent detail: {year_label(lumped_years)}.")
    unspecified_value = nullable_sum(row["value_loss"] for row in selected_observations if not row["location_psgc_key__province_huc_name"])
    if unspecified_value:
        quality_notes.append(f"{_format_exact_value(unspecified_value, prefix='PHP ')} has no province attribution and remains in the Unspecified Province category.")
    return render(
        request,
        "reports/dashboard.html",
        {
            "quality_notes": quality_notes,
            "comparison_window_options": COMPARISON_WINDOW_OPTIONS,
            "available_years": available_years,
            "month_options": [
                {"value": month_number, "label": calendar.month_name[month_number]}
                for month_number in range(1, 13)
            ],
            "date_modes": DATE_MODES,
            "comparison": comparison,
            "metric_options": METRIC_CONFIG,
            "active_hazards": active_hazards,
            "region_options": region_options,
            "province_options": province_options,
            "province_cascade_options": province_cascade_options,
            "commodity_group_options": commodity_group_options,
            "commodity_subgroup_options": commodity_subgroup_options,
            "commodity_subgroup_cascade_options": commodity_subgroup_cascade_options,
            "selected_filters": {
                **filters,
            },
            "selected_metric": metric_config,
            "kpi_cards": kpi_cards,
            "record_count": _zero(totals["record_count"]),
            "chart_data": chart_data,
            "quarterly_breakdown": quarterly_breakdown,
            "annual_summary_rows": annual_summary_rows,
            "annual_summary_total": annual_summary_total,
            "annual_summary_average": annual_summary_average,
            "annual_summary_year_count": annual_summary_year_count,
            "annual_analysis_excluded_years": sorted(
                excluded_years,
            ),
            "annual_summary_average_year_count": annual_summary_average_year_count,
            "annual_summary_farmer_average_year_count": annual_summary_average_year_counts[
                "affected_farmers"
            ],
            "farmers_average_start_year": FARMERS_AVERAGE_START_YEAR,
            "comparison_averages": comparison_averages,
            "annual_five_year_periods": annual_five_year_periods,
            "comparison_window_cards": comparison_window_cards,
            "annual_summary_page": annual_summary_page,
            "annual_summary_empty_rows": annual_summary_empty_rows,
            "annual_summary_querystring": annual_summary_query_params.urlencode(),
            "top_incidents": top_incidents,
            "active_filter_chips": active_filter_chips,
            "map_navigation_url": _preserved_url(
                request,
                reverse("reports:dashboard"),
            ),
        },
    )


dashboard = analytics
