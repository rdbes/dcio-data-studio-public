from decimal import Decimal, InvalidOperation

from django import template
from django.urls import NoReverseMatch, reverse

from reports.constants import (
    IMPORT_STATUS_BADGE_CLASSES,
    VALIDATION_STATUS_BADGE_CLASSES,
    ImportStatus,
    ValidationStatus,
)

register = template.Library()


@register.inclusion_tag("partials/button.html")
def render_button(
    label,
    variant="primary",
    href=None,
    type="button",
    small=False,
    extra_classes="",
    loading_var="",
    loading_label="",
    icon="",
    form_id="",
    disabled=False,
    title="",
    aria_label="",
    disabled_when="",
    disabled_class_when="",
    confirm_title="",
    confirm_message="",
    confirm_text="",
    confirm_class="",
    confirm_icon_class="",
    confirm_form_id="",
    scroll_target="",
    dialog_id="",
):
    """Render a consistently styled button or link styled as a button."""
    if variant == "primary" and not icon:
        icon = "fa-solid fa-arrow-right"

    variants = {
        "primary": "shadow-xs",
        "secondary": "shadow-2xs",
        "outline": "",
        "ghost": "",
        "danger": "shadow-2xs",
        "success": "shadow-2xs",
    }
    size = "ui-button--small" if small else ""
    classes = (
        f"ui-button ui-button--{variant} "
        f"inline-flex items-center justify-center gap-2 {size} font-semibold "
        f"cursor-pointer {variants.get(variant, variants['primary'])}"
    )
    if extra_classes:
        classes = f"{classes} {extra_classes}"
    return {
        "label": label,
        "href": href,
        "type": type,
        "classes": classes,
        "loading_var": loading_var,
        "loading_label": loading_label or label,
        "icon": icon,
        "form_id": form_id,
        "disabled": disabled,
        "title": title,
        "aria_label": aria_label,
        "disabled_when": disabled_when,
        "disabled_class_when": disabled_class_when,
        "confirm_title": confirm_title,
        "confirm_message": confirm_message,
        "confirm_text": confirm_text,
        "confirm_class": confirm_class,
        "confirm_icon_class": confirm_icon_class,
        "confirm_form_id": confirm_form_id,
        "scroll_target": scroll_target,
        "dialog_id": dialog_id,
    }


_HISTORICAL_STEP_DEFS = [
    # (step_number, label, url_name, needs_batch_id)
    (1, "Upload", "reports:staging_summary", True),
    (2, "Incidents", "reports:incident_review", True),
    (3, "Check", "reports:validation_results", True),
    (4, "Import", "reports:import_controls", True),
]

_CURRENT_STEP_DEFS = [
    (1, "Upload", "reports:staging_summary", True),
    (2, "Check", "reports:validation_results", True),
    (3, "Import", "reports:import_controls", True),
]


@register.inclusion_tag("partials/stepper.html")
def render_stepper(batch, current_step: int) -> dict:
    """Render status-driven current and historical workflow progress."""
    is_current_mode = bool(
        batch
        and getattr(batch, "import_type", "")
        == "User Upload"
    )

    if is_current_mode:
        step_defs = _CURRENT_STEP_DEFS
        if current_step == 3:
            current_step = 2
        elif current_step == 4:
            current_step = 3
    else:
        step_defs = _HISTORICAL_STEP_DEFS

    last_step_num = len(step_defs)
    validation_step = 2 if is_current_mode else 3

    if not batch or not hasattr(batch, "import_status"):
        locked = False
        progress_step = 1
        val_failed = False
    else:
        locked = (
            batch.import_status
            == ImportStatus.IMPORTED
        )
        from reports.services import workflow_step_number

        progress_step = workflow_step_number(
            getattr(batch, "import_type", ""),
            str(batch.import_status or ""),
        )
        progress_step = min(
            max(progress_step, 1),
            last_step_num,
        )
        val_failed = (
            batch.validation_status
            == ValidationStatus.FAILED
        )

    steps = []

    for n, label, url_name, needs_batch_id in step_defs:
        viewing_previous = (
            n == current_step
            and n != progress_step
        )
        failed = (
            not locked
            and val_failed
            and n == validation_step
            and progress_step >= validation_step
        )

        if locked:
            css_class = "is-complete is-locked"
        elif failed:
            css_class = "is-failed"
        elif n < progress_step:
            css_class = "is-complete"
        elif n == progress_step:
            css_class = "is-current"
        else:
            css_class = "is-pending"

        if (
            not locked
            and n < progress_step
        ):
            css_class = (
                f"{css_class} is-progressed"
            )

        if (
            not locked
            and viewing_previous
        ):
            css_class = (
                f"{css_class} is-viewing"
            )

        if locked or n == current_step:
            navigable = False
        else:
            navigable = n <= progress_step

        url = None
        if navigable:
            try:
                batch_key = getattr(
                    batch,
                    "import_batch_key",
                    None,
                )
                if needs_batch_id and batch_key:
                    url = reverse(
                        url_name,
                        args=[batch_key],
                    )
                elif not needs_batch_id:
                    url = reverse(url_name)
            except NoReverseMatch:
                url = None

        if locked or "is-complete" in css_class:
            circle = "✓"
        elif failed:
            circle = "!"
        else:
            circle = str(n)

        if locked:
            state = (
                ImportStatus.IMPORTED
                if n == last_step_num
                else "Complete"
            )
        elif failed:
            state = "Needs review"
        elif "is-complete" in css_class:
            state = "Complete"
        elif n == progress_step:
            state = "Current"
        else:
            state = ValidationStatus.PENDING

        if locked:
            title = (
                f"{label} — batch is fully imported"
            )
        elif failed:
            title = (
                "Validation failed — "
                "click to review findings"
            )
        elif n == progress_step:
            title = (
                f"{label} — current workflow step"
            )
        elif n == current_step:
            title = (
                f"{label} — viewing previous step"
            )
        elif navigable:
            title = f"Return to {label}"
        else:
            title = (
                f"{label} — complete earlier "
                "steps first"
            )

        steps.append(
            {
                "n": n,
                "label": label,
                "css_class": css_class,
                "url": url,
                "circle": circle,
                "state": state,
                "title": title,
            }
        )

    return {
        "steps": steps,
        "locked": locked,
    }


@register.filter
def import_status_class(status):
    """Return a CSS class for import status badges."""
    return IMPORT_STATUS_BADGE_CLASSES.get(status, "badge-secondary")


@register.filter
def validation_status_class(status):
    """Return a CSS class for validation status badges."""
    return VALIDATION_STATUS_BADGE_CLASSES.get(status, "badge-secondary")


@register.filter
def readable_name(value):
    """Turn stored field identifiers into concise operator-facing labels."""
    if not value:
        return "-"
    return str(value).replace("_", " ").replace(" + ", " / ").title()


@register.filter
def dash_zero(value, decimal_places=2):
    """
    Display zero, blank, or null numeric values as "-".

    Non-zero numeric values are displayed with comma separators and fixed
    decimal places.

    Examples:
        0       -> -
        0.00    -> -
        None    -> -
        1500    -> 1,500.00
        1500.5  -> 1,500.50
    """
    if value is None or value == "":
        return "-"

    try:
        number = Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError, TypeError, AttributeError):
        return value

    if number == 0:
        return "-"

    try:
        decimal_places = int(decimal_places)
    except (ValueError, TypeError):
        decimal_places = 2

    return f"{number:,.{decimal_places}f}"
