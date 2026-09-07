"""Canonical province/HUC reporting-area rules shared by map data and assets."""

NCR_REGION_CODE = "1300000000"
NCR_REGION_NAME = "National Capital Region (NCR)"
NCR_REPORTING_NAME = "NCR"

CITY_OF_ISABELA_LOCATION_CODE = "0990101000"
CITY_OF_ISABELA_REPORTING_CODE = "0990100000"

REPORTING_AREA_NAME_OVERRIDES = {
    NCR_REGION_CODE: NCR_REPORTING_NAME,
    CITY_OF_ISABELA_REPORTING_CODE: "City of Isabela",
}
REPORTING_AREA_FILTER_NAME_OVERRIDES = {
    "City of Isabela (Not a Province)": "City of Isabela",
}


def reporting_area_code_for_location(
    *,
    location_code: str,
    region_code: str,
    city_class: str = "",
) -> str:
    """Return the reporting-area key for a current PSGC location."""
    if region_code == NCR_REGION_CODE:
        return NCR_REGION_CODE
    if location_code == CITY_OF_ISABELA_LOCATION_CODE:
        return CITY_OF_ISABELA_REPORTING_CODE
    if city_class.upper() == "HUC":
        return location_code
    return f"{location_code[:5]}00000"


def reporting_area_display_name(psgc_code: str, fallback: str) -> str:
    return REPORTING_AREA_NAME_OVERRIDES.get(psgc_code, fallback)


def reporting_area_filter_label(database_name: str) -> str:
    return REPORTING_AREA_FILTER_NAME_OVERRIDES.get(database_name, database_name)
