# DCIO Data Studio Public Site

This repository contains the static public deployment package for DCIO Data
Studio. It contains no Django application, database credentials, upload tools,
or private operational data.

The release manifest is `data/releases/current.json`. It points to the
immutable, validated release file for this deployment. The public site is
read-only; data updates are published by replacing this package with the next
validated release.
