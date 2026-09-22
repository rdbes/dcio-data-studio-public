"""Dependency-light PDF export for the dam water-level monitoring report.

The page already consumes the source chart payloads directly.  This renderer
keeps the export self-contained so the PDF endpoint does not require a browser
runtime or a third-party PDF package in the application environment.
"""

from __future__ import annotations

import base64
import math
import re
import struct
import zlib
from datetime import date, datetime
from zoneinfo import ZoneInfo

from reports.dam_water_levels_source import PAGASA_DAM_PAGE_URL

PAGE_WIDTH = 841.89
PAGE_HEIGHT = 595.28
PAGE_MARGIN = 28.0
CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2)

WHITE = "#FFFFFF"
OFF_WHITE = "#FAFAF9"
GRID = "#E4E4E7"
TEXT = "#27272A"
MUTED = "#71717A"
BLUE = "#2563EB"
GREEN = "#16A34A"
RED = "#DC2626"
YELLOW = "#EAB308"
PAST_OLDER = "#AEB7C2"
PAST_NEWER = "#4B5563"
CURRENT_YEAR = "#99D1FF"
MANILA_TIMEZONE = ZoneInfo("Asia/Manila")

MONTH_LABELS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
MONTH_DAYS = (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
QUARTER_START_MONTHS = (1, 4, 7, 10)
MAX_RENDERED_CHARTS = 12
MAX_RENDERED_CHART_BYTES = 2_500_000
MAX_RENDERED_CHART_PIXELS = 4_000_000

REFERENCE_SERIES_ORDER = ("rc", "lwl", "nhwl")
SERIES_COLORS = {
    "rc": YELLOW,
    "lwl": RED,
    "nhwl": GREEN,
}
SERIES_LABELS = {
    "rc": "Rule Curve",
    "lwl": "Low Water Level",
    "nhwl": "Normal High Water Level",
}


def _ascii(value):
    replacements = {
        "\u2013": "-",
        "\u2014": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u00b7": "|",
        "\u00a0": " ",
    }
    text = "" if value is None else str(value)
    for source, replacement in replacements.items():
        text = text.replace(source, replacement)
    return text.encode("ascii", "replace").decode("ascii")


def _escape(value):
    return _ascii(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _color(value, fallback=TEXT):
    text = str(value or fallback).strip().lstrip("#")
    if len(text) != 6:
        text = fallback.lstrip("#")
    try:
        return tuple(int(text[index:index + 2], 16) / 255 for index in (0, 2, 4))
    except ValueError:
        return _color(fallback, TEXT)


def _rgb(value, fallback=TEXT):
    red, green, blue = _color(value, fallback)
    return f"{red:.4f} {green:.4f} {blue:.4f}"


def _text_width(value, size, bold=False, mono=False):
    # Standard Helvetica is close enough for centering labels without
    # embedding a font, and keeping the estimate deterministic is useful for
    # the small chart labels.
    if mono:
        return len(_ascii(value)) * size * 0.60
    factor = 0.54 if bold else 0.50
    return len(_ascii(value)) * size * factor


def _fmt_number(value, decimals=2):
    if value is None:
        return "-"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "-"
    if not math.isfinite(number):
        return "-"
    return f"{number:.{decimals}f}"


def _number(value):
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _decode_png(content):
    """Decode an 8-bit, non-interlaced PNG into RGB bytes."""

    signature = b"\x89PNG\r\n\x1a\n"
    if not isinstance(content, (bytes, bytearray)) or not content.startswith(signature):
        return None
    index = len(signature)
    width = height = bit_depth = color_type = interlace = None
    palette = None
    transparency = None
    image_data = bytearray()
    while index + 12 <= len(content):
        chunk_length = struct.unpack(">I", content[index:index + 4])[0]
        chunk_start = index + 8
        chunk_end = chunk_start + chunk_length
        if chunk_end + 4 > len(content):
            return None
        chunk_type = content[index + 4:index + 8]
        chunk = content[chunk_start:chunk_end]
        index = chunk_end + 4
        if chunk_type == b"IHDR" and len(chunk) == 13:
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
        elif chunk_type == b"PLTE":
            palette = [tuple(chunk[offset:offset + 3]) for offset in range(0, len(chunk), 3)]
        elif chunk_type == b"tRNS":
            transparency = bytes(chunk)
        elif chunk_type == b"IDAT":
            image_data.extend(chunk)
        elif chunk_type == b"IEND":
            break

    if (
        not width
        or not height
        or bit_depth != 8
        or interlace != 0
        or color_type not in {0, 2, 3, 4, 6}
        or width * height > MAX_RENDERED_CHART_PIXELS
        or not image_data
    ):
        return None
    bytes_per_pixel = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    row_length = width * bytes_per_pixel
    try:
        decoded = zlib.decompress(bytes(image_data))
    except zlib.error:
        return None
    if len(decoded) != height * (row_length + 1):
        return None

    rows = []
    previous = bytearray(row_length)
    offset = 0
    for _ in range(height):
        filter_type = decoded[offset]
        encoded = decoded[offset + 1:offset + 1 + row_length]
        offset += row_length + 1
        current = bytearray(encoded)
        for position in range(row_length):
            left = current[position - bytes_per_pixel] if position >= bytes_per_pixel else 0
            above = previous[position]
            upper_left = previous[position - bytes_per_pixel] if position >= bytes_per_pixel else 0
            if filter_type == 1:
                current[position] = (current[position] + left) & 0xFF
            elif filter_type == 2:
                current[position] = (current[position] + above) & 0xFF
            elif filter_type == 3:
                current[position] = (current[position] + ((left + above) // 2)) & 0xFF
            elif filter_type == 4:
                estimate = left + above - upper_left
                left_distance = abs(estimate - left)
                above_distance = abs(estimate - above)
                upper_left_distance = abs(estimate - upper_left)
                predictor = (
                    left
                    if left_distance <= above_distance and left_distance <= upper_left_distance
                    else above
                    if above_distance <= upper_left_distance
                    else upper_left
                )
                current[position] = (current[position] + predictor) & 0xFF
            elif filter_type != 0:
                return None
        rows.append(current)
        previous = current

    def rgba(red, green, blue, alpha=255):
        if alpha == 255:
            return red, green, blue
        return (
            (red * alpha + 255 * (255 - alpha)) // 255,
            (green * alpha + 255 * (255 - alpha)) // 255,
            (blue * alpha + 255 * (255 - alpha)) // 255,
        )

    pixels = bytearray()
    for row in rows:
        if color_type == 0:
            pixels.extend(channel for channel in row for _ in range(3))
        elif color_type == 2:
            pixels.extend(row)
        elif color_type == 3:
            if not palette:
                return None
            for palette_index in row:
                if palette_index >= len(palette):
                    return None
                alpha = transparency[palette_index] if transparency and palette_index < len(transparency) else 255
                pixels.extend(rgba(*palette[palette_index], alpha))
        elif color_type == 4:
            for position in range(0, len(row), 2):
                pixels.extend(rgba(row[position], row[position], row[position], row[position + 1]))
        else:
            for position in range(0, len(row), 4):
                pixels.extend(rgba(*row[position:position + 3], row[position + 3]))
    return width, height, bytes(pixels)


def decode_rendered_chart_images(raw_images):
    """Decode browser-rendered chart images supplied to the PDF endpoint."""

    if not isinstance(raw_images, list):
        return {}

    rendered = {}
    for raw_image in raw_images[:MAX_RENDERED_CHARTS]:
        if not isinstance(raw_image, dict):
            continue
        name = str(raw_image.get("dam_name") or "").strip()
        if not name or len(name) > 80 or name in rendered:
            continue
        try:
            width = int(raw_image.get("width"))
            height = int(raw_image.get("height"))
        except (TypeError, ValueError):
            continue
        if not 1 <= width <= 5000 or not 1 <= height <= 5000:
            continue
        image_data = str(raw_image.get("image") or "")
        match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)", image_data)
        if not match:
            continue
        try:
            encoded_bytes = base64.b64decode(match.group(2), validate=True)
        except (ValueError, base64.binascii.Error):
            continue
        if len(encoded_bytes) > MAX_RENDERED_CHART_BYTES:
            continue
        if match.group(1) == "png":
            decoded = _decode_png(encoded_bytes)
            if not decoded or decoded[0] != width or decoded[1] != height:
                continue
            rendered[name] = {
                "width": decoded[0],
                "height": decoded[1],
                "bytes": decoded[2],
                "format": "raw",
            }
            continue
        if not encoded_bytes.startswith(b"\xff\xd8") or not encoded_bytes.endswith(b"\xff\xd9"):
            continue
        rendered[name] = {
            "width": width,
            "height": height,
            "bytes": encoded_bytes,
            "format": "jpeg",
        }
    return rendered


def decode_rendered_summary_image(raw_image):
    """Decode the browser-rendered summary table image supplied by the page."""

    decoded = decode_rendered_chart_images([raw_image])
    return next(iter(decoded.values()), None)


def _usable_reference(value):
    """Treat a zero source reference as unavailable."""

    numeric = _number(value)
    return value if numeric is not None and numeric != 0 else None


def _reference_value(reading, field_name):
    """Return a usable current source reference."""

    return _usable_reference(getattr(reading, field_name, None) if reading else None)


def _day_index(month, day):
    try:
        return (date(2024, int(month), int(day)) - date(2024, 1, 1)).days
    except (TypeError, ValueError):
        return None


def _month_start_index(month):
    """Return the zero-based leap-year index used by the source charts."""
    month = int(month)
    if month < 1 or month > 12:
        raise ValueError("month must be between 1 and 12")
    return sum(MONTH_DAYS[:month - 1])


def _source_series_data(entries, series_name):
    """Mirror the browser's PAGASA payload normalization."""

    values = [None] * 366
    scalar_values = []
    for entry in (entries.values() if isinstance(entries, dict) else (entries or [])):
        if isinstance(entry, dict):
            if entry.get("date") is not None:
                match = re.match(r"^(?:\d{4})-(\d{1,2})-(\d{1,2})", str(entry["date"]))
                if match:
                    index = _day_index(match.group(1), match.group(2))
                    if index is not None:
                        values[index] = _number(entry.get("value"))
            elif entry.get("day") is not None:
                index = _day_index(entry.get("month"), entry.get("day"))
                if index is not None:
                    if series_name == "rc":
                        raw_value = entry.get("rc_value", entry.get("value"))
                    elif series_name == "nhwl":
                        raw_value = entry.get("nhwl_value", entry.get("value"))
                    elif series_name == "lwl":
                        raw_value = entry.get("lwl_value", entry.get("value"))
                    else:
                        raw_value = entry.get("value")
                    values[index] = _usable_reference(raw_value) if series_name in REFERENCE_SERIES_ORDER else _number(raw_value)
            elif "value" in entry:
                raw_value = _number(entry.get("value"))
                scalar_values.append(
                    _usable_reference(raw_value)
                    if series_name in REFERENCE_SERIES_ORDER
                    else raw_value
                )
        else:
            # Keep PAGASA's blank February 29 placeholder in sequence so
            # scalar reference arrays do not shift onto the wrong day.
            raw_value = None if entry == "" else _number(entry)
            scalar_values.append(
                _usable_reference(raw_value)
                if series_name in REFERENCE_SERIES_ORDER
                else raw_value
            )

    if len(scalar_values) == 1 and scalar_values[0] is not None:
        values = [scalar_values[0]] * 366
    elif len(scalar_values) > 1:
        for index, value in enumerate(scalar_values[:366]):
            target_index = (
                index + 1
                if len(scalar_values) == 365 and index >= 59
                else index
            )
            if target_index < 366:
                values[target_index] = value
    return values


def normalize_source_series(payload):
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return {}
    year_names = sorted(
        (name for name in data if re.fullmatch(r"\d{4}", str(name))),
        key=lambda name: int(name),
    )
    names = []
    for name in [*year_names, *REFERENCE_SERIES_ORDER, *data]:
        if name in data and name not in names:
            names.append(name)
    normalized = {}
    for name in names:
        values = _source_series_data(data[name], name)
        if any(value is not None for value in values):
            normalized[name] = values
    return normalized


def _ordered_series_names(series):
    year_names = sorted(
        (name for name in series if re.fullmatch(r"\d{4}", str(name))),
        key=lambda name: int(name),
    )
    names = []
    for name in [*year_names, *REFERENCE_SERIES_ORDER, *series]:
        if name in series and name not in names:
            names.append(name)
    return names


def _series_color(name, present_year):
    normalized_name = str(name).lower()
    if normalized_name == str(present_year):
        return CURRENT_YEAR
    if normalized_name == str(present_year - 1):
        return PAST_NEWER
    if normalized_name == str(present_year - 2):
        return PAST_OLDER
    return SERIES_COLORS.get(normalized_name, MUTED)


def _series_label(name):
    normalized_name = str(name).lower()
    return SERIES_LABELS.get(normalized_name, str(name))


def _chart_title(dam_name):
    return "Magat" if str(dam_name) == "Magat Dam" else dam_name


def _nice_axis(series, target_tick_count=6):
    values = [value for points in series.values() for value in points if value is not None]
    if not values:
        return 0.0, 1.0, 0.2, 1
    minimum = min(values)
    maximum = max(values)
    raw_range = maximum - minimum
    if raw_range == 0:
        padding = max(abs(maximum) * 0.01, 1.0)
        minimum -= padding
        maximum += padding
        raw_range = maximum - minimum
    padding = raw_range * 0.05
    padded_minimum = minimum - padding
    padded_maximum = maximum + padding
    raw_step = raw_range / max(1, target_tick_count - 1)
    magnitude = 10 ** math.floor(math.log10(raw_step))
    normalized_step = raw_step / magnitude
    if normalized_step <= 1:
        multiplier = 1
    elif normalized_step <= 2:
        multiplier = 2
    elif normalized_step <= 5:
        multiplier = 5
    else:
        multiplier = 10
    step = multiplier * magnitude
    axis_minimum = math.floor(padded_minimum / step) * step
    axis_maximum = math.ceil(padded_maximum / step) * step
    decimals = min(2, max(1, math.ceil(-math.log10(step)))) if step < 1 else 0
    return axis_minimum, axis_maximum, step, decimals


class _Page:
    def __init__(self):
        self.commands = []
        self.links = []

    def _append(self, *commands):
        self.commands.extend(commands)

    def fill(self, value):
        self._append(f"{_rgb(value)} rg")

    def stroke(self, value, width=0.5):
        self._append(f"{width:.2f} w", f"{_rgb(value)} RG")

    def rect(self, x, y, width, height, fill=None, stroke=None, line_width=0.5):
        if fill:
            self.fill(fill)
        if stroke:
            self.stroke(stroke, line_width)
        mode = "B" if fill and stroke else "f" if fill else "S"
        self._append(f"{x:.2f} {y:.2f} {width:.2f} {height:.2f} re {mode}")

    def line(self, x1, y1, x2, y2, color=GRID, width=0.5, dash=None):
        self.stroke(color, width)
        dash_value = " ".join(f"{part:.2f}" for part in dash) if dash else ""
        self._append(f"[{dash_value}] 0 d" if dash else "[] 0 d")
        self._append(f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def polyline(self, points, color=TEXT, width=1.0, dash=None):
        if len(points) < 2:
            return
        self.stroke(color, width)
        dash_value = " ".join(f"{part:.2f}" for part in dash) if dash else ""
        self._append(f"[{dash_value}] 0 d" if dash else "[] 0 d")
        path = [f"{points[0][0]:.2f} {points[0][1]:.2f} m"]
        path.extend(f"{x:.2f} {y:.2f} l" for x, y in points[1:])
        path.append("S")
        self._append(" ".join(path))

    def text(self, x, y, value, size=8, color=TEXT, bold=False, align="left", mono=False):
        value = _ascii(value)
        if align == "center":
            x -= _text_width(value, size, bold, mono) / 2
        elif align == "right":
            x -= _text_width(value, size, bold, mono)
        if mono:
            font = "F4" if bold else "F3"
        else:
            font = "F2" if bold else "F1"
        self._append(
            "BT",
            f"/{font} {size:.2f} Tf",
            f"{_rgb(color)} rg",
            f"1 0 0 1 {x:.2f} {y:.2f} Tm",
            f"({_escape(value)}) Tj",
            "ET",
        )

    def triangle(self, x, y, direction, color=TEXT, size=4.2):
        """Draw a small vector indicator so arrows survive PDF encoding."""

        half = size / 2
        if direction == "up":
            points = ((x, y), (x + size, y), (x + half, y + size))
        elif direction == "down":
            points = ((x, y + size), (x + size, y + size), (x + half, y))
        else:
            self.text(x + half, y - 1, "-", size=size, color=color, align="center")
            return
        self.fill(color)
        path = [f"{points[0][0]:.2f} {points[0][1]:.2f} m"]
        path.extend(f"{point[0]:.2f} {point[1]:.2f} l" for point in points[1:])
        path.append("h f")
        self._append(" ".join(path))

    def rotated_text(self, x, y, value, size=7, color=TEXT, angle=45, align="center"):
        if align == "center":
            x -= _text_width(value, size) / 2
        radians = math.radians(angle)
        cosine = math.cos(radians)
        sine = math.sin(radians)
        self._append(
            "BT",
            f"/F1 {size:.2f} Tf",
            f"{_rgb(color)} rg",
            f"{cosine:.4f} {sine:.4f} {-sine:.4f} {cosine:.4f} {x:.2f} {y:.2f} Tm",
            f"({_escape(value)}) Tj",
            "ET",
        )

    def image(self, name, x, y, width, height):
        self._append(
            "q",
            f"{width:.2f} 0 0 {height:.2f} {x:.2f} {y:.2f} cm",
            f"/{name} Do",
            "Q",
        )

    def link(self, x, y, width, height, url):
        self.links.append((x, y, width, height, url))


class _PdfDocument:
    def __init__(self):
        self.pages = []
        self.images = []

    def new_page(self):
        page = _Page()
        self.pages.append(page)
        return page

    def add_image(self, width, height, rgb_bytes):
        name = f"Im{len(self.images) + 1}"
        self.images.append((name, width, height, rgb_bytes, "raw"))
        return name

    def add_jpeg(self, width, height, jpeg_bytes):
        name = f"Im{len(self.images) + 1}"
        self.images.append((name, width, height, jpeg_bytes, "jpeg"))
        return name

    def render(self):
        objects = [None]

        def reserve():
            objects.append(None)
            return len(objects) - 1

        def put(object_id, value):
            objects[object_id] = value

        catalog_id = reserve()
        pages_id = reserve()
        font_regular_id = reserve()
        font_bold_id = reserve()
        image_ids = {}
        for name, width, height, image_bytes, image_format in self.images:
            image_ids[name] = reserve()
            if image_format == "jpeg":
                image_stream = image_bytes
                image_filter = " /Filter /DCTDecode"
            else:
                # Keep the browser pixels lossless while compressing the PDF
                # stream so a multi-dam report does not balloon in size.
                image_stream = zlib.compress(image_bytes, level=9)
                image_filter = " /Filter /FlateDecode"
            put(
                image_ids[name],
                f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8{image_filter} "
                f"/Length {len(image_stream)} >>\n"
                f"stream\n".encode("ascii") + image_stream + b"\nendstream",
            )

        page_ids = []
        content_ids = []
        annotation_ids = []
        for page in self.pages:
            content_id = reserve()
            page_id = reserve()
            page_ids.append(page_id)
            content_ids.append(content_id)
            page_annotation_ids = []
            for x, y, width, height, url in page.links:
                annotation_id = reserve()
                page_annotation_ids.append(annotation_id)
                put(
                    annotation_id,
                    f"<< /Type /Annot /Subtype /Link /Rect [{x:.2f} {y:.2f} "
                    f"{x + width:.2f} {y + height:.2f}] /Border [0 0 0] "
                    f"/A << /S /URI /URI ({_escape(url)}) >> >>",
                )
            annotation_ids.append(page_annotation_ids)

        put(font_regular_id, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        put(font_bold_id, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
        font_mono_id = reserve()
        font_mono_bold_id = reserve()
        put(font_mono_id, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
        put(font_mono_bold_id, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>")
        kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
        put(pages_id, f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>")
        put(catalog_id, f"<< /Type /Catalog /Pages {pages_id} 0 R >>")

        for page, content_id, page_id, page_annotation_list in zip(
            self.pages, content_ids, page_ids, annotation_ids
        ):
            content = "\n".join(page.commands).encode("ascii", "replace")
            put(
                content_id,
                f"<< /Length {len(content)} >>\nstream\n".encode("ascii")
                + content
                + b"\nendstream",
            )
            xobjects = " ".join(
                f"/{name} {image_ids[name]} 0 R" for name, *_ in self.images
            )
            annotation_value = " ".join(f"{item} 0 R" for item in page_annotation_list)
            annots = f" /Annots [{annotation_value}]" if page_annotation_list else ""
            put(
                page_id,
                f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 "
                f"{PAGE_WIDTH:.2f} {PAGE_HEIGHT:.2f}] /Resources << /Font << "
                f"/F1 {font_regular_id} 0 R /F2 {font_bold_id} 0 R "
                f"/F3 {font_mono_id} 0 R /F4 {font_mono_bold_id} 0 R >>"
                f"{f' /XObject << {xobjects} >>' if xobjects else ''} >> "
                f"/Contents {content_id} 0 R{annots} >>",
            )

        output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0] * len(objects)
        for object_id in range(1, len(objects)):
            offsets[object_id] = len(output)
            output.extend(f"{object_id} 0 obj\n".encode("ascii"))
            value = objects[object_id]
            output.extend(value if isinstance(value, bytes) else value.encode("ascii"))
            output.extend(b"\nendobj\n")
        xref_offset = len(output)
        output.extend(f"xref\n0 {len(objects)}\n".encode("ascii"))
        output.extend(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
        output.extend(
            f"trailer\n<< /Size {len(objects)} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii")
        )
        return bytes(output)


def _read_gif_subblocks(content, index):
    chunks = []
    while index < len(content):
        size = content[index]
        index += 1
        if size == 0:
            break
        chunks.append(content[index:index + size])
        index += size
    return b"".join(chunks), index


def _gif_lzw_decode(data, minimum_code_size, expected_length):
    clear_code = 1 << minimum_code_size
    end_code = clear_code + 1
    code_size = minimum_code_size + 1
    dictionary = {index: bytes([index]) for index in range(clear_code)}
    dictionary[clear_code] = None
    dictionary[end_code] = None
    bit_position = 0
    previous = None
    decoded = bytearray()

    def read_code(size):
        nonlocal bit_position
        value = 0
        for offset in range(size):
            byte_index = bit_position // 8
            if byte_index >= len(data):
                return None
            value |= ((data[byte_index] >> (bit_position % 8)) & 1) << offset
            bit_position += 1
        return value

    next_code = end_code + 1
    while len(decoded) < expected_length:
        code = read_code(code_size)
        if code is None or code == end_code:
            break
        if code == clear_code:
            dictionary = {index: bytes([index]) for index in range(clear_code)}
            dictionary[clear_code] = None
            dictionary[end_code] = None
            code_size = minimum_code_size + 1
            next_code = end_code + 1
            previous = None
            continue
        if code in dictionary and dictionary[code] is not None:
            entry = dictionary[code]
        elif code == next_code and previous is not None:
            entry = previous + previous[:1]
        else:
            break
        decoded.extend(entry)
        if previous is not None and next_code < 4096:
            dictionary[next_code] = previous + entry[:1]
            next_code += 1
            if next_code == (1 << code_size) and code_size < 12:
                code_size += 1
        previous = entry
    return bytes(decoded[:expected_length])


def _decode_gif(content):
    """Decode the first GIF frame into uncompressed RGB PDF image data."""

    if not isinstance(content, (bytes, bytearray)) or content[:3] != b"GIF":
        return None
    if len(content) < 13:
        return None
    width = int.from_bytes(content[6:8], "little")
    height = int.from_bytes(content[8:10], "little")
    if not width or not height:
        return None
    packed = content[10]
    index = 13
    global_table = None
    if packed & 0x80:
        table_size = 3 * (2 ** ((packed & 0x07) + 1))
        raw_table = content[index:index + table_size]
        index += table_size
        global_table = [tuple(raw_table[pos:pos + 3]) for pos in range(0, len(raw_table), 3)]

    transparency_index = None
    while index < len(content):
        marker = content[index]
        index += 1
        if marker == 0x3B:
            break
        if marker == 0x21:
            if index >= len(content):
                break
            label = content[index]
            index += 1
            block, index = _read_gif_subblocks(content, index)
            if label == 0xF9 and len(block) >= 4 and block[0] & 1:
                transparency_index = block[3]
            continue
        if marker != 0x2C or index + 9 > len(content):
            break
        left = int.from_bytes(content[index:index + 2], "little")
        top = int.from_bytes(content[index + 2:index + 4], "little")
        frame_width = int.from_bytes(content[index + 4:index + 6], "little")
        frame_height = int.from_bytes(content[index + 6:index + 8], "little")
        image_packed = content[index + 8]
        index += 9
        color_table = global_table
        if image_packed & 0x80:
            table_size = 3 * (2 ** ((image_packed & 0x07) + 1))
            raw_table = content[index:index + table_size]
            index += table_size
            color_table = [tuple(raw_table[pos:pos + 3]) for pos in range(0, len(raw_table), 3)]
        if index >= len(content) or not color_table:
            return None
        minimum_code_size = content[index]
        index += 1
        compressed, index = _read_gif_subblocks(content, index)
        indices = _gif_lzw_decode(compressed, minimum_code_size, frame_width * frame_height)
        pixels = [tuple((255, 255, 255)) for _ in range(width * height)]
        row_order = list(range(frame_height))
        if image_packed & 0x40:
            row_order = []
            for start, step in ((0, 8), (4, 8), (2, 4), (1, 2)):
                row_order.extend(range(start, frame_height, step))
        for source_row, target_row in enumerate(row_order):
            for column in range(frame_width):
                source_index = source_row * frame_width + column
                if source_index >= len(indices):
                    continue
                color_index = indices[source_index]
                if color_index == transparency_index:
                    continue
                if color_index >= len(color_table):
                    continue
                canvas_x = left + column
                canvas_y = top + target_row
                if 0 <= canvas_x < width and 0 <= canvas_y < height:
                    pixels[canvas_y * width + canvas_x] = color_table[color_index]
        return width, height, b"".join(bytes(pixel) for pixel in pixels)
    return None


def _draw_header(page, snapshot, source_url=PAGASA_DAM_PAGE_URL):
    title_y = PAGE_HEIGHT - PAGE_MARGIN - 1
    page.text(PAGE_MARGIN, title_y, "Dam Water Levels Monitoring", size=16, bold=True)
    source_y = title_y - 20
    page.text(PAGE_MARGIN, source_y, "Source:", size=8.5, color=MUTED)
    source_label_x = PAGE_MARGIN + _text_width("Source: ", 8.5)
    page.text(source_label_x, source_y, "DOST-PAGASA", size=8.5, color=BLUE)
    page.line(source_label_x, source_y - 1.5, source_label_x + _text_width("DOST-PAGASA", 8.5), source_y - 1.5, color=BLUE, width=0.45)
    page.link(source_label_x, source_y - 2, _text_width("DOST-PAGASA", 8.5), 10, source_url or PAGASA_DAM_PAGE_URL)
    observed = _display_datetime(getattr(snapshot, "source_observed_at", None))
    as_of_x = source_label_x + _text_width("DOST-PAGASA", 8.5) + 16
    page.text(as_of_x, source_y, f"as of {observed or '-'}", size=8.5, color=MUTED)


def _display_datetime(value):
    if not value:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=MANILA_TIMEZONE)
    else:
        value = value.astimezone(MANILA_TIMEZONE)
    return value.strftime("%b %d, %Y | %I:%M %p").replace(" 0", " ")


def _draw_section_heading(page, title, part_label, y):
    page.text(PAGE_MARGIN, y, part_label, size=8, color=GREEN, bold=True)
    page.text(PAGE_MARGIN, y - 15, title, size=14, color=TEXT, bold=True)
    return y - 28


def _draw_status_image(page, snapshot, document):
    content = getattr(snapshot, "status_image_content", None) if snapshot else None
    decoded = _decode_gif(bytes(content)) if content else None
    x = PAGE_MARGIN
    # Keep the image below the Part 1 title and source-image sublabel.
    y_top = PAGE_HEIGHT - 118
    available_width = CONTENT_WIDTH
    available_height = 390
    if decoded:
        width, height, rgb_bytes = decoded
        image_name = document.add_image(width, height, rgb_bytes)
        scale = min(available_width / width, available_height / height)
        display_width = width * scale
        display_height = height * scale
        image_x = x + (available_width - display_width) / 2
        image_y = y_top - display_height
        page.rect(image_x - 5, image_y - 5, display_width + 10, display_height + 10, fill=WHITE, stroke=GRID, line_width=0.6)
        page.image(image_name, image_x, image_y, display_width, display_height)
        return image_y - 20
    page.rect(x, y_top - 150, available_width, 150, fill=OFF_WHITE, stroke=GRID, line_width=0.6)
    page.text(PAGE_WIDTH / 2, y_top - 76, "Official PAGASA status image is unavailable in the cached snapshot.", size=10, color=MUTED, align="center")
    return y_top - 170


def _comparison(value, reference, comparison_kind):
    value = _number(value)
    reference = _number(reference)
    if value is None or reference is None:
        return "-", None
    difference = value - reference
    favorable = difference >= 0
    if comparison_kind == "nhwl":
        favorable = difference <= 0
    color = GREEN if favorable else RED
    return f"{_fmt_number(value)} | {'+' if difference >= 0 else ''}{_fmt_number(difference)}", color


def _draw_table_difference(page, center, y, difference, color):
    """Match the dashboard's colored arrow-plus-difference treatment."""

    if difference is None:
        return
    label = f"{'+' if difference >= 0 else ''}{_fmt_number(difference)}"
    text_size = 6.4
    arrow_size = 4.2
    gap = 3.0
    label_width = _text_width(label, text_size, bold=True, mono=True)
    total_width = arrow_size + gap + label_width
    arrow_x = center - total_width / 2
    direction = "up" if difference > 0 else "down"
    page.triangle(arrow_x, y + 1.2, direction, color=color, size=arrow_size)
    page.text(
        arrow_x + arrow_size + gap,
        y,
        label,
        size=text_size,
        color=color,
        bold=True,
        mono=True,
    )


def _same_day(series, observed_at):
    if not observed_at or not series:
        return None
    return series[_day_index(observed_at.month, observed_at.day)]


def _row_series(row, chart_payload):
    series = normalize_source_series(chart_payload or {})
    current = row.get("current")
    return {
        "series": series,
        "current_value": getattr(current, "reservoir_water_level_m", None) if current else None,
        "observed_at": getattr(current, "observed_at", None) if current else None,
    }


def _draw_sparkline(page, x, y, width, height, values):
    points = [(index, value) for index, value in enumerate(values or []) if value is not None]
    if len(points) < 2:
        page.text(x + width / 2, y + (height / 2) - 2, "-", size=8, color=MUTED, align="center")
        return
    minimum = min(value for _, value in points)
    maximum = max(value for _, value in points)
    if minimum == maximum:
        minimum -= 1
        maximum += 1
    plotted = []
    for index, value in points:
        px = x + (index / max(1, len(values) - 1)) * width
        py = y + ((value - minimum) / (maximum - minimum)) * height
        plotted.append((px, py))
    page.polyline(plotted, color=CURRENT_YEAR, width=1.5)


def _draw_summary_table(page, rows, chart_payloads, present_year, table_top):
    comparison_years = (str(present_year - 1), str(present_year - 2))
    columns = [
        ("Dam", 78),
        (f"Water Level|as of {_date_label(rows)}", 83),
        (f"Trend|Jan 1, {present_year} to present", 105),
        ("Rule|Curve", 82),
        ("Normal High|Water Level", 102),
        ("Low|Water Level", 92),
        (f"{comparison_years[0]}|Same day", 82),
        (f"{comparison_years[1]}|Same day", 82),
    ]
    total_width = sum(width for _, width in columns)
    scale = CONTENT_WIDTH / total_width
    columns = [(label, width * scale) for label, width in columns]
    header_height = 42
    row_height = 35
    x_positions = [PAGE_MARGIN]
    for _, width in columns:
        x_positions.append(x_positions[-1] + width)
    page.rect(PAGE_MARGIN, table_top - header_height, CONTENT_WIDTH, header_height, fill=WHITE, stroke=GRID, line_width=0.5)
    for index, (label, _) in enumerate(columns):
        x_center = (x_positions[index] + x_positions[index + 1]) / 2
        for line_index, line in enumerate(label.split("|")):
            page.text(x_center, table_top - 16 - (line_index * 10), line, size=7.2 if line_index else 7.5, color=MUTED if line_index else TEXT, bold=True, align="center")
    for row_index, row in enumerate(rows):
        row_top = table_top - header_height - (row_index * row_height)
        row_y = row_top - row_height
        fill = WHITE if row_index % 2 == 0 else OFF_WHITE
        page.rect(PAGE_MARGIN, row_y, CONTENT_WIDTH, row_height, fill=fill, stroke=GRID, line_width=0.35)
        chart = _row_series(row, chart_payloads.get(row["dam"].name))
        series = chart["series"]
        current_value = chart["current_value"]
        current_numeric = _number(current_value)
        observed_at = chart["observed_at"]
        current_year_series = series.get(str(present_year), [])
        current_rule_curve = _reference_value(
            row["current"],
            "rule_curve_elevation_m",
        )
        current_nhwl = _reference_value(
            row["current"],
            "normal_high_water_level_m",
        )
        chart_rule_curve = _usable_reference(
            _same_day(series.get("rc", []), observed_at),
        )
        chart_nhwl = _usable_reference(
            _same_day(series.get("nhwl", []), observed_at),
        )
        values = [
            row["dam"].name,
            _fmt_number(current_value),
            None,
            current_rule_curve if current_rule_curve is not None else chart_rule_curve,
            current_nhwl if current_nhwl is not None else chart_nhwl,
            _same_day(series.get("lwl", []), observed_at),
            _same_day(series.get(comparison_years[0], []), observed_at),
            _same_day(series.get(comparison_years[1], []), observed_at),
        ]
        if values[3] is None:
            values[3] = _reference_value(row["current"], "rule_curve_elevation_m")
        if values[4] is None:
            values[4] = _reference_value(row["current"], "normal_high_water_level_m")
        values[3] = _usable_reference(values[3])
        values[4] = _usable_reference(values[4])
        for col_index, value in enumerate(values):
            left = x_positions[col_index]
            width = columns[col_index][1]
            center = left + width / 2
            if col_index == 2:
                _draw_sparkline(page, left + 11, row_y + 10, width - 22, 15, current_year_series)
                continue
            if col_index == 0:
                page.text(center, row_y + 13, value, size=7.6, color=TEXT, align="center", mono=False)
                continue
            if col_index == 1:
                page.text(center, row_y + 14, value, size=8, color=TEXT, align="center", mono=True)
                continue
            kind = ("rc", "nhwl", "lwl", *comparison_years)[col_index - 3]
            comparison = _comparison(current_value, value, kind)
            main_value = _fmt_number(value)
            difference = None
            if comparison[1] is not None:
                difference = current_numeric - _number(value)
                favorable = difference >= 0
                if kind == "nhwl":
                    favorable = difference <= 0
                difference_color = GREEN if favorable else RED
            else:
                difference_color = MUTED
            page.text(center, row_y + 18, main_value, size=7.5, color=TEXT, align="center", mono=True)
            if difference is not None:
                _draw_table_difference(page, center, row_y + 7, difference, difference_color)
    return table_top - header_height - len(rows) * row_height


def _date_label(rows):
    for row in rows:
        current = row.get("current")
        observed_at = getattr(current, "observed_at", None) if current else None
        if observed_at:
            return observed_at.strftime("%b %d, %Y")
    return "-"


def _draw_rendered_chart(page, document, x, y, width, height, asset):
    """Place the browser's chart-and-legend pixels without recalculating them."""

    if not asset:
        return False
    image_name = (
        document.add_jpeg(asset["width"], asset["height"], asset["bytes"])
        if asset.get("format") == "jpeg"
        else document.add_image(asset["width"], asset["height"], asset["bytes"])
    )
    inset = 1.0
    available_width = width - (inset * 2)
    available_height = height - (inset * 2)
    scale = min(
        available_width / asset["width"],
        available_height / asset["height"],
    )
    display_width = asset["width"] * scale
    display_height = asset["height"] * scale
    image_x = x + (width - display_width) / 2
    image_y = y + (height - display_height) / 2
    page.rect(x, y, width, height, fill=WHITE, stroke=GRID, line_width=0.65)
    page.image(image_name, image_x, image_y, display_width, display_height)
    page.rect(x, y, width, height, stroke=GRID, line_width=0.65)
    return True


def _draw_rendered_summary_table(page, document, x, table_top, width, asset):
    """Place the browser's summary table pixels without redrawing them."""

    if not asset:
        return False
    image_name = (
        document.add_jpeg(asset["width"], asset["height"], asset["bytes"])
        if asset.get("format") == "jpeg"
        else document.add_image(asset["width"], asset["height"], asset["bytes"])
    )
    available_height = max(1.0, table_top - PAGE_MARGIN)
    scale = min(
        width / asset["width"],
        available_height / asset["height"],
    )
    display_width = asset["width"] * scale
    display_height = asset["height"] * scale
    image_x = x + (width - display_width) / 2
    image_y = table_top - display_height
    page.image(image_name, image_x, image_y, display_width, display_height)
    return True


def _draw_chart(page, x, y, width, height, dam_name, series, present_year):
    page.rect(x, y, width, height, fill=WHITE, stroke=GRID, line_width=0.65)
    page.text(x + width / 2, y + height - 19, _chart_title(dam_name), size=12, color=TEXT, bold=True, align="center")
    plot_left = x + 44
    plot_right = x + width - 12
    plot_bottom = y + 64
    plot_top = y + height - 39
    plot_width = plot_right - plot_left
    plot_height = plot_top - plot_bottom
    axis_minimum, axis_maximum, step, decimals = _nice_axis(series)
    if axis_maximum <= axis_minimum:
        axis_maximum = axis_minimum + 1
    def plot_x(day_index):
        return plot_left + (day_index / 365) * plot_width

    quarter_starts = [_month_start_index(month) for month in QUARTER_START_MONTHS]
    quarter_ends = [*quarter_starts[1:], 365]
    for quarter, (start_index, end_index) in enumerate(zip(quarter_starts, quarter_ends)):
        if quarter % 2:
            page.rect(
                plot_x(start_index),
                plot_bottom,
                plot_x(end_index) - plot_x(start_index),
                plot_height,
                fill=OFF_WHITE,
            )
    tick = axis_minimum
    while tick <= axis_maximum + (step * 0.01):
        py = plot_bottom + ((tick - axis_minimum) / (axis_maximum - axis_minimum)) * plot_height
        page.line(plot_left, py, plot_right, py, color=GRID, width=0.45)
        page.text(
            plot_left - 7,
            py - 2.5,
            f"{tick:.{decimals}f}",
            size=6.4,
            color=MUTED,
            align="right",
            mono=True,
        )
        tick += step
    page.rotated_text(plot_left + 4, plot_bottom + plot_height / 2 - 25, "Water Level (m)", size=7.2, color=MUTED, angle=90)
    page.line(plot_left, plot_bottom, plot_right, plot_bottom, color="#CBD5E1", width=0.55)
    for month, label in enumerate(MONTH_LABELS, start=1):
        month_start = _month_start_index(month)
        page.text(
            plot_x(month_start),
            plot_bottom - 15,
            label,
            size=6.2,
            color=MUTED,
            align="center",
            mono=True,
        )
    ordered_names = _ordered_series_names(series)
    historical_years = {str(present_year - 1), str(present_year - 2)}
    for name in ordered_names:
        points = series.get(name)
        if not points or not any(value is not None for value in points):
            continue
        plotted = []
        segments = []
        for index, value in enumerate(points):
            if value is None:
                if len(plotted) > 1:
                    segments.append(plotted)
                plotted = []
                continue
            px = plot_x(index)
            py = plot_bottom + ((value - axis_minimum) / (axis_maximum - axis_minimum)) * plot_height
            plotted.append((px, max(plot_bottom, min(plot_top, py))))
        if len(plotted) > 1:
            segments.append(plotted)
        line_width = 1.6 if str(name) == str(present_year) else 0.95 if str(name) in historical_years else 1.1
        dash = (2.2, 2.0) if str(name) in historical_years else None
        for segment in segments:
            page.polyline(segment, color=_series_color(name, present_year), width=line_width, dash=dash)
    for month in range(1, 13):
        page.line(
            plot_x(_month_start_index(month)),
            plot_bottom,
            plot_x(_month_start_index(month)),
            plot_bottom + 10,
            color="#CBD5E1",
            width=0.7,
        )
    page.line(
        plot_right,
        plot_bottom,
        plot_right,
        plot_bottom + 10,
        color="#CBD5E1",
        width=0.7,
    )
    for month, days in enumerate(MONTH_DAYS, start=1):
        middle_index = _month_start_index(month) + (days - 1) / 2
        px = plot_x(middle_index)
        page.line(px, plot_bottom, px, plot_bottom + 4, color="#D4D4D8", width=0.7)
    page.text(plot_left + plot_width / 2, y + 36, "Month", size=7.2, color=MUTED, align="center")
    legend_names = [
        name for name in ordered_names
        if series.get(name) and any(value is not None for value in series[name])
    ]
    legend_gap = 10
    legend_font = 6.6
    total_legend_width = sum(19 + _text_width(_series_label(name), legend_font) for name in legend_names) + max(0, len(legend_names) - 1) * legend_gap
    legend_x = x + (width - total_legend_width) / 2
    legend_y = y + 15
    for name in legend_names:
        color = _series_color(name, present_year)
        dash = (2.2, 2.0) if str(name) in historical_years else None
        page.line(legend_x, legend_y + 2, legend_x + 15, legend_y + 2, color=color, width=1.25 if str(name) == str(present_year) else 1.0, dash=dash)
        label = _series_label(name)
        page.text(legend_x + 19, legend_y, label, size=legend_font, color=TEXT, bold=True)
        legend_x += 19 + _text_width(label, legend_font) + legend_gap


def build_dam_water_levels_pdf(
    *,
    snapshot,
    dam_rows,
    chart_payloads,
    source_url=PAGASA_DAM_PAGE_URL,
    rendered_chart_images=None,
    rendered_summary_image=None,
):
    """Build the three-part dam monitoring report and return PDF bytes."""

    document = _PdfDocument()
    # Reports use the same rolling calendar-year window as the dashboard. The
    # source snapshot can be stale around New Year's Day, so it must not pin
    # comparison labels to its publication year.
    present_year = datetime.now(MANILA_TIMEZONE).year

    page = document.new_page()
    _draw_header(page, snapshot, source_url)
    body_y = _draw_section_heading(page, "Dam Water Level Update", "PART 1", PAGE_HEIGHT - 76)
    page.text(PAGE_MARGIN, body_y + 3, "Official DOST-PAGASA status image", size=8, color=MUTED)
    _draw_status_image(page, snapshot, document)

    page = document.new_page()
    _draw_header(page, snapshot, source_url)
    body_y = _draw_section_heading(page, "Dam Water Level Summary", "PART 2", PAGE_HEIGHT - 76)
    if not _draw_rendered_summary_table(
        page,
        document,
        PAGE_MARGIN,
        body_y + 3,
        CONTENT_WIDTH,
        rendered_summary_image,
    ):
        _draw_summary_table(page, dam_rows, chart_payloads, present_year, body_y + 3)

    names = [row["dam"].name for row in dam_rows]
    for chunk_start in range(0, len(names), 4):
        page = document.new_page()
        _draw_header(page, snapshot, source_url)
        _draw_section_heading(page, "Dam Water Levels Trends", "PART 3", PAGE_HEIGHT - 76)
        chunk_names = names[chunk_start:chunk_start + 4]
        # Keep every trend chart in the same 2x2 cell dimensions, including
        # the final page when fewer than four dams remain.
        chart_height = 225
        chart_width = (CONTENT_WIDTH - 14) / 2
        vertical_gap = 10
        for position, dam_name in enumerate(chunk_names):
            payload = chart_payloads.get(dam_name) or {}
            series = normalize_source_series(payload)
            row = position // 2
            column = position % 2
            chart_x = PAGE_MARGIN + column * (chart_width + 14)
            chart_y = PAGE_MARGIN + (1 - row) * (chart_height + vertical_gap)
            rendered_chart = (rendered_chart_images or {}).get(dam_name)
            if not _draw_rendered_chart(
                page,
                document,
                chart_x,
                chart_y,
                chart_width,
                chart_height,
                rendered_chart,
            ):
                _draw_chart(page, chart_x, chart_y, chart_width, chart_height, dam_name, series, present_year)
    return document.render()
