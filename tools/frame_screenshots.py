"""Turn the raw screen captures from DEPLOY.md into the finished 1600x1200 images.

Usage:
    python tools\\frame_screenshots.py              frame screenshots\\raw\\ into screenshots\\
    python tools\\frame_screenshots.py --self-test  check the tool with made-up placeholder captures

Each finished image is a composite: a title strip with a caption, the capture on
a white card in the middle, and "Demo - sample data" at the bottom right.

- Captures whose file names start with the same number are stacked top to bottom
  into one image, so an email's subject line and its body can be captured
  separately, leaving out the line with the addresses between them.
- Captures are scaled up to fill the card, but never beyond twice their size, so
  the text stays sharp. All parts of one image share the same scale.
- CROPS trims a capture before framing. The raw file itself is never changed.

The captures are re-drawn, not copied, so nothing hidden in the original file
(such as who captured it) carries over. What is visible in a capture is NOT
checked: crop out addresses and the account picture when capturing, as DEPLOY.md
says.
"""

from __future__ import annotations

import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTS_DIR = ROOT / "screenshots"
RAW_DIR = SHOTS_DIR / "raw"
WORK_DIR = SHOTS_DIR / "_work"
FONTS = Path(r"C:\Windows\Fonts")


@dataclass(frozen=True)
class Shot:
    file_name: str  # the finished image
    caption: str  # on the title strip: 4 to 8 words
    labels: tuple[str, ...] = ()  # a small label above each stacked part, when the counts match


# Shot number -> the finished image. Captures are matched by the number their name starts with.
SHOTS = {
    "1": Shot("1-sheet-status-and-assignee.png", "New form entries get an owner automatically"),
    "2": Shot("2-alert-email.png", "Each new request sends an alert email", ("Subject", "Email")),
    "3": Shot("3-daily-summary-email.png", "A daily summary lists what's still open", ("Subject", "Email")),
    "4": Shot("4-run-log.png", "Every run is recorded in a log"),
}

# Pixels to trim from a capture before framing, by raw file name.
# 2b: the capture ends with the bare label "Open the sheet:" (the link after it was
# left out on purpose). 32 px takes off that line and the blank line above it.
CROPS = {
    "2b-alert-body.png": {"bottom": 32},
}

MAX_UPSCALE = 2.0  # never enlarge a capture beyond this, or its text goes soft

WIDTH, HEIGHT = 1600, 1200
STRIP_HEIGHT = 104
MARGIN = 40
CONTENT_BOX = (MARGIN, STRIP_HEIGHT + 28, WIDTH - MARGIN, HEIGHT - 56)
BACKGROUND = "#F4F6F8"
STRIP = "#1F3A5F"
FOOTNOTE = "Demo \u00b7 sample data"
STACK_GAP = 22
CARD_PAD = 28
LABEL_HEIGHT = 34


def font(file_name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / file_name), size)


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


def build_card(parts: list[Image.Image], labels: tuple[str, ...]) -> tuple[Image.Image, float]:
    """The captures top to bottom on one white card. Returns the card and the scale used."""
    if len(labels) != len(parts):
        labels = ()
    left, top, right, bottom = CONTENT_BOX
    fixed = 2 * CARD_PAD + STACK_GAP * (len(parts) - 1) + LABEL_HEIGHT * len(labels)
    scale = min(MAX_UPSCALE,
                (right - left - 2 * CARD_PAD) / max(part.width for part in parts),
                (bottom - top - fixed) / sum(part.height for part in parts))
    scaled = [part.resize((max(1, round(part.width * scale)), max(1, round(part.height * scale))), Image.LANCZOS)
              for part in parts]

    card = Image.new("RGB", (max(part.width for part in scaled) + 2 * CARD_PAD,
                             sum(part.height for part in scaled) + fixed), "white")
    draw = ImageDraw.Draw(card)
    y = CARD_PAD
    for index, part in enumerate(scaled):
        if labels:
            draw.text((CARD_PAD, y + LABEL_HEIGHT // 2 - 2), labels[index], font=font("segoeui.ttf", 22),
                      fill="#8A94A0", anchor="lm")
            y += LABEL_HEIGHT
        card.paste(part, (CARD_PAD, y))
        y += part.height + STACK_GAP
    draw.rectangle((0, 0, card.width - 1, card.height - 1), outline="#C5CCD3", width=2)
    return card, scale


def compose(card: Image.Image, caption: str, out_path: Path) -> None:
    """Title strip on top, the card centred in the rest, footnote bottom right."""
    canvas = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, WIDTH, STRIP_HEIGHT), fill=STRIP)
    draw.text((MARGIN + 8, STRIP_HEIGHT // 2), caption, font=font("seguisb.ttf", 50), fill="white", anchor="lm")

    left, top, right, bottom = CONTENT_BOX
    assert card.width <= right - left and card.height <= bottom - top, card.size
    canvas.paste(card, (left + (right - left - card.width) // 2, top + (bottom - top - card.height) // 2))

    draw.text((WIDTH - MARGIN, HEIGHT - 28), FOOTNOTE, font=font("segoeui.ttf", 22), fill="#8A94A0", anchor="rm")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG")


def shot_number(path: Path) -> str | None:
    """The number a capture's name starts with: '2' for 2a-alert-subject.png."""
    digits = re.match(r"\d+", path.name)
    return digits.group() if digits else None


def frame_all(raw_dir: Path, out_dir: Path, crops: dict[str, dict[str, int]]) -> list[dict]:
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
        card, scale = build_card(parts, shot.labels)
        out_path = out_dir / shot.file_name
        compose(card, shot.caption, out_path)
        with Image.open(out_path) as check:
            assert check.size == (WIDTH, HEIGHT), check.size
            assert not check.info, check.info
        used = ", ".join(p.name + (f" (cropped: {crops[p.name]})" if p.name in crops else "") for p in sources)
        print(f"  shot {number}: {shot.file_name}  {WIDTH}x{HEIGHT}  scale {scale:.2f}x  from {used}")
        records.append({"path": out_path, "scale": scale, "sources": [p.name for p in sources],
                        "sizes": [part.size for part in parts], "card": card.size})
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
        "1-sheet.png": (1400, 420),
        "2a-alert-subject.png": (900, 60),
        "2b-alert-body.png": (760, 520),
        "3a-summary-subject.png": (300, 30),
        "3b-summary-body.png": (480, 260),
        "notes.png": (200, 80),
    }
    for name, size in placeholders.items():
        image = Image.new("RGBA", size, "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, size[0] - 1, size[1] - 1), outline="#9AA5B1", width=3)
        draw.text((12, 4), f"placeholder {name}", font=font("segoeui.ttf", 16), fill="#333333")
        image.save(raw / name, "PNG")
    before = {name: digest(raw / name) for name in placeholders}

    print("Self-test: framing placeholder captures")
    records = frame_all(raw, out, {"2b-alert-body.png": {"bottom": 20}})
    by_name = {record["path"].name: record for record in records}

    assert list(by_name) == [SHOTS[n].file_name for n in ("1", "2", "3")], list(by_name)
    assert not (out / SHOTS["4"].file_name).exists()
    assert by_name[SHOTS["2"].file_name]["sources"] == ["2a-alert-subject.png", "2b-alert-body.png"]
    assert by_name[SHOTS["3"].file_name]["sources"] == ["3a-summary-subject.png", "3b-summary-body.png"]
    assert by_name[SHOTS["2"].file_name]["sizes"] == [(900, 60), (760, 500)], "the 20 px crop was not applied"
    assert {name: digest(raw / name) for name in placeholders} == before, "a raw capture was changed"
    left, top, right, bottom = CONTENT_BOX
    for record in records:
        assert record["scale"] <= MAX_UPSCALE, record
        assert record["card"][0] <= right - left and record["card"][1] <= bottom - top, record
    assert by_name[SHOTS["3"].file_name]["scale"] == MAX_UPSCALE, "small captures should be doubled, no more"
    assert by_name[SHOTS["1"].file_name]["scale"] < MAX_UPSCALE, "a wide capture is limited by the card width"
    for shot in SHOTS.values():
        assert 4 <= len(shot.caption.split()) <= 8, shot.caption
        assert font("seguisb.ttf", 50).getlength(shot.caption) < WIDTH - 2 * MARGIN, shot.caption
    print(f"Self-test passed: {len(records)} images framed at {WIDTH}x{HEIGHT}; parts stacked by shot number; "
          f"crop applied; raw files unchanged; no capture enlarged beyond {MAX_UPSCALE:.0f}x; shot 4 skipped as expected")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    if not RAW_DIR.is_dir():
        print(f"No {RAW_DIR.relative_to(ROOT)} folder yet. Save the captures there first (see DEPLOY.md).")
        return 1
    print(f"Framing captures from {RAW_DIR.relative_to(ROOT)}\\")
    before = {p.name: digest(p) for p in RAW_DIR.glob("*") if p.is_file()}
    records = frame_all(RAW_DIR, SHOTS_DIR, CROPS)
    unchanged = before == {p.name: digest(p) for p in RAW_DIR.glob("*") if p.is_file()}
    print(f"{len(records)} image(s) written to {SHOTS_DIR.relative_to(ROOT)}\\; "
          f"raw captures {'unchanged' if unchanged else 'CHANGED'}")
    return 0 if records and unchanged else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
