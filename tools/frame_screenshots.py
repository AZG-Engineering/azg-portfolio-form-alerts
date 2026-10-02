"""Turn the raw screen captures from DEPLOY.md into the finished 1600x1200 images.

Usage:
    python tools\\frame_screenshots.py              frame screenshots\\raw\\ into screenshots\\
    python tools\\frame_screenshots.py --self-test  check the tool with made-up placeholder captures

The frame (navy strip, caption, white card, footer) is the AZG showcase template,
tools\\showcase.py. This tool decides what goes on each card:

  shot 1  a form entry (drawn as text from sample-data\\responses.csv) above the
          sheet rows it turns into, with the two columns the script fills boxed
  shot 2  the alert email: subject and body
  shot 3  the daily summary email: subject and body, with what it contains
  shot 4  the Run Log, if it was captured
  cover   0-cover.png: a compact before/after (the form entry, the sheet rows,
          the alert's subject line) made from the same captures. Cover-safe: no
          title strip, and everything sits in a band that survives a crop to
          16:9 or 2:1. Both crops are written to screenshots\\_work\\ to look at.

- Captures whose file names start with the same number belong to the same shot.
- Captures are enlarged to fill the card, never beyond twice their size, so the
  text stays sharp. All captures of one shot share one scale.
- CROPS trims a capture before framing. The raw file itself is never changed.

The captures are re-drawn, not copied, so nothing hidden in the original file
(such as who captured it) carries over. What is visible in a capture is NOT
checked: crop out addresses and the account picture when capturing, as DEPLOY.md
says. A 400 px wide copy of each image goes to screenshots\\_work\\ for a look at
thumbnail size.
"""

from __future__ import annotations

import csv
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

import showcase as kit  # tools\showcase.py: a copy of the AZG showcase kit

ROOT = Path(__file__).resolve().parent.parent
SHOTS_DIR = ROOT / "screenshots"
RAW_DIR = SHOTS_DIR / "raw"
WORK_DIR = SHOTS_DIR / "_work"
RESPONSES = ROOT / "sample-data" / "responses.csv"

FORM_TITLE = "Work request (demo)"
FEATURED_RESPONSE = 2  # the entry shown in shot 1: line 2 of responses.csv, the one in the alert email


@dataclass(frozen=True)
class Shot:
    file_name: str  # the finished image
    caption: str  # on the title strip: 4 to 8 words
    layout: str  # which card builder below lays it out


# Shot number -> the finished image. Captures are matched by the number their name starts with.
SHOTS = {
    "1": Shot("1-sheet-status-and-assignee.png", "New form entries get an owner automatically", "form_to_sheet"),
    "2": Shot("2-alert-email.png", "Each new request sends an alert email", "email"),
    "3": Shot("3-daily-summary-email.png", "A daily summary lists what's still open", "summary"),
    "4": Shot("4-run-log.png", "Every run is recorded in a log", "plain"),
}

# Pixels to trim from a capture before framing, by raw file name.
CROPS = {
    # The sheet capture is 1181 px wide, too wide to enlarge much. Keep the five
    # columns from "Request type" to "Assigned To": cut left of "Request type"
    # (339), cut "Last Updated" off the right (118), and take off the tab strip
    # above the header row (23). Each cut falls in the gap between two columns.
    "1-sheet.png": {"left": 339, "right": 118, "top": 23},
    # The capture ends with the bare label "Open the sheet:" (the link after it was
    # left out on purpose). 32 px takes off that line and the blank line above it.
    "2b-alert-body.png": {"bottom": 32},
}

# In shot 1, the part of the cropped sheet capture to box in teal: the Status and
# Assigned To columns, which the script fills in. (left, top, right, bottom) in pixels.
SHEET_HIGHLIGHT = (499, 1, 723, 121)

COVER_FILE = "0-cover.png"
COVER_HEADLINE = "Every form entry assigned and alerted"
COVER_FIELDS = ("Your name", "Request type", "Priority", "What do you need?")  # the form fields on the cover

EMAIL_LABELS = ("Subject", "Email")
SUMMARY_POINTS = [
    "One email a day, to the sheet owner",
    "Grouped by who it is assigned to",
    "Urgent first, then the oldest",
    "Finished requests drop off the list",
]


def load(path: Path, crop: dict[str, int] | None = None) -> Image.Image:
    """Open a capture, trim it if asked, and re-draw it as plain RGB with no embedded metadata."""
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
    plain = Image.new("RGB", rgba.size, "white")
    plain.paste(rgba, mask=rgba.split()[3])
    crop = crop or {}
    box = (crop.get("left", 0), crop.get("top", 0),
           plain.width - crop.get("right", 0), plain.height - crop.get("bottom", 0))
    if box[2] <= box[0] or box[3] <= box[1]:
        raise SystemExit(f"The crop for {path.name} removes the whole capture")
    return plain.crop(box)


def featured_response() -> list[tuple[str, str]]:
    """The form's questions and one made-up answer to each, from the sample data."""
    with open(RESPONSES, newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    return list(zip(rows[0][1:], rows[FEATURED_RESPONSE][1:]))  # without the Timestamp column


def form_panel(size: tuple[int, int]) -> Image.Image:
    """A form entry drawn as plain text: the question titles with one answer each."""
    width, height = size
    panel = Image.new("RGB", size, kit.SURFACE)
    draw = ImageDraw.Draw(panel)
    margin = 44
    kit.text(draw, (margin, 30), FORM_TITLE, 32, "semibold", kit.NAVY)

    fields = featured_response()
    cells = [(0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1), (0, 2, 2)]  # column, row, columns spanned
    column_width = (width - 2 * margin - 40) // 2
    top = 96
    row_height = (height - top - 20) // 3
    for (question, answer), (column, row, span) in zip(fields, cells):
        x = margin + column * (column_width + 40)
        y = top + row * row_height
        right = x + column_width * span + 40 * (span - 1)
        kit.text(draw, (x, y), question, 22, "regular", kit.SLATE)
        kit.text(draw, (x, y + 34), answer, 38, "semibold", kit.INK)
        draw.line((x, y + 92, right, y + 92), fill=kit.LINE, width=2)
    return panel


def boxed_sheet(sheet: Image.Image) -> Image.Image:
    """The cropped sheet capture with the two columns the script fills boxed in teal."""
    sheet = sheet.copy()
    if sheet.size == (724, 122):  # the real capture, cropped as in CROPS
        ImageDraw.Draw(sheet).rounded_rectangle(SHEET_HIGHLIGHT, radius=6, outline=kit.TEAL, width=3)
    return sheet


def form_strip(size: tuple[int, int]) -> Image.Image:
    """The form entry as one line of fields, for the cover: question above, answer below."""
    width, height = size
    strip = Image.new("RGB", size, kit.SURFACE)
    draw = ImageDraw.Draw(strip)
    answers = dict(featured_response())
    fields = [(question, answers[question]) for question in COVER_FIELDS]
    margin, gap = 24, 40
    for value_size in (40, 38, 36, 34, 32):  # the largest size at which all four answers fit
        widths = [max(kit.text_width(q, 20), kit.text_width(a, value_size, "semibold")) for q, a in fields]
        if sum(widths) + gap * (len(fields) - 1) <= width - 2 * margin:
            break
    else:
        raise SystemExit("The form entry doesn't fit on one line of the cover")
    spare = (width - 2 * margin - sum(widths) - gap * (len(fields) - 1)) / (len(fields) - 1)
    x = margin
    for (question, answer), field_width in zip(fields, widths):
        kit.text(draw, (x, height // 2 - 30), question, 20, "regular", kit.SLATE, anchor="lm")
        kit.text(draw, (x, height // 2 + 14), answer, value_size, "semibold", kit.INK, anchor="lm")
        x += field_width + gap + spare
    draw.rectangle((0, 0, width - 1, height - 1), outline=kit.LINE)
    return strip


def build_cover(raw_dir: Path, out_dir: Path, crops: dict[str, dict[str, int]], previews: Path | None) -> dict | None:
    """The cover: the form entry, an arrow, the sheet rows, and the alert's subject line.

    Uses the first shot-1 capture (the sheet) and, if there is one, the first shot-2
    capture (the alert subject). Captures stay at 2x or less.
    """
    captures = sorted(p for p in raw_dir.glob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
    sheets = [p for p in captures if shot_number(p) == "1"]
    subjects = [p for p in captures if shot_number(p) == "2"]
    if not sheets:
        print(f"  cover: no capture starting with '1' in {raw_dir.name}\\ - skipped")
        return None
    sheet = boxed_sheet(load(sheets[0], crops.get(sheets[0].name)))
    subject = load(subjects[0], crops.get(subjects[0].name)) if subjects else None

    card = kit.new_cover_card()
    draw = ImageDraw.Draw(card)
    left, right, y = 28, card.width - 28, 22
    label_row, strip_height, arrow_gap, subject_height = 40, 104, 50, 44

    kit.panel_label(draw, (left, y + label_row // 2 - 2), "Before", "a form entry comes in (shown here as text)")
    y += label_row
    card.paste(form_strip((right - left, strip_height)), (left, y))
    y += strip_height
    kit.arrow(draw, ((left + right) // 2, y + arrow_gap // 2), "down", size=36)
    y += arrow_gap

    kit.panel_label(draw, (left, y + label_row // 2 - 2), "After", "it lands in the sheet with a status and an owner", fill=kit.TEAL)
    y += label_row
    box, sheet_scale = kit.place(card, sheet, (left, y, right, card.height), kit.MAX_CAPTURE_UPSCALE, align="left", valign="top")
    y = box[3] + 16
    scales = [sheet_scale]
    if subject is not None and y + subject_height <= card.height - 16:
        note = "and its owner gets an alert:"
        kit.text(draw, (left, y + subject_height // 2), note, 22, "regular", kit.SLATE, anchor="lm")
        x = left + round(kit.text_width(note, 22)) + 18
        _, subject_scale = kit.place(card, subject, (x, y, right, y + subject_height), kit.MAX_CAPTURE_UPSCALE,
                                     align="left", valign="center")
        scales.append(subject_scale)

    made = kit.cover(card, COVER_HEADLINE, out_dir / COVER_FILE)
    used = [sheets[0].name] + ([subjects[0].name] if len(scales) == 2 else [])
    print(f"  cover: {COVER_FILE}  {kit.WIDTH}x{kit.HEIGHT}  cover-safe, {made['style']} style, headline at "
          f"{made['headline_size']} px, captures at {', '.join(f'{s:.2f}x' for s in scales)}  from {', '.join(used)}")
    print(f"    everything drawn sits in {made['drawn']}, inside the safe band {kit.COVER_BAND}")
    if previews:
        written = kit.cover_previews(made["path"], previews)
        print(f"    previews in {previews.name}\\: " + ", ".join(path.name for path in written.values()))
    return {**made, "scales": scales, "sources": used}


def card_form_to_sheet(parts: list[Image.Image]) -> tuple[Image.Image, float]:
    """Before: the form entry. After: the sheet rows, with the script's two columns boxed."""
    sheet = boxed_sheet(parts[0])
    left, top, right, bottom = kit.inner(kit.new_card())
    scale = min(kit.MAX_CAPTURE_UPSCALE, (right - left) / sheet.width)
    usable = bottom - top - kit.ARROW_GAP - 2 * kit.LABEL_ROW
    before_height = usable - round(sheet.height * scale)
    card, scales = kit.before_after(
        form_panel((right - left, before_height)), sheet, orientation="vertical", share=before_height / usable,
        before_note="a form entry comes in (shown here as text)",
        after_note="it lands in the sheet with a status and an owner, filled in by the script",
        after_upscale=kit.MAX_CAPTURE_UPSCALE)
    return card, scales[1]


def card_email(parts: list[Image.Image]) -> tuple[Image.Image, float]:
    """The subject line and the body, stacked under small labels, centred on the card."""
    card = kit.new_card()
    left, top, right, bottom = kit.inner(card)
    labels = EMAIL_LABELS if len(parts) == len(EMAIL_LABELS) else ("",) * len(parts)
    block, scale = kit.labelled_stack(list(zip(labels, parts)), right - left, bottom - top)
    kit.place(card, block, (left, top, right, bottom), max_upscale=1.0)
    return card, scale


def card_summary(parts: list[Image.Image]) -> tuple[Image.Image, float]:
    """The summary email on the left, what it contains on the right."""
    card = kit.new_card()
    left, top, right, bottom = kit.inner(card)
    points_width = 430
    labels = EMAIL_LABELS if len(parts) == len(EMAIL_LABELS) else ("",) * len(parts)
    block, scale = kit.labelled_stack(list(zip(labels, parts)), right - left - points_width - 60, bottom - top)
    box, _ = kit.place(card, block, (left, top, right - points_width - 60, bottom), max_upscale=1.0, align="left")
    x = box[2] + 60
    draw = ImageDraw.Draw(card)
    kit.text(draw, (x, box[1] + 6), "What's in it", 26, "semibold", kit.SLATE)
    kit.bullet_list(card, (x, box[1] + 64, right, bottom), SUMMARY_POINTS, size=28)
    return card, scale


def card_plain(parts: list[Image.Image]) -> tuple[Image.Image, float]:
    """One or more captures, stacked and centred."""
    card = kit.new_card()
    left, top, right, bottom = kit.inner(card)
    block, scale = kit.labelled_stack([("", part) for part in parts], right - left, bottom - top)
    kit.place(card, block, (left, top, right, bottom), max_upscale=1.0)
    return card, scale


LAYOUTS = {"form_to_sheet": card_form_to_sheet, "email": card_email, "summary": card_summary, "plain": card_plain}


def shot_number(path: Path) -> str | None:
    """The number a capture's name starts with: '2' for 2a-alert-subject.png."""
    digits = re.match(r"\d+", path.name)
    return digits.group() if digits else None


def frame_all(raw_dir: Path, out_dir: Path, crops: dict[str, dict[str, int]], thumbnails: Path | None = None) -> list[dict]:
    """Frame every shot that has captures. Returns one record per image written."""
    captures = sorted(p for p in raw_dir.glob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
    for path in captures:
        if shot_number(path) not in SHOTS:
            print(f"  {path.name}: its name doesn't start with a shot number ({', '.join(SHOTS)}) - not used")
    records = []
    for number, shot in SHOTS.items():
        sources = [p for p in captures if shot_number(p) == number]
        if not sources:
            print(f"  shot {number}: no capture starting with '{number}' in {raw_dir.name}\\ - skipped")
            continue
        parts = [load(p, crops.get(p.name)) for p in sources]
        card, scale = LAYOUTS[shot.layout](parts)
        out_path = kit.compose(card, shot.caption, out_dir / shot.file_name)
        if thumbnails:
            kit.thumbnail(out_path, thumbnails)
        used = ", ".join(p.name + (f" (cropped: {crops[p.name]})" if p.name in crops else "") for p in sources)
        print(f"  shot {number}: {shot.file_name}  {kit.WIDTH}x{kit.HEIGHT}  captures at {scale:.2f}x  from {used}")
        records.append({"path": out_path, "scale": scale, "sources": [p.name for p in sources],
                        "sizes": [part.size for part in parts]})
    return records


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def self_test() -> int:
    """Frame made-up placeholder captures and check the results."""
    raw, out = WORK_DIR / "raw", WORK_DIR / "framed"
    raw.mkdir(parents=True, exist_ok=True)
    for stale in [*raw.glob("*.png"), *out.glob("*.png")]:
        stale.unlink()
    placeholders = {  # named and sized like real captures
        "1-sheet.png": (1181, 145),
        "2a-alert-subject.png": (900, 60),
        "2b-alert-body.png": (760, 520),
        "3a-summary-subject.png": (300, 30),
        "3b-summary-body.png": (480, 260),
        "notes.png": (200, 80),
    }
    for name, size in placeholders.items():
        image = Image.new("RGBA", size, "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, size[0] - 1, size[1] - 1), outline=kit.SLATE, width=3)
        kit.text(draw, (12, 4), f"placeholder {name}", 16, "regular", kit.INK)
        image.save(raw / name, "PNG")
    before = {name: digest(raw / name) for name in placeholders}

    print(f"Self-test (showcase kit {kit.__version__}): framing placeholder captures")
    crops = {"1-sheet.png": CROPS["1-sheet.png"], "2b-alert-body.png": {"bottom": 20}}
    records = frame_all(raw, out, crops)
    by_name = {record["path"].name: record for record in records}

    assert list(by_name) == [SHOTS[n].file_name for n in ("1", "2", "3")], list(by_name)
    assert not (out / SHOTS["4"].file_name).exists()
    assert by_name[SHOTS["2"].file_name]["sources"] == ["2a-alert-subject.png", "2b-alert-body.png"]
    assert by_name[SHOTS["3"].file_name]["sources"] == ["3a-summary-subject.png", "3b-summary-body.png"]
    assert by_name[SHOTS["2"].file_name]["sizes"] == [(900, 60), (760, 500)], "the 20 px bottom crop was not applied"
    assert by_name[SHOTS["1"].file_name]["sizes"] == [(724, 122)], "the sheet crop (left, right, top) was not applied"
    assert {name: digest(raw / name) for name in placeholders} == before, "a raw capture was changed"
    for record in records:
        assert record["scale"] <= kit.MAX_CAPTURE_UPSCALE, record
        with Image.open(record["path"]) as image:
            assert image.size == (kit.WIDTH, kit.HEIGHT) and not image.info, (image.size, image.info)
    assert by_name[SHOTS["3"].file_name]["scale"] == kit.MAX_CAPTURE_UPSCALE, "small captures should be doubled, no more"
    assert by_name[SHOTS["2"].file_name]["scale"] < kit.MAX_CAPTURE_UPSCALE, "a wide capture is limited by the card width"
    fields = featured_response()
    assert [question for question, _ in fields] == ["Your name", "Location", "Request type", "Priority", "What do you need?"]
    assert all(answer and "@" not in answer for _, answer in fields)
    for shot in SHOTS.values():
        assert 4 <= len(shot.caption.split()) <= 8, shot.caption

    # The cover: built from the same captures, cover-safe, captures at 2x or less.
    cover = build_cover(raw, out, crops, None)
    assert cover is not None and cover["path"].name == COVER_FILE
    assert cover["sources"] == ["1-sheet.png", "2a-alert-subject.png"], cover["sources"]
    assert all(scale <= kit.MAX_CAPTURE_UPSCALE for scale in cover["scales"]), cover["scales"]
    assert cover["headline_size"] >= 64 and 4 <= len(COVER_HEADLINE.split()) <= 8
    assert all(kit.inside(box, kit.COVER_BAND) for box in cover["boxes"].values()), cover["boxes"]
    assert kit.inside(cover["drawn"], kit.COVER_BAND), cover["drawn"]
    with Image.open(cover["path"]) as image:
        assert image.size == (kit.WIDTH, kit.HEIGHT) and not image.info
    assert set(COVER_FIELDS) <= {question for question, _ in fields}
    assert {name: digest(raw / name) for name in placeholders} == before, "a raw capture was changed by the cover"

    print(f"Self-test passed: {len(records)} images framed at {kit.WIDTH}x{kit.HEIGHT}; parts stacked by shot number; "
          f"crops applied; raw files unchanged; no capture enlarged beyond {kit.MAX_CAPTURE_UPSCALE:.0f}x; "
          "form entry read from the sample data; shot 4 skipped as expected; "
          "cover built inside the safe band with its headline at 64 px or more")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    if not RAW_DIR.is_dir():
        print(f"No {RAW_DIR.relative_to(ROOT)} folder yet. Save the captures there first (see DEPLOY.md).")
        return 1
    print(f"Framing captures from {RAW_DIR.relative_to(ROOT)}\\ (showcase kit {kit.__version__})")
    before = {p.name: digest(p) for p in RAW_DIR.glob("*") if p.is_file()}
    records = frame_all(RAW_DIR, SHOTS_DIR, CROPS, thumbnails=WORK_DIR)
    cover = build_cover(RAW_DIR, SHOTS_DIR, CROPS, WORK_DIR)
    unchanged = before == {p.name: digest(p) for p in RAW_DIR.glob("*") if p.is_file()}
    print(f"{len(records) + (cover is not None)} image(s) written to {SHOTS_DIR.relative_to(ROOT)}\\; "
          f"raw captures {'unchanged' if unchanged else 'CHANGED'}; 400 px copies in screenshots\\_work\\")
    return 0 if records and unchanged else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
