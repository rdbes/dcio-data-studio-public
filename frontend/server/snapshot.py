"""Reconstruct a disposable query index from validated public data only.

The local database, user records and import lineage are never accessed here.
Every serving connection opens the completed index in SQLite read-only mode.
"""

import json
import os
import tempfile
from pathlib import Path

from django.conf import settings
from django.db import connections, transaction

from reports import models
from scripts.validate_public_release import validate_manifest

COLLECTION_MODELS = {
    "hazards": models.RefHazard,
    "commodities": models.RefCommodity,
    "locations": models.RefPsgcLocation,
    "incidents": models.DisasterIncident,
    "damage_reports": models.DamageReport,
    "tropical_cyclones": models.TropicalCyclone,
    "tropical_cyclone_track_points": models.TropicalCycloneTrackPoint,
    "incident_cyclone_links": models.DisasterIncidentTropicalCyclone,
}


def initialize_snapshot():
    release_dir = Path(os.environ.get(
        "PUBLIC_RELEASE_DIR", settings.BASE_DIR / "data" / "releases",
    ))
    manifest_path = release_dir / "current.json"
    manifest = json.loads(manifest_path.read_text())
    data_url = manifest.get("data_url")
    if not isinstance(data_url, str) or Path(data_url).name != data_url:
        raise RuntimeError("Invalid public release filename.")
    release_bytes = (release_dir / data_url).read_bytes()
    release = json.loads(release_bytes)
    # Full schema and relationship validation runs when packaging. Verify the
    # exact packaged bytes here without revalidating every row on cold starts.
    validate_manifest(manifest, release, release_bytes)
    if release["schema_version"] != "1.2.0" or release.get("read_only") is not True:
        raise RuntimeError("The shared public renderer requires a schema 1.2.0 release.")
    # Content-addressed paths keep different deployments isolated on warm hosts.
    path = Path(settings.DATABASES["default"]["NAME"])
    path = path.with_name(f"{path.stem}-{manifest['sha256'][:16]}{path.suffix}")
    if not path.exists():
        # Serverless workers can reuse process IDs after an interrupted import.
        # Never reopen a partial index left behind by a previous worker.
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.stem}-", suffix=".tmp", dir=path.parent,
        )
        os.close(descriptor)
        temporary = Path(temporary_name)
        config = settings.DATABASES["default"].copy()
        config["NAME"] = str(temporary)
        connections.databases["snapshot_builder"] = config
        connection = connections["snapshot_builder"]
        connection.close()
        connection.settings_dict.update(config)
        quote = connection.ops.quote_name
        try:
            # A single transaction avoids a disk sync for each release row on
            # serverless cold starts. The index is published only when complete.
            with transaction.atomic(using="snapshot_builder"), connection.cursor() as cursor:
                for collection, model in COLLECTION_MODELS.items():
                    fields = list(model._meta.concrete_fields)
                    columns = []
                    for field in fields:
                        # Operational fields remain empty; only approved release
                        # properties are inserted. No private tables are created.
                        data_type = field.db_type(connection)
                        primary = " PRIMARY KEY" if field.primary_key else ""
                        columns.append(f"{quote(field.column)} {data_type}{primary}")
                    table = quote(model._meta.db_table)
                    cursor.execute(f"CREATE TABLE {table} ({', '.join(columns)})")
                    rows = []
                    for source in release[collection]:
                        row = []
                        for field in fields:
                            value = source.get(field.name)
                            if field.name == "is_active":
                                value = True
                            elif field.name in {"created_at", "updated_at"}:
                                value = release["generated_at"]
                            row.append(field.get_db_prep_save(value, connection))
                        rows.append(row)
                    placeholders = ", ".join(["%s"] * len(fields))
                    names = ", ".join(quote(f.column) for f in fields)
                    cursor.executemany(f"INSERT INTO {table} ({names}) VALUES ({placeholders})", rows)
                    for field in fields:
                        if field.is_relation:
                            index = quote(f"{model._meta.db_table}_{field.column}_idx")
                            cursor.execute(f"CREATE INDEX {index} ON {table} ({quote(field.column)})")
            connection.close()
            os.replace(temporary, path)
        finally:
            connection.close()
            temporary.unlink(missing_ok=True)
    connections["default"].close()
    config = connections["default"].settings_dict
    config["NAME"] = f"file:{path}?mode=ro&immutable=1"
    config["OPTIONS"] = {"uri": True}
