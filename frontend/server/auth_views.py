"""Supabase Auth views for the Vercel public renderer."""

from functools import wraps

from django.contrib.auth.views import redirect_to_login
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods

from .supabase_auth import (
    SupabaseLoginForm,
    attach_session_cookie,
    authenticate_credentials,
    clear_session_cookie,
    safe_next_url,
)


@require_http_methods(["GET", "POST"])
def login(request):
    if getattr(request.user, "is_authenticated", False):
        return redirect(safe_next_url(request, request.GET.get("next")))
    form = SupabaseLoginForm(request.POST or None)
    next_url = request.POST.get("next") or request.GET.get("next") or ""
    if request.method == "POST" and form.is_valid():
        session = authenticate_credentials(
            form.cleaned_data["username"],
            form.cleaned_data["password"],
        )
        if session and session.get("access_token"):
            response = redirect(safe_next_url(request, next_url))
            return attach_session_cookie(response, session)
        form.add_error(None, "Sign-in failed. Check your email and password.")
    return render(request, "registration/login.html", {"form": form, "next": next_url})


@require_http_methods(["POST"])
def logout(request):
    response = redirect("login")
    return clear_session_cookie(response)


def supabase_login_required(view_func):
    """Require a valid Supabase session for selected public-renderer routes."""

    @wraps(view_func)
    def wrapped(request, *args, **kwargs):
        if not getattr(request.user, "is_authenticated", False):
            return redirect_to_login(request.get_full_path(), reverse("login"))
        return view_func(request, *args, **kwargs)

    return wrapped
