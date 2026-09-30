"""Static, reviewable damage-matrix curves used by the Damage Matrix page.

The source matrices are the reviewed 2021 Palay/Rice and Corn damage tables.
Wind and flooding curves use the support-point assumptions documented in
``CurvePrototyping.ipynb``; the original matrix points remain included in every
curve payload so the chart can distinguish source points from the interpolated
line.
"""

from __future__ import annotations

from bisect import bisect_right

WIND_SPEEDS = (0.0, 50.0, 70.0, 85.0, 125.0, 175.0, 225.0)
FLOOD_DAYS = (0.0, 1.5, 3.5, 5.5, 7.0, 10.0)
DROUGHT_WEEKS = (0.0, 2.5, 4.5, 6.5, 8.0)


def _endpoint_slope(h_left, h_right, delta_left, delta_right):
    """Return the shape-preserving endpoint slope used by PCHIP."""

    slope = ((2.0 * h_left + h_right) * delta_left - h_left * delta_right) / (
        h_left + h_right
    )
    if slope * delta_left <= 0.0:
        return 0.0
    if delta_left * delta_right < 0.0 and abs(slope) > abs(3.0 * delta_left):
        return 3.0 * delta_left
    return slope


def _pchip_slopes(x_values, y_values):
    """Calculate monotone cubic Hermite slopes without a SciPy dependency."""

    count = len(x_values)
    if count < 2:
        raise ValueError("At least two PCHIP support points are required.")

    intervals = [x_values[index + 1] - x_values[index] for index in range(count - 1)]
    if any(interval <= 0 for interval in intervals):
        raise ValueError("PCHIP x values must be strictly increasing.")

    deltas = [
        (y_values[index + 1] - y_values[index]) / intervals[index]
        for index in range(count - 1)
    ]
    slopes = [0.0] * count

    if count == 2:
        slopes[0] = slopes[1] = deltas[0]
        return slopes

    for index in range(1, count - 1):
        left_delta = deltas[index - 1]
        right_delta = deltas[index]
        if left_delta == 0.0 or right_delta == 0.0 or left_delta * right_delta < 0.0:
            slopes[index] = 0.0
            continue
        left_weight = 2.0 * intervals[index] + intervals[index - 1]
        right_weight = intervals[index] + 2.0 * intervals[index - 1]
        slopes[index] = (left_weight + right_weight) / (
            left_weight / left_delta + right_weight / right_delta
        )

    slopes[0] = _endpoint_slope(
        intervals[0], intervals[1], deltas[0], deltas[1]
    )
    slopes[-1] = _endpoint_slope(
        intervals[-1], intervals[-2], deltas[-1], deltas[-2]
    )
    return slopes


def _pchip_value(x_value, x_values, y_values, slopes):
    if x_value <= x_values[0]:
        return y_values[0]
    if x_value >= x_values[-1]:
        return y_values[-1]

    interval_index = min(
        len(x_values) - 2,
        max(0, bisect_right(x_values, x_value) - 1),
    )
    left_x = x_values[interval_index]
    right_x = x_values[interval_index + 1]
    width = right_x - left_x
    position = (x_value - left_x) / width
    position_squared = position * position
    position_cubed = position_squared * position

    h00 = 2.0 * position_cubed - 3.0 * position_squared + 1.0
    h10 = position_cubed - 2.0 * position_squared + position
    h01 = -2.0 * position_cubed + 3.0 * position_squared
    h11 = position_cubed - position_squared
    return (
        h00 * y_values[interval_index]
        + h10 * width * slopes[interval_index]
        + h01 * y_values[interval_index + 1]
        + h11 * width * slopes[interval_index + 1]
    )


def _curve_payload(label, x_values, y_values, color, line_style="solid"):
    slopes = _pchip_slopes(x_values, y_values)
    sample_count = 121
    start = x_values[0]
    end = x_values[-1]
    step = (end - start) / (sample_count - 1)
    curve = [
        {
            "x": round(start + step * index, 4),
            "y": round(
                100.0
                * _pchip_value(start + step * index, x_values, y_values, slopes),
                4,
            ),
        }
        for index in range(sample_count)
    ]
    anchors = [
        {"x": round(x_value, 4), "y": round(100.0 * y_value, 4)}
        for x_value, y_value in zip(x_values, y_values)
    ]
    return {
        "label": label,
        "color": color,
        "line_style": line_style,
        "curve": curve,
        "anchors": anchors,
    }


def _categorical_line_payload(title, subtitle, x_labels, rows, colors, support_label):
    """Build a line chart for matrix rows measured at categorical conditions."""

    x_values = tuple(float(index) for index in range(len(x_labels)))
    return {
        "title": title,
        "subtitle": subtitle,
        "x_label": "Exposure condition",
        "x_tick_labels": list(x_labels),
        "x_tick_step": 1,
        "y_label": "Estimated yield loss (%)",
        "x_max": max(x_values),
        "y_max": 100,
        "support_label": support_label,
        "series": [
            _curve_payload(
                stage,
                x_values,
                tuple(value / 100.0 for value in values),
                colors.get(stage, "#71717A"),
            )
            for stage, values in rows.items()
        ],
    }


def _wind_support_values(matrix_values):
    """Convert six matrix percentages into seven wind support points."""

    (
        class_one_le,
        class_one_gt,
        class_two_le,
        class_two_gt,
        class_three_le,
        class_three_gt,
    ) = (value / 100.0 for value in matrix_values)
    return (
        (
            0.0,
            class_one_le * 0.20,
            class_one_le * 0.60,
            class_one_le,
            class_two_le,
            class_three_le,
            class_three_le,
        ),
        (
            0.0,
            class_one_gt * 0.20,
            class_one_gt * 0.60,
            class_one_gt,
            class_two_gt,
            class_three_gt,
            class_three_gt,
        ),
    )


def _crop_wind_payload(crop_name, rows):
    """Build a PCHIP wind chart from a crop's six matrix percentages."""

    colors = {
        "VEGETATIVE": "#66BB6A",
        "REPRODUCTIVE": "#68BBE3",
        "MATURITY": "#E69F45",
    }
    series = []
    for stage, values in rows.items():
        le_values, gt_values = _wind_support_values(values)
        series.extend(
            (
                (
                    f"{stage} · ≤ 12 hrs",
                    le_values,
                    colors.get(stage, "#71717A"),
                    "dashed",
                ),
                (
                    f"{stage} · > 12 hrs",
                    gt_values,
                    colors.get(stage, "#71717A"),
                    "solid",
                ),
            )
        )
    return {
        "title": "Strong Wind",
        "subtitle": f"{crop_name} yield loss by growth stage and exposure",
        "x_label": "Maximum sustained wind speed (kph)",
        "y_label": "Estimated yield loss (%)",
        "x_max": 225,
        "y_max": 100,
        "support_label": "Matrix class midpoints with the notebook low-wind onset and upper ceiling assumptions",
        "series": [
            _curve_payload(label, WIND_SPEEDS, values, color, line_style)
            for label, values, color, line_style in series
        ],
    }


def _single_flood_payload(crop_name, rows):
    """Build a PCHIP flooding chart for crops with one water condition."""

    colors = {
        "NEWLY PLANTED": "#68BBE3",
        "SEEDLING": "#66BB6A",
        "VEGETATIVE": "#E69F45",
        "REPRODUCTIVE": "#D25353",
        "MATURITY": "#A55E5E",
    }
    series = []
    for stage, values in rows.items():
        normalized = tuple(value / 100.0 for value in values)
        support_values = (0.0, *normalized, normalized[-1])
        series.append(
            _curve_payload(
                stage,
                FLOOD_DAYS,
                support_values,
                colors.get(stage, "#71717A"),
            )
        )
    return {
        "title": "Flooding",
        "subtitle": f"{crop_name} yield loss by days of submergence",
        "x_label": "Days submerged",
        "y_label": "Estimated yield loss (%)",
        "x_max": 10,
        "y_max": 100,
        "support_label": "Matrix day-class midpoints with the notebook 0-day baseline and 7-day ceiling assumption",
        "reference_line": 7,
        "series": series,
    }


def _crop_drought_payload(crop_name, rows):
    """Build a PCHIP drought chart from week-of-exposure matrix values."""

    colors = {
        "NEWLY PLANTED": "#68BBE3",
        "SEEDLING": "#66BB6A",
        "VEGETATIVE": "#E69F45",
        "REPRODUCTIVE": "#D25353",
        "MATURITY": "#A55E5E",
    }
    series = []
    for stage, values in rows.items():
        normalized = tuple(value / 100.0 for value in values)
        series.append(
            _curve_payload(
                stage,
                DROUGHT_WEEKS,
                (0.0, *normalized),
                colors.get(stage, "#71717A"),
            )
        )
    return {
        "title": "Drought",
        "subtitle": f"{crop_name} yield loss by weeks of exposure",
        "x_label": "Weeks of exposure",
        "y_label": "Estimated yield loss (%)",
        "x_max": 8,
        "y_max": 100,
        "support_label": "Matrix week-class midpoints with the notebook 0-week baseline assumption",
        "series": series,
    }


def _wind_payload():
    colors = {
        "Panicle Initiation / Booting": "#68BBE3",
        "FLOWERING": "#66BB6A",
        "MATURITY": "#E69F45",
    }
    series = (
        ("Panicle Initiation / Booting · ≤ 12 hrs", (0.0, 0.025, 0.075, 0.125, 0.200, 0.225, 0.225), "dashed"),
        ("Panicle Initiation / Booting · > 12 hrs", (0.0, 0.045, 0.135, 0.225, 0.250, 0.300, 0.300), "solid"),
        ("FLOWERING · ≤ 12 hrs", (0.0, 0.035, 0.105, 0.175, 0.225, 0.325, 0.325), "dashed"),
        ("FLOWERING · > 12 hrs", (0.0, 0.055, 0.165, 0.275, 0.325, 0.425, 0.425), "solid"),
        ("MATURITY · ≤ 12 hrs", (0.0, 0.025, 0.075, 0.125, 0.150, 0.200, 0.200), "dashed"),
        ("MATURITY · > 12 hrs", (0.0, 0.035, 0.105, 0.175, 0.225, 0.275, 0.275), "solid"),
    )
    return {
        "title": "Strong Wind",
        "subtitle": "Typhoon-induced estimated yield loss by growth stage and exposure",
        "x_label": "Maximum sustained wind speed (kph)",
        "y_label": "Estimated yield loss (%)",
        "x_max": 225,
        "y_max": 50,
        "support_label": "Matrix support points and notebook interpolation",
        "series": [
            _curve_payload(
                label,
                WIND_SPEEDS,
                values,
                colors[label.split(" · ", 1)[0]],
                line_style,
            )
            for label, values, line_style in series
        ],
    }


def _flood_payload(water_label):
    colors = {
        "TILLERING": "#66BB6A",
        "Panicle Initiation / Booting · Partial": "#68BBE3",
        "Panicle Initiation / Booting · Complete": "#41818A",
        "FLOWERING": "#E69F45",
        "MATURITY": "#D25353",
        "RIPENING": "#A55E5E",
    }
    curves = {
        "TILLERING": (0.00, 0.10, 0.175, 0.25, 0.40, 1.00),
        "Panicle Initiation / Booting · Partial": (0.00, 0.10, 0.25, 0.475, 0.60, 1.00),
        "Panicle Initiation / Booting · Complete": (0.00, 0.20, 0.325, 0.55, 0.75, 1.00),
        "FLOWERING": (0.00, 0.125, 0.20, 0.25, 0.50, 1.00),
        "MATURITY": (0.00, 0.125, 0.20, 0.25, 0.50, 1.00),
        "RIPENING": (0.00, 0.00, 0.125, 0.175, 0.175, 0.20),
    }
    if water_label == "Muddy water":
        curves = {
            "TILLERING": (0.00, 0.15, 0.25, 0.40, 0.75, 1.00),
            "Panicle Initiation / Booting · Partial": (0.00, 0.15, 0.40, 0.625, 0.75, 1.00),
            "Panicle Initiation / Booting · Complete": (0.00, 0.225, 0.55, 0.625, 0.75, 1.00),
            "FLOWERING": (0.00, 0.225, 0.55, 0.70, 0.80, 1.00),
            "MATURITY": (0.00, 0.225, 0.55, 0.70, 0.80, 1.00),
            "RIPENING": (0.00, 0.05, 0.15, 0.225, 0.225, 0.30),
        }
    return {
        "title": f"Flooding · {water_label}",
        "subtitle": "Estimated yield loss by days submerged and standardized growth stage",
        "x_label": "Days submerged",
        "y_label": "Estimated yield loss (%)",
        "x_max": 10,
        "y_max": 100,
        "support_label": "Matrix support points; values beyond 7 days use the notebook ceiling assumption",
        "reference_line": 7,
        "series": [
            _curve_payload(label, FLOOD_DAYS, values, colors[label])
            for label, values in curves.items()
        ],
    }


def _table_hazard(key, title, chart_id, chart_type, columns, rows, note=""):
    """Describe one source-table view and its matching chart."""

    return {
        "key": key,
        "title": title,
        "chart_id": chart_id,
        "chart_type": chart_type,
        "columns": columns,
        "rows": rows,
        "note": note,
    }


def _rice_table_hazards():
    """Return the Palay/Rice rows transcribed from the 2021 matrix PDF."""

    wind_columns = [
        "Growth stage",
        "70–100 kph ≤12 hrs",
        "70–100 kph >12 hrs",
        "101–150 kph ≤12 hrs",
        "101–150 kph >12 hrs",
        ">150 kph ≤12 hrs",
        ">150 kph >12 hrs",
    ]
    wind_rows = [
        ["Booting", "< 10–15", "15–30", "15–25", "20–30", "15–30", "25–35"],
        ["Flowering", "10–25", "25–30", "15–30", "30–35", "25–40", "35–50"],
        ["Maturity", "< 10–15", "15–20", "10–20", "20–25", "15–25", "25–30"],
    ]
    flood_rows = [
        ["Min. Tillering / Max Tillering", "10", "15–20", "20–30", "30–50", "10–20", "20–30", "30–50", "50–100"],
        ["Panicle Initiation / Booting (partially inundated*)", "10", "20–30", "30–65", "40–80", "10–20", "30–50", "40–85", "50–100"],
        ["Panicle Initiation / Booting (completely inundated)", "15–25", "20–45", "30–80", "50–100", "15–30", "40–70", "40–85", "50–100"],
        ["Flowering stage / Maturity stage", "10–15", "15–25", "20–30", "30–70", "15–30", "40–70", "50–90", "60–100"],
        ["Ripening Stage", "0", "10–15", "15–20", "10–20", "5", "10–20", "15–30", "15–30"],
    ]
    clear_columns = ["Growth stage", "1–2 days", "3–4 days", "5–6 days", "7 days"]
    muddy_columns = ["Growth stage", "1–2 days", "3–4 days", "5–6 days", "7 days"]
    lodging_columns = ["Growth stage", "Lodging without water (< 7 days)", "Lodging with water (> 7 days)"]
    drought_columns = ["Growth stage", "Estimated yield loss (%)"]
    return [
        _table_hazard(
            "wind",
            "Strong Wind",
            "rice_wind",
            "line",
            wind_columns,
            wind_rows,
            "Estimated yield loss ranges (%) by maximum sustained wind and exposure duration.",
        ),
        _table_hazard(
            "flood_clear",
            "Flooding · Clear Water",
            "rice_flood_clear",
            "line",
            clear_columns,
            [[row[0], *row[1:5]] for row in flood_rows],
            "Clear-water flooding values from the matrix; growth-stage labels are retained as published.",
        ),
        _table_hazard(
            "flood_muddy",
            "Flooding · Muddy Water",
            "rice_flood_muddy",
            "line",
            muddy_columns,
            [[row[0], *row[5:9]] for row in flood_rows],
            "Muddy-water flooding values from the matrix; growth-stage labels are retained as published.",
        ),
        _table_hazard(
            "lodging",
            "Lodging",
            "rice_lodging",
            "line",
            lodging_columns,
            [
                ["Flowering / Milking stage", "45", "90"],
                ["Soft / Hard Dough", "25", "60"],
                ["Yellow Ripening", "15", "35"],
            ],
            "Estimated yield loss (%) by lodging condition.",
        ),
        _table_hazard(
            "drought",
            "Drought",
            "rice_drought",
            "line",
            drought_columns,
            [
                ["Seedlings (2 WAE)", "40"],
                ["Vegetative (7 WAE)", "50"],
                ["Reproductive (9 WAE)", "60"],
                ["Maturity (10–15 WAE)", "15"],
            ],
            "Estimated yield loss (%) by growth stage.",
        ),
    ]


def _corn_table_hazards():
    """Return the Corn rows transcribed from the 2021 matrix PDF."""

    return [
        _table_hazard(
            "wind",
            "Strong Wind",
            "corn_wind",
            "line",
            [
                "Growth stage",
                "70–100 kph ≤12 hrs",
                "70–100 kph >12 hrs",
                "101–150 kph ≤12 hrs",
                "101–150 kph >12 hrs",
                ">150 kph ≤12 hrs",
                ">150 kph >12 hrs",
            ],
            [
                ["Vegetative*", "5", "15", "20", "25", "40", "50"],
                ["Reproductive**", "10", "50", "55", "60", "80", "100"],
                ["Maturity**", "10", "15", "25", "30", "60", "75"],
            ],
            "Estimated yield loss ranges (%) by maximum sustained wind and exposure duration.",
        ),
        _table_hazard(
            "flood",
            "Flooding",
            "corn_flood",
            "line",
            ["Growth stage", "1–2 days", "3–4 days", "5–6 days", "7 days"],
            [
                ["Newly Planted*", "10", "75", "100", "100"],
                ["Seedling*", "10", "50", "100", "100"],
                ["Vegetative*", "10", "50", "100", "100"],
                ["Reproductive**", "80", "90", "100", "100"],
                ["Maturity**", "70", "80", "90", "100"],
            ],
            "Estimated yield loss (%) by days of submergence.",
        ),
        _table_hazard(
            "drought",
            "Drought",
            "corn_drought",
            "line",
            ["Growth stage", "2–3 weeks", "4–5 weeks", "6–7 weeks", "8 weeks"],
            [
                ["Newly Planted*", "25", "50", "100", "100"],
                ["Seedling**", "10", "15", "20", "25"],
                ["Vegetative**", "5", "20", "30", "50"],
                ["Reproductive***", "10", "30", "50", "100"],
                ["Maturity***", "3", "5", "10", "15"],
            ],
            "Estimated yield loss (%) by weeks of exposure.",
        ),
    ]


def build_damage_matrix_payload():
    """Return source tables and matching graph configurations for Rice and Corn."""

    rice_wind = _wind_payload()
    rice_flood_clear = _flood_payload("Clear water")
    rice_flood_muddy = _flood_payload("Muddy water")
    rice_lodging = _categorical_line_payload(
        "Lodging",
        "Estimated yield loss by water condition and growth stage",
        ["Without water (< 7 days)", "With water (> 7 days)"],
        {
            "Flowering / Milking stage": (45, 90),
            "Soft / Hard Dough": (25, 60),
            "Yellow Ripening": (15, 35),
        },
        {
            "Flowering / Milking stage": "#66BB6A",
            "Soft / Hard Dough": "#E69F45",
            "Yellow Ripening": "#68BBE3",
        },
        "Matrix lodging values connected to the zero-loss baseline for consistent stage-line comparison.",
    )
    rice_drought = _categorical_line_payload(
        "Drought",
        "Estimated yield loss by growth stage",
        ["Baseline (no drought)", "Drought exposure"],
        {
            "Seedlings (2 WAE)": (0, 40),
            "Vegetative (7 WAE)": (0, 50),
            "Reproductive (9 WAE)": (0, 60),
            "Maturity (10–15 WAE)": (0, 15),
        },
        {
            "Seedlings (2 WAE)": "#68BBE3",
            "Vegetative (7 WAE)": "#66BB6A",
            "Reproductive (9 WAE)": "#E69F45",
            "Maturity (10–15 WAE)": "#D25353",
        },
        "Matrix drought values connected to the zero-loss baseline for consistent stage-line comparison.",
    )
    corn_wind = _crop_wind_payload(
        "Corn",
        {
            "VEGETATIVE": (5, 15, 20, 25, 40, 50),
            "REPRODUCTIVE": (10, 50, 55, 60, 80, 100),
            "MATURITY": (10, 15, 25, 30, 60, 75),
        },
    )
    corn_flood = _single_flood_payload(
        "Corn",
        {
            "NEWLY PLANTED": (10, 75, 100, 100),
            "SEEDLING": (10, 50, 100, 100),
            "VEGETATIVE": (10, 50, 100, 100),
            "REPRODUCTIVE": (80, 90, 100, 100),
            "MATURITY": (70, 80, 90, 100),
        },
    )
    corn_drought = _crop_drought_payload(
        "Corn",
        {
            "NEWLY PLANTED": (25, 50, 100, 100),
            "SEEDLING": (10, 15, 20, 25),
            "VEGETATIVE": (5, 20, 30, 50),
            "REPRODUCTIVE": (10, 30, 50, 100),
            "MATURITY": (3, 5, 10, 15),
        },
    )
    return {
        "source": "2021 DA damage matrix tables: Palay (Rice) and Corn",
        "method": "Wind, flooding, and Corn drought lines use monotone PCHIP interpolation from the notebook support points; Palay lodging and drought connect their matrix values to a zero-loss baseline for consistent stage-line comparison.",
        "tables": {
            "rice": {
                "label": "Palay / Rice",
                "source": "Palay damage matrix tables (2021)",
                "hazards": _rice_table_hazards(),
            },
            "corn": {
                "label": "Corn",
                "source": "Corn damage matrix tables (2021)",
                "hazards": _corn_table_hazards(),
            },
        },
        "charts": {
            "rice_wind": rice_wind,
            "rice_flood_clear": rice_flood_clear,
            "rice_flood_muddy": rice_flood_muddy,
            "rice_lodging": rice_lodging,
            "rice_drought": rice_drought,
            "corn_wind": corn_wind,
            "corn_flood": corn_flood,
            "corn_drought": corn_drought,
        },
    }
