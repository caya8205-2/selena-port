"""Post-translation layout adjustments for the English GM/player UI.

The author froze the frame dimensions (sidebar 168px etc.) for the Chinese
labels, so English is fixed by shortening over-long strings instead of
resizing the locked layout, plus wrap-safety on nav items.
"""
import os
import re

WEB = r"C:\Users\Caya\AppData\Local\hermes\cache\scratch\pgr-local\assets\server-resources\Web"

# nav labels must stay one line inside the 168px sidebar
NAV_SHORTEN = [
    ('<a class="nav__item" href="#/scene" data-page="scene"><span class="nav__icon">\u2756</span><span>Scene Backgrounds</span></a>',
     '<a class="nav__item" href="#/scene" data-page="scene"><span class="nav__icon">\u2756</span><span>Scenes</span></a>'),
    ('<span>Commandant Level</span>', '<span>Commandant</span>'),
]

JS_SHORTEN = [
    ('"Select an online player\u2026"', '"Select player\u2026"'),
    ('placeholder: "Select an online player\u2026"', 'placeholder: "Select player\u2026"'),
]

BANNER_ZH = '\u672c\u8f6f\u4ef6\u5b8c\u5168\u514d\u8d39'
BANNER_LONG = "This software is completely free. If anyone charged you money, you were scammed - ask for a refund."
BANNER_SHORT = "Free software. If you paid for this, you were scammed - ask for a refund."

NAV_SAFETY = """
/* EN labels: keep nav items on one line inside the locked 168px sidebar */
.nav__item { white-space: nowrap; }
.nav__item > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
"""


def patch(path, pairs):
    t = open(path, encoding="utf-8").read()
    hits = 0
    for old, new in pairs:
        if old in t:
            t = t.replace(old, new)
            hits += 1
    open(path, "w", encoding="utf-8").write(t)
    return hits


def run():
    html = os.path.join(WEB, "gm", "index.html")
    js = os.path.join(WEB, "gm", "gm.js")
    css = os.path.join(WEB, "gm", "gm.css")
    player = os.path.join(WEB, "player", "index.html")

    print("nav labels:", patch(html, NAV_SHORTEN))
    print("js placeholders:", patch(js, JS_SHORTEN))
    print("banner:", patch(html, [(BANNER_LONG, BANNER_SHORT)]),
          patch(player, [(BANNER_LONG, BANNER_SHORT)]))
    t = open(css, encoding="utf-8").read()
    if ".nav__item > span:last-child" not in t:
        open(css, "w", encoding="utf-8").write(t + NAV_SAFETY)
        print("css safety appended")


if __name__ == "__main__":
    run()