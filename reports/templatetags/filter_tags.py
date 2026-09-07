from __future__ import annotations

from typing import Any

from django import template

from reports.analytics.formatting import title_case_label

register = template.Library()


@register.filter("title_case_label")
def title_case_label_filter(value: Any) -> str:
    """Render filter labels in consistent title case without losing codes."""
    return title_case_label(value)


@register.inclusion_tag("partials/filter_option.html")
def render_filter_option(
    label: Any,
    value: Any = "",
    parent: Any = None,
    css_class: str | None = None,
) -> dict[str, Any]:
    """Render a reusable analytics filter-option button primitive."""
    return {
        "label": "" if label is None else str(label),
        "value": "" if value is None else str(value),
        "parent": parent,
        "css_class": css_class,
    }
