"""AZG showcase image kit: the screenshot template of the AZG build style guide (section 5).

Every showcase image is a 1600x1200 PNG composite:

    navy title strip with a 4-8 word caption (Inter SemiBold)
    surface-grey background
    one white card (1 px line border, 40 px outer margin) holding the content
    "Demo - sample data" at the bottom right

How to use it from a build's screenshot tool:

    import showcase as kit
    card = kit.new_card()                       # a white 1520x996 image to draw on
    kit.place(card, export_image, kit.inner(card))
    kit.compose(card, "Overdue tasks flag themselves", out_path)

Helpers cover the usual layouts: place() scales an image to fill a box,
before_after() builds the two-panel layout with a teal arrow, labelled_stack()
stacks captures under small labels, headline() writes a big number line.

Screen captures are never enlarged beyond 2x (MAX_CAPTURE_UPSCALE): pass
max_upscale to place() or labelled_stack(). Vector exports (PDF pages) can be
rendered at any size before they are passed in.

The fonts are the Inter files in the fonts folder next to this module. No system
font is used.

    python showcase.py --self-test     check the kit; writes samples to _work\\
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

__version__ = "1.0.0"  # template for style guide v1.0

FONTS = Path(__file__).resolve().parent / "fonts"
FONT_FILES = {"regular": "Inter-Regular.ttf", "semibold": "Inter-SemiBold.ttf"}

# Style guide section 2.
NAVY, INK, SLATE = "#1F3A5F", "#1F2937", "#5B6B7F"
LINE, SURFACE, WHITE = "#E2E8F0", "#F5F7FA", "#FFFFFF"
TEAL, RED, GREEN = "#0F766E", "#B42318", "#2E7D32"
AMBER_FILL, AMBER_TEXT = "#FDE7B0", "#7A4A00"

# Style guide section 5.
WIDTH, HEIGHT = 1600, 1200
STRIP_HEIGHT = 104
MARGIN = 40
CARD_BOX = (MARGIN, STRIP_HEIGHT + MARGIN, WIDTH - MARGIN, HEIGHT - 60)
CARD_SIZE = (CARD_BOX[2] - CARD_BOX[0], CARD_BOX[3] - CARD_BOX[1])  # 1520 x 996
PAD = 32  # space kept clear inside the card's edge
CAPTION_LEFT = 48
CAPTION_SIZES = (48, 44)
FOOTNOTE = "Demo · sample data"
MAX_CAPTURE_UPSCALE = 2.0
MIN_READABLE_PX, MIN_HEADLINE_PX = 20, 72

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(weight: str = "regular", size: int = 24) -> ImageFont.FreeTypeFont:
    key = (weight, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(str(FONTS / FONT_FILES[weight]), size)
    return _font_cache[key]


def text_width(string: str, size: int = 24, weight: str = "regular") -> float:
    return font(weight, size).getlength(string)


def text(draw: ImageDraw.ImageDraw, xy, string: str, size: int = 24, weight: str = "regular",
         fill: str = INK, anchor: str = "la") -> None:
    draw.text(xy, string, font=font(weight, size), fill=fill, anchor=anchor)


def wrap(string: str, max_width: float, size: int = 24, weight: str = "regular") -> list[str]:
    """Break text into lines no wider than max_width."""
    lines, current = [], ""
    for word in string.split():
        candidate = f"{current} {word}".strip()
        if current and text_width(candidate, size, weight) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    return lines + [current] if current else lines


def new_card() -> Image.Image:
    return Image.new("RGB", CARD_SIZE, WHITE)


def inner(card: Image.Image, pad: int = PAD) -> tuple[int, int, int, int]:
    """The card's area inside its padding, as (left, top, right, bottom)."""
    return pad, pad, card.width - pad, card.height - pad


def scale_to_fit(image: Image.Image, max_width: float, max_height: float,
                 max_upscale: float | None = None) -> tuple[Image.Image, float]:
    """Scale an image to fill a space, keeping its shape. Returns (image, scale used)."""
    scale = min(max_width / image.width, max_height / image.height)
    if max_upscale is not None:
        scale = min(scale, max_upscale)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.convert("RGB").resize(size, Image.LANCZOS), scale


def place(card: Image.Image, image: Image.Image, box, max_upscale: float | None = None,
          align: str = "center", valign: str = "center", border: bool = False) -> tuple[tuple[int, int, int, int], float]:
    """Scale an image to fill box (left, top, right, bottom) on the card and paste it.

    Returns where it landed and the scale used.
    """
    left, top, right, bottom = box
    scaled, scale = scale_to_fit(image, right - left, bottom - top, max_upscale)
    x = {"left": left, "center": left + (right - left - scaled.width) // 2, "right": right - scaled.width}[align]
    y = {"top": top, "center": top + (bottom - top - scaled.height) // 2, "bottom": bottom - scaled.height}[valign]
    card.paste(scaled, (x, y))
    if border:
        ImageDraw.Draw(card).rectangle((x - 1, y - 1, x + scaled.width, y + scaled.height), outline=LINE)
    return (x, y, x + scaled.width, y + scaled.height), scale


def headline(card: Image.Image, string: str, center_x: int, center_y: int, size: int = 84, fill: str = NAVY) -> None:
    """A big one-line result, e.g. '10 files, 8 OK, 2 need review'."""
    if size < MIN_HEADLINE_PX:
        raise ValueError(f"A headline is {MIN_HEADLINE_PX} px or more, so it reads at thumbnail size")
    text(ImageDraw.Draw(card), (center_x, center_y), string, size, "semibold", fill, anchor="mm")


def arrow(draw: ImageDraw.ImageDraw, center: tuple[int, int], direction: str = "right", size: int = 56) -> None:
    """The teal arrow between a Before and an After panel."""
    cx, cy = center
    shaft, half = size // 5, size // 2
    if direction == "right":
        draw.rectangle((cx - half, cy - shaft // 2, cx, cy + shaft // 2), fill=TEAL)
        draw.polygon(((cx, cy - half * 2 // 3), (cx + half, cy), (cx, cy + half * 2 // 3)), fill=TEAL)
    else:  # down
        draw.rectangle((cx - shaft // 2, cy - half, cx + shaft // 2, cy), fill=TEAL)
        draw.polygon(((cx - half * 2 // 3, cy), (cx + half * 2 // 3, cy), (cx, cy + half)), fill=TEAL)


def panel_label(draw: ImageDraw.ImageDraw, xy, label: str, note: str = "", fill: str = SLATE) -> None:
    """'Before' or 'After', with an optional note after it."""
    text(draw, xy, label, 28, "semibold", fill, anchor="lm")
    if note:
        text(draw, (xy[0] + text_width(label, 28, "semibold") + 16, xy[1]), note, 22, "regular", SLATE, anchor="lm")


LABEL_ROW = 52  # height of the Before / After label line
ARROW_GAP = 84  # space between the two panels, holding the arrow


def before_after(before: Image.Image, after: Image.Image, orientation: str = "horizontal", share: float = 0.5,
                 before_note: str = "", after_note: str = "", before_upscale: float | None = None,
                 after_upscale: float | None = None, border: bool = True) -> tuple[Image.Image, tuple[float, float]]:
    """A card with a Before panel and an After panel and a teal arrow between them.

    orientation: 'horizontal' puts them side by side; 'vertical' puts Before on top,
                 for content that is wide and short.
    share:       how much of the space the Before panel takes (0.5 = half).
    Returns the card and the two scales used.
    """
    card = new_card()
    draw = ImageDraw.Draw(card)
    left, top, right, bottom = inner(card)
    if orientation == "horizontal":
        usable = right - left - ARROW_GAP
        split = left + round(usable * share)
        boxes = ((left, top + LABEL_ROW, split, bottom), (split + ARROW_GAP, top + LABEL_ROW, right, bottom))
        labels = ((left, top + LABEL_ROW // 2 - 4), (split + ARROW_GAP, top + LABEL_ROW // 2 - 4))
        arrow(draw, (split + ARROW_GAP // 2, (top + LABEL_ROW + bottom) // 2), "right")
    else:
        usable = bottom - top - ARROW_GAP - 2 * LABEL_ROW
        split = top + LABEL_ROW + round(usable * share)
        boxes = ((left, top + LABEL_ROW, right, split), (left, split + ARROW_GAP + LABEL_ROW, right, bottom))
        labels = ((left, top + LABEL_ROW // 2 - 4), (left, split + ARROW_GAP + LABEL_ROW // 2 - 4))
        arrow(draw, ((left + right) // 2, split + ARROW_GAP // 2), "down")
    panel_label(draw, labels[0], "Before", before_note)
    panel_label(draw, labels[1], "After", after_note, fill=TEAL)
    _, before_scale = place(card, before, boxes[0], before_upscale, valign="top", border=border)
    _, after_scale = place(card, after, boxes[1], after_upscale, valign="top", border=border)
    return card, (before_scale, after_scale)


def labelled_stack(parts: list[tuple[str, Image.Image]], max_width: float, max_height: float,
                   max_upscale: float | None = MAX_CAPTURE_UPSCALE, gap: int = 22) -> tuple[Image.Image, float]:
    """Images top to bottom, each under a small slate label, all at one shared scale.

    Returns the stacked block (white background) and the scale used.
    """
    label_row = 34
    labels = [label for label, _ in parts if label]
    fixed = gap * (len(parts) - 1) + label_row * len(labels)
    scale = min(max_width / max(image.width for _, image in parts),
                (max_height - fixed) / sum(image.height for _, image in parts))
    if max_upscale is not None:
        scale = min(scale, max_upscale)
    scaled = [(label, image.convert("RGB").resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                                                  Image.LANCZOS)) for label, image in parts]
    block = Image.new("RGB", (max(image.width for _, image in scaled), sum(image.height for _, image in scaled) + fixed), WHITE)
    draw = ImageDraw.Draw(block)
    y = 0
    for label, image in scaled:
        if label:
            text(draw, (0, y + label_row // 2 - 2), label, 20, "regular", SLATE, anchor="lm")
            y += label_row
        block.paste(image, (0, y))
        y += image.height + gap
    return block, scale


def bullet_list(card: Image.Image, box, items: list[str], size: int = 28, gap: int = 26) -> None:
    """Short points with a teal marker, top-aligned in box. Long points wrap."""
    draw = ImageDraw.Draw(card)
    left, top, right, _ = box
    y = top
    for item in items:
        draw.rectangle((left, y + size // 2 - 5, left + 10, y + size // 2 + 5), fill=TEAL)
        for line in wrap(item, right - left - 30, size):
            text(draw, (left + 30, y), line, size, "regular", INK)
            y += round(size * 1.35)
        y += gap


def compose(card: Image.Image, caption: str, out_path: Path) -> Path:
    """Put the card into the template and write the finished 1600x1200 PNG."""
    if card.size != CARD_SIZE:
        raise ValueError(f"The card must be {CARD_SIZE[0]}x{CARD_SIZE[1]}; this one is {card.size[0]}x{card.size[1]}")
    if not 4 <= len(caption.split()) <= 8:
        raise ValueError(f"A caption is 4 to 8 words: {caption!r}")
    sizes = [size for size in CAPTION_SIZES if text_width(caption, size, "semibold") <= WIDTH - 2 * CAPTION_LEFT]
    if not sizes:
        raise ValueError(f"The caption is too long for the title strip: {caption!r}")

    canvas = Image.new("RGB", (WIDTH, HEIGHT), SURFACE)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, WIDTH, STRIP_HEIGHT - 1), fill=NAVY)
    text(draw, (CAPTION_LEFT, STRIP_HEIGHT // 2), caption, sizes[0], "semibold", WHITE, anchor="lm")
    canvas.paste(card.convert("RGB"), CARD_BOX[:2])
    draw.rectangle((CARD_BOX[0], CARD_BOX[1], CARD_BOX[2] - 1, CARD_BOX[3] - 1), outline=LINE, width=1)
    text(draw, (WIDTH - MARGIN, (CARD_BOX[3] + HEIGHT) // 2), FOOTNOTE, 20, "regular", SLATE, anchor="rm")

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path, "PNG")
    with Image.open(out_path) as check:
        assert check.size == (WIDTH, HEIGHT) and check.mode == "RGB" and not check.info, (check.size, check.mode, check.info)
    return out_path


def thumbnail(path: Path, out_dir: Path, width: int = 400) -> Path:
    """A small copy, to check the headline still reads at thumbnail size."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{Path(path).stem}-{width}.png"
    with Image.open(path) as image:
        image.resize((width, round(image.height * width / image.width)), Image.LANCZOS).save(out_path, "PNG")
    return out_path


# ---- Self-test ----------------------------------------------------------------

def _placeholder(size: tuple[int, int], label: str, fill: str = "#DCE6F2") -> Image.Image:
    image = Image.new("RGB", size, fill)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, size[0] - 1, size[1] - 1), outline=SLATE, width=2)
    text(draw, (12, 10), label, 20, "regular", INK)
    return image


def _rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def self_test() -> int:
    out = Path(__file__).resolve().parent / "_work"
    out.mkdir(exist_ok=True)
    for stale in out.glob("*.png"):
        stale.unlink()

    for weight, expected in (("regular", "Regular"), ("semibold", "Semi Bold")):
        family, style = font(weight, 24).getname()
        assert family == "Inter" and style.replace(" ", "") == expected.replace(" ", ""), (family, style)
    assert "SIL OPEN FONT LICENSE Version 1.1" in (FONTS / "OFL.txt").read_text(encoding="utf-8")
    assert CARD_SIZE == (1520, 996)

    # 1. One export filling the card, with a headline above it.
    card = new_card()
    left, top, right, bottom = inner(card)
    headline(card, "10 files · 8 OK · 2 need review", card.width // 2, top + 60)
    rect, scale = place(card, _placeholder((900, 300), "an export"), (left, top + 140, right, bottom))
    assert rect[0] >= left and rect[2] <= right and rect[1] >= top + 140 and rect[3] <= bottom
    assert abs(scale - (right - left) / 900) < 1e-6, "a vector export fills the box"
    first = compose(card, "Unreadable invoices flagged, never guessed", out / "1-fill.png")

    # 2. A screen capture is never enlarged beyond 2x.
    card = new_card()
    rect, scale = place(card, _placeholder((300, 120), "a small capture"), inner(card), max_upscale=MAX_CAPTURE_UPSCALE)
    assert scale == MAX_CAPTURE_UPSCALE and rect[2] - rect[0] == 600, (scale, rect)
    compose(card, "A small capture stays sharp", out / "2-capture.png")

    # 3. Before / after, side by side and stacked.
    card, scales = before_after(_placeholder((500, 700), "before"), _placeholder((700, 500), "after", "#D7EFEA"),
                                share=0.42, before_note="the task list", after_note="the dashboard")
    compose(card, "From a task list to a dashboard", out / "3-before-after.png")
    card, scales = before_after(_placeholder((1200, 500), "before"), _placeholder((1200, 90), "after", "#D7EFEA"),
                                orientation="vertical", share=0.72, after_upscale=MAX_CAPTURE_UPSCALE)
    assert scales[1] <= MAX_CAPTURE_UPSCALE
    compose(card, "Invoice in, spreadsheet row out", out / "4-before-after-stacked.png")

    # 4. Stacked captures share one scale, capped at 2x.
    block, scale = labelled_stack([("Subject", _placeholder((300, 30), "subject")), ("Email", _placeholder((480, 260), "body"))],
                                  1456, 900)
    assert scale == MAX_CAPTURE_UPSCALE and block.width == 960, (scale, block.size)
    card = new_card()
    place(card, block, inner(card), max_upscale=1.0)
    bullet_list(card, (1040, 120, 1480, 900), ["Grouped by owner", "Urgent first, then the oldest request"])
    compose(card, "A daily summary lists what's open", out / "5-stack.png")

    # The template itself.
    with Image.open(first) as image:
        assert image.size == (1600, 1200) and not image.info
        assert image.getpixel((5, 5)) == _rgb(NAVY), "title strip"
        assert image.getpixel((5, HEIGHT - 5)) == _rgb(SURFACE), "background"
        assert image.getpixel((CARD_BOX[0], CARD_BOX[1] + 50)) == _rgb(LINE), "card border"
        assert image.getpixel((CARD_BOX[0] + 3, CARD_BOX[1] + 3)) == _rgb(WHITE), "card"
        assert image.getpixel((CARD_BOX[0] - 5, CARD_BOX[1] + 50)) == _rgb(SURFACE), "40 px margin"
    small = thumbnail(first, out)
    with Image.open(small) as image:
        assert image.size == (400, 300)

    # Captions are checked.
    for bad in ("Too short", "This caption has far too many words to be allowed here"):
        try:
            compose(new_card(), bad, out / "bad.png")
        except ValueError:
            pass
        else:
            raise AssertionError(f"caption accepted: {bad!r}")
    try:
        headline(new_card(), "small", 100, 100, size=40)
    except ValueError:
        pass
    else:
        raise AssertionError("a 40 px headline was accepted")
    assert not (out / "bad.png").exists()

    written = sorted(p.name for p in out.glob("*.png"))
    print(f"showcase kit {__version__}: self-test passed ({len(written)} sample images in _work\\)")
    print("  checked: Inter Regular and SemiBold load; licence file is OFL 1.1; 1600x1200 RGB with no embedded fields;")
    print("  strip, background, card border and margin colours; fill-the-box scaling; 2x cap on captures;")
    print("  before/after side by side and stacked; shared-scale stack; captions of 4-8 words; 72 px headline minimum; 400 px thumbnail")
    return 0


if __name__ == "__main__":
    if "--self-test" in sys.argv[1:]:
        sys.exit(self_test())
    print(__doc__)
