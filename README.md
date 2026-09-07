# DCIO Data Studio Public Site

This is the isolated public deployment package for DCIO Data Studio. It uses
the same public Django views, templates, styles and chart/map scripts as the
local workspace. Only Dashboard, Analytics, Incidents and TC Tracks are routed.

The only data input is the validated schema 1.2 JSON release referenced by
`data/releases/current.json`. On startup the renderer verifies the exact bytes
and constructs a disposable SQLite query index, opened in immutable read-only
mode. It has no PostgreSQL connection, local credentials, user records, import
lineage, upload routes or administration endpoints. State-changing requests
are rejected. Files under `public/` are the only static files served by Vercel.

The package is built in the local source repository with `npm run build:public`
and `npm run package:public`. Future design changes should be made in the shared
local templates and assets, then repackaged here. Do not fork the public UI.

Validation: isolated renderer integration tests; shared-template and asset
checks; local/public map and chart comparisons; desktop and mobile visual QA.
