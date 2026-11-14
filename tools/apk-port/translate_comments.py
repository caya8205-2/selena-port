"""Translate the remaining upstream (Chinese) source comments to English.

Comment blocks are addressed by document order per file, so the mapping does
not depend on retyping CJK text. Only comment payloads are rewritten; code,
strings and layout are untouched.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import translate_ui

WEB = r"C:\Users\Caya\Desktop\Project\pgr-local\web-en"
CJK = re.compile(r'[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]')

MAP = {
    "gm/index.html": [
        "The banner pushes the whole page down a little and the sidebar follows; the topbar is not "
        "sticky and sits right beneath the banner",
        "Selector: search on the left, dropdown on the right (custom-drawn, no native select)",
        "Fixed design width: neutralises the responsive branches so every screen uses the same layout",
        " ===== Lua patch (injection) ===== ",
    ],
    "gm/gm.js": [
        "--- Design mode was removed from the UI; initialisation is short-circuited here so stale "
        "references do not throw ---",
        "Mobile WebView: focusing an input pops the keyboard and pushes the list away.",
        "Read-only by default; a tap only expands the list. The search button enables real search "
        "(typing allowed).",
        "Collapsing leaves search mode so the keyboard does not pop up again on the next tap",
        "pointerdown selects the instant the finger lands, which makes the list impossible to scroll.",
        "Use click instead: browsers only fire it on press+release with no scroll in between.",
        " * Inserts an Execute button to the right of each page's \"Select ...\" panel title.\n"
        " * Tapping it runs the page's primary command directly, so there is no need to scroll\n"
        " * down to the global Execute button at the bottom.",
        "primaryCommand() depends on the current page",
        "Design mode was removed from the UI; initDesignMode() is no longer called,",
        "otherwise #designDock is null and throws, which stops loadData() from running "
        "(all dropdowns end up empty).",
    ],
    "gm/gm.css": [
        "--- Mobile dropdown: capped height, scrollable, pinned to the bottom so the keyboard "
        "cannot push it away ---",
        "Let the dropdown area hand vertical drags to scrolling instead of reading them as taps",
        "--- Navigation on a single line, overflowing horizontally ---",
        "--- The Execute button beside the panel title ---",
        "--- Popup background image (3160x1327, about 2.38:1) ---\n"
        "   The window is more square than the image, so cover has to crop horizontally; the focus\n"
        "   is biased toward the upper middle to keep both characters, cropping only the sides.\n"
        "   ---------------------------------------------------------------------",
        "--- The sidebar top uses the character art, hiding the old title and box ---",
        "The character image sits on a pseudo-element so the mask affects only the image, "
        "not the divider",
        "Elliptical fade to soften the hard crop edge",
        "=====================================================================\n"
        "   Frame dimensions (baseline from 2026-10-26 23:27, fixed px)\n"
        "   This visual has been signed off; do not change these values later.\n"
        "   =====================================================================",
        "Only guarantees no horizontal overflow; changes no dimension",
        "--- Touch highlight fix ---\n"
        "   Android WebView paints a rectangular highlight over tapped elements (it does not follow\n"
        "   border-radius), which shows up as a blue or grey square on pill buttons. Turn it off and\n"
        "   use our own :active feedback instead.\n"
        "   ----------------------------------------------------------------",
        "Keep the centred translateY",
        "--- Amount input and the \"Fill Max\" button align exactly ---",
    ],
}


def rewrite(path, translations):
    text = open(path, encoding='utf-8').read()
    segs = [(a, b, k) for a, b, k in translate_ui.segments(text, path)
            if k == 'comment' and CJK.search(text[a:b])]
    if len(segs) != len(translations):
        print(f'  !! {os.path.basename(path)}: {len(segs)} blocks found vs '
              f'{len(translations)} translations - skipped')
        return 0
    pieces = []
    for (a, b, k), en in zip(segs, translations):
        seg = text[a:b]
        if seg.startswith('<!--'):
            off, inner = 4, seg[4:-3] if seg.endswith('-->') else seg[4:]
        else:
            off, inner = translate_ui.inner_of(seg, k)
        lead = inner[:len(inner) - len(inner.lstrip())]
        trail = inner[len(inner.rstrip()):]
        pieces.append((a + off, a + off + len(inner), lead + en + trail))
    out, pos = [], 0
    for (s, e, rep) in pieces:
        out.append(text[pos:s])
        out.append(rep)
        pos = e
    out.append(text[pos:])
    open(path, 'w', encoding='utf-8').write(''.join(out))
    return len(pieces)


def main():
    total = 0
    for rel, tr in MAP.items():
        p = os.path.join(WEB, rel.replace('/', os.sep))
        n = rewrite(p, tr)
        print(f'{rel:18s} comments translated: {n}')
        total += n
    print('total:', total)


if __name__ == '__main__':
    main()