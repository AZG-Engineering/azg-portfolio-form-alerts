"""Turn the raw screen captures from DEPLOY.md into the finished 1600x1200 images.

Usage:
    python tools\\frame_screenshots.py              frame screenshots\\raw\\ into screenshots\\
    python tools\\frame_screenshots.py --self-test  check the tool with made-up placeholder captures

Each finished image is a composite: a title strip with a caption, the capture
scaled to fill the rest, and "Demo - sample data" at the bottom right. Captures
whose file names start with the same number are stacked top to bottom into one
image, so an email's subject line and its body can be captured separately,
leaving out the line with the addresses between them.

The captures are re-drawn, not copied, so nothing hidden in the original file
(such as who captured it) carries over. What is visible in a capture is NOT
checked: crop out addresses and the account picture when capturing, as DEPLOY.md
says.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTS_DIR = ROOT / "screenshots"
RAW_DIR = SHOTS_DIR / "raw"
WORK_DIR = SHOTS_DIR / "_work"
FONTS = Path(r"C:\Windows\Fonts")

# Shot number -> (finished file name, caption on the title strip: 4 to 8 words).
SHOTS = {
    "1": ("1-sheet-status-and-assignee.png", "New form entries get an owner automatically"),
    "2": ("2-alert-email.png", "Each new request sends an alert email"),
    "3": ("3-daily-summary-email.png", "A daily summary lists what's still open"),
    "4": ("4-run-log.png", "Every run is recorded in a log"),
}

WIDTH, HEIGHT = 1600, 1200
STRIP_HEIGHT = 104
MARGIN = 40
CONTENT_BOX = (MARGIN, STRIP_HEIGHT + 28, WIDTH - MARGIN, HEIGHT - 56)
BACKGROUND = "#F4F6F8"
STRIP = "#1F3A5F"
FOOTNOTE = "Demo \u00b7 sample data"
STACK_GAP = 18
CARD_PAD = 14


def font(file_name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / file_name), size)


def fit(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    scale = min(max_width / image.width, max_height / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS)


def stack(parts: list[Image.Image]) -> Image.Image:
    """Captures top to bottom on one white card, all scaled to the widest one."""
    width = max(part.width for part in parts)
    scaled = [part if part.width == width else fit(part, width, 100_000) for part in parts]
    height = sum(part.height for part in scaled) + STACK_GAP * (len(scaled) - 1)
    card = Image.new("RGB", (width + 2 * CARD_PAD, height + 2 * CARD_PAD), "white")
    y = CARD_PAD
    for part in scaled:
        card.paste(part, (CARD_PAD, y))
        y += part.height + STACK_GAP
    ImageDraw.Draw(card).rectangle((0, 0, card.width - 1, card.height - 1), outline="#C5CCD3", width=2)
    return card


def compose(content: Image.Image, caption: str, out_path: Path) -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, WIDTH, STRIP_HEIGHT), fill=STRIP)
    draw.text((MARGIN + 8, STRIP_HEIGHT // 2), caption, font=font("seguisb.ttf", 50), fill="white", anchor="lm")

    left, top, right, bottom = CONTENT_BOX
    scaled = fit(content, right - left, bottom - top)
    canvas.paste(scaled, (left + (right - left - scaled.width) // 2, top + (bottom - top - scaled.height) // 2))

    draw.text((WIDTH - MARGIN, HEIGHT - 28), FOOTNOTE, font=font("segoeui.ttf", 22), fill="#8A94A0", anchor="rm")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG")


def load(path: Path) -> Image.Image:
    """Open a capture and re-draw it as plain RGB, dropping any embedded metadata."""
    with Image.open(path) as image:
        plain = Image.new("RGB", image.size, "white")
        plain.paste(image.convert("RGBA"), mask=image.convert("RGBA").split()[3])
        return plain


def frame_all(raw_dir: Path, out_dir: Path) -> list[Path]:
    captures = sorted(p for p in raw_dir.glob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg"))
    written = []
    for number, (file_name, caption) in SHOTS.items():
        parts = [p for p in captures if p.name.startswith(number)]
        if not parts:
            print(f"  shot {number}: no capture starting with '{number}' in {raw_dir.name}\\ - skipped")
            continue
        out_path = out_dir / file_name
        compose(stack([load(p) for p in parts]), caption, out_path)
        with Image.open(out_path) as check:
            assert check.size == (WIDTH, HEIGHT), check.size
            assert not check.info, check.info
        written.append(out_path)
        print(f"  shot {number}: {file_name}  {WIDTH}x{HEIGHT}  from {', '.join(p.name for p in parts)}")
    return written


def self_test() -> int:
    """Frame made-up placeholder captures and check the results."""
    raw, out = WORK_DIR / "raw", WORK_DIR / "framed"
    raw.mkdir(parents=True, exist_ok=True)
    for stale in [*raw.glob("*.png"), *out.glob("*.png")]:
        stale.unlink()
    placeholders = {
        "1-sheet.png": (1400, 420),
        "2a-subject.png": (900, 60),
        "2b-body.png": (760, 520),
        "3-summary.png": (700, 900),
    }
    for name, size in placeholders.items():
        image = Image.new("RGBA", size, "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0, size[0] - 1, size[1] - 1), outline="#9AA5B1", width=3)
        draw.text((20, 14), f"placeholder capture {name}", font=font("segoeui.ttf", 28), fill="#333333")
        image.save(raw / name, "PNG")

    print("Self-test: framing placeholder captures")
    written = frame_all(raw, out)
    assert [p.name for p in written] == [SHOTS[n][0] for n in ("1", "2", "3")], written
    assert not (out / SHOTS["4"][0]).exists()
    for caption in (caption for _, caption in SHOTS.values()):
        assert 4 <= len(caption.split()) <= 8, caption
        assert font("seguisb.ttf", 50).getlength(caption) < WIDTH - 2 * MARGIN, caption
    print(f"Self-test passed: {len(written)} images framed at {WIDTH}x{HEIGHT}, shot 4 skipped as expected")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    if not RAW_DIR.is_dir():
        print(f"No {RAW_DIR.relative_to(ROOT)} folder yet. Save the captures there first (see DEPLOY.md).")
        return 1
    print(f"Framing captures from {RAW_DIR.relative_to(ROOT)}\\")
    written = frame_all(RAW_DIR, SHOTS_DIR)
    print(f"{len(written)} image(s) written to {SHOTS_DIR.relative_to(ROOT)}\\")
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
