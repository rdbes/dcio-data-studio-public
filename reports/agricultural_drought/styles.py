"""Authoritative application copies of the confirmed drought QML classes."""


# Map colors are the established product palette. Report cells use the softer
# print palette below while retaining the same semantic category keys.
DROUGHT_ALERT_COLOR = "#ee171e"
DROUGHT_WARNING_COLOR = "#fd9e45"
DROUGHT_WATCH_COLOR = "#f5e964"
DROUGHT_NORMAL_COLOR = "#25d625"
RAINFALL_ABOVE_NORMAL_COLOR = "#38bdf8"

REPORT_ALERT_COLOR = "#da6c6c"
REPORT_WARNING_COLOR = "#e9a45e"
REPORT_WATCH_COLOR = "#e8d76a"
REPORT_NORMAL_COLOR = "#66bb6a"
REPORT_ABOVE_NORMAL_COLOR = "#73b9df"
# Status text follows the established export-cell semantic colors.
REPORT_STATUS_YELLOW_TEXT = "#ffda62"
REPORT_STATUS_NORMAL_TEXT = "#159413"
REPORT_STATUS_MISSING_TEXT = "#a1a1aa"


def report_status_fill_color(label, swatch=""):
    """Return the print-palette highlight used behind report status labels."""

    key = str(label or "").strip().casefold()
    if key in {"", "no data"}:
        return ""
    if key in {"normal", "none"}:
        return REPORT_NORMAL_COLOR
    if key in {"mild", "developing", "watch"}:
        return REPORT_WATCH_COLOR
    if key in {"warning", "continuing"}:
        return REPORT_WARNING_COLOR
    if key in {"alert", "moderate", "severe", "extreme", "intensifying"}:
        return REPORT_ALERT_COLOR
    return str(swatch or "")

SVTR_LEGEND = (
    {"key": "alert", "label": "Alert", "color": DROUGHT_ALERT_COLOR, "rule": "<= -2.0"},
    {
        "key": "warning",
        "label": "Warning",
        "color": DROUGHT_WARNING_COLOR,
        "rule": "> -2.0 to <= -1.0",
    },
    {
        "key": "watch",
        "label": "Watch",
        "color": DROUGHT_WATCH_COLOR,
        "rule": "> -1.0 to <= -0.5",
    },
    {"key": "normal", "label": "Normal", "color": DROUGHT_NORMAL_COLOR, "rule": "> -0.5"},
)

CDI_LEGEND = (
    {"code": 0, "key": "normal", "label": "Normal", "color": DROUGHT_NORMAL_COLOR},
    {"code": 1, "key": "mild", "label": "Mild", "color": DROUGHT_WATCH_COLOR},
    {"code": 2, "key": "moderate", "label": "Moderate", "color": DROUGHT_WARNING_COLOR},
    {"code": 3, "key": "severe", "label": "Severe", "color": "#df5d1c"},
    {"code": 4, "key": "extreme", "label": "Extreme", "color": "#ee1b1e"},
)

OUTLOOK_LEGEND = (
    {"code": 0, "key": "none", "label": "None", "color": REPORT_STATUS_NORMAL_TEXT},
    {
        "code": 1,
        "key": "developing",
        "label": "Developing",
        "color": "#f3ff01",
    },
    {
        "code": 2,
        "key": "intensifying",
        "label": "Ongoing and likely to intensify",
        "color": "#ff0123",
    },
    {
        "code": 3,
        "key": "continuing",
        "label": "Ongoing and likely to continue",
        "color": "#ff7c01",
    },
    {"code": 4, "key": "waning", "label": "Waning", "color": "#9a0076"},
    {"code": 5, "key": "ending", "label": "Ending", "color": "#0d33ba"},
)

PERCENT_NORMAL_LEGEND = (
    {
        "key": "way_below_normal",
        "label": "Way below normal",
        "color": DROUGHT_ALERT_COLOR,
        "rule": "< 40%",
    },
    {
        "key": "below_normal",
        "label": "Below normal",
        "color": DROUGHT_WATCH_COLOR,
        "rule": "≥ 40% to < 81%",
    },
    {
        "key": "near_normal",
        "label": "Near normal",
        "color": DROUGHT_NORMAL_COLOR,
        "rule": "≥ 81% to ≤ 120%",
    },
    {
        "key": "above_normal",
        "label": "Above normal",
        "color": RAINFALL_ABOVE_NORMAL_COLOR,
        "rule": "> 120%",
    },
)

REPORT_SVTR_LEGEND = tuple(
    {**item, "color": color}
    for item, color in zip(
        SVTR_LEGEND,
        (
            REPORT_ALERT_COLOR,
            REPORT_WARNING_COLOR,
            REPORT_WATCH_COLOR,
            REPORT_NORMAL_COLOR,
        ),
    )
)

REPORT_PERCENT_NORMAL_LEGEND = tuple(
    {**item, "color": color}
    for item, color in zip(
        PERCENT_NORMAL_LEGEND,
        (
            REPORT_ALERT_COLOR,
            REPORT_WATCH_COLOR,
            REPORT_NORMAL_COLOR,
            REPORT_ABOVE_NORMAL_COLOR,
        ),
    )
)

PAGASA_CONDITION_LEGEND = (
    {
        "key": "dry_condition",
        "label": "Dry condition",
        "color": "#fff3a6",
    },
    {
        "key": "dry_spell",
        "label": "Dry spell",
        "color": "#ffd08a",
    },
    {
        "key": "drought",
        "label": "Drought",
        "color": "#f5a3a3",
    },
)

PRODUCT_LEGENDS = {
    "svtr": SVTR_LEGEND,
    "cdi": CDI_LEGEND,
    "outlook": OUTLOOK_LEGEND,
    "percent_normal": PERCENT_NORMAL_LEGEND,
}


def svtr_category(value):
    """Return the QML category key using the confirmed inclusive thresholds."""

    if value is None:
        return "nodata"
    if value <= -2:
        return "alert"
    if value <= -1:
        return "warning"
    if value <= -0.5:
        return "watch"
    return "normal"


def percent_normal_category(value):
    """Return the PAGASA percent-normal category for a numeric value."""

    if value is None:
        return None
    if value < 40:
        return "way_below_normal"
    if value < 81:
        return "below_normal"
    if value <= 120:
        return "near_normal"
    return "above_normal"


def legend_for(product):
    """Return a mutable presentation copy of one confirmed QML legend."""

    return list(PRODUCT_LEGENDS[product])
