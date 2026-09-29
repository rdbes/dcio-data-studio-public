"""Access policy for the local data-manager workflow."""

from functools import wraps

from django.contrib.auth.views import redirect_to_login
from django.core.exceptions import PermissionDenied

VIEWER_GROUP = "Viewer"
DATA_MANAGER_GROUP = "Data Manager"


def _is_authenticated(user) -> bool:
    return bool(user and user.is_authenticated)


def is_viewer(user) -> bool:
    """Return whether a user may access read-only analytics pages."""
    if not _is_authenticated(user):
        return False
    if is_data_manager(user):
        return True
    return user.groups.filter(name=VIEWER_GROUP).exists()


def is_data_manager(user) -> bool:
    """Return whether a user may access local import workflows."""
    if not _is_authenticated(user):
        return False
    if user.is_superuser:
        return True
    return user.groups.filter(name=DATA_MANAGER_GROUP).exists()


def can_access_admin_link(user) -> bool:
    """Return whether the user should see Django's administration link."""
    return bool(_is_authenticated(user) and user.is_staff and is_data_manager(user))


def access_context(request):
    """Expose role-based navigation flags without duplicating policy in templates."""
    user = getattr(request, "user", None)
    can_manage = is_data_manager(user)
    can_view = can_manage or bool(
        _is_authenticated(user)
        and user.groups.filter(name=VIEWER_GROUP).exists()
    )
    return {
        "can_view_analytics": can_view,
        "can_manage_reports": can_manage,
        "can_access_admin_link": can_access_admin_link(user),
    }


def _role_required(predicate):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            if not _is_authenticated(request.user):
                return redirect_to_login(request.get_full_path())
            if not predicate(request.user):
                raise PermissionDenied
            return view_func(request, *args, **kwargs)

        return wrapped

    return decorator


viewer_required = _role_required(is_viewer)
data_manager_required = _role_required(is_data_manager)
