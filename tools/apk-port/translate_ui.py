"""Reusable CJK->EN segment translator for the PGR local-server web UI.

Scans HTML/JS/CSS with a small state machine, rewrites only the CJK-bearing
segments (text nodes, attribute values, JS string literals, comments),
preserving surrounding whitespace. Unknown segments are reported, never
guessed.
"""
import json
import os
import re
import sys

CJK = re.compile(r'[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]')


def js_segments(text):
    """Yield (start, end, kind) for string literals and comments in JS/CSS."""
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ''
        if ch == '/' and nxt == '/':
            j = text.find('\n', i)
            j = n if j < 0 else j
            yield (i, j, 'comment')
            i = j
            continue
        if ch == '/' and nxt == '*':
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            yield (i, j, 'comment')
            i = j
            continue
        if ch in '"\'':
            q, j = ch, i + 1
            while j < n:
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                if text[j] == '\n':
                    break
                j += 1
            yield (i, j, 'string')
            i = j
            continue
        if ch == '`':
            j = i + 1
            while j < n:
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == '`':
                    j += 1
                    break
                j += 1
            yield (i, j, 'template')
            i = j
            continue
        i += 1


def html_segments(text):
    """Yield (start, end, kind) for text nodes, attr values, script/style bodies."""
    i, n = 0, len(text)
    while i < n:
        if text[i] == '<':
            if text.startswith('<!--', i):
                j = text.find('-->', i)
                j = n if j < 0 else j + 3
                yield (i, j, 'comment')
                i = j
                continue
            j = text.find('>', i)
            if j < 0:
                break
            tag = text[i:j]
            # attribute values inside the tag
            for m in re.finditer(r'=\s*("([^"]*)"|\'([^\']*)\')', tag):
                val = m.group(2) if m.group(2) is not None else m.group(3)
                if CJK.search(val):
                    yield (i + m.start(1) + 1, i + m.start(1) + 1 + len(val), 'attr')
            # inline script/style bodies
            m = re.match(r'<(script|style)\b', tag, re.I)
            if m:
                close = '</%s' % m.group(1).lower()
                k = text.lower().find(close, j)
                k = n if k < 0 else k
                kind = 'jsbody' if m.group(1).lower() == 'script' else 'cssbody'
                yield (j + 1, k, kind)
                i = k
                continue
            i = j + 1
            continue
        j = text.find('<', i)
        j = n if j < 0 else j
        if CJK.search(text[i:j]):
            yield (i, j, 'text')
        i = j


def segments(text, path):
    if path.endswith(('.js', '.css')):
        return list(js_segments(text))
    out = []
    for (a, b, kind) in html_segments(text):
        if kind in ('jsbody', 'cssbody'):
            for (x, y, k2) in js_segments(text[a:b]):
                out.append((a + x, a + y, k2))
        else:
            out.append((a, b, kind))
    return out


def inner_of(seg, kind):
    """Return (offset, inner) of the translatable payload, delimiter excl."""
    if kind in ('string', 'template'):
        if len(seg) >= 2 and seg[0] in '"\'' and seg[-1] == seg[0]:
            return 1, seg[1:-1]
        if len(seg) >= 2 and seg[0] == '`' and seg[-1] == '`':
            return 1, seg[1:-1]
    if kind == 'comment':
        if seg.startswith('//'):
            return 2, seg[2:]
        if seg.startswith('/*'):
            end = -2 if seg.endswith('*/') else None
            return 2, seg[2:end]
    return 0, seg


def apply_file(path, mapping, dry=False, include_comments=False):
    text = open(path, encoding='utf-8').read()
    segs = segments(text, path)
    pieces, unknown, changed = [], [], 0
    for (a, b, kind) in segs:
        seg = text[a:b]
        if not CJK.search(seg):
            continue
        if kind == 'comment' and not include_comments:
            continue
        off, inner = inner_of(seg, kind)
        core = inner.strip()
        en = mapping.get(core)
        if en is None:
            unknown.append((kind, core))
            continue
        if kind == 'string' and off:
            q = seg[0]
            en = en.replace(q, '\\' + q)
        elif kind == 'template' and off:
            en = en.replace('`', '\\`')
        lead = inner[:len(inner) - len(inner.lstrip())]
        trail = inner[len(inner.rstrip()):]
        pieces.append((a + off, a + off + len(inner), lead + en + trail))
        changed += 1
    if dry or not pieces:
        return text, unknown, changed
    out, pos = [], 0
    for (a, b, rep) in pieces:
        out.append(text[pos:a])
        out.append(rep)
        pos = b
    out.append(text[pos:])
    return ''.join(out), unknown, changed


def run(webroot, mapfile, write=True, report=True):
    mapping = json.load(open(mapfile, encoding='utf-8'))
    files = ['gm/index.html', 'gm/gm.js', 'player/index.html', 'player/panel.js',
             'gm/gm.css', 'player/panel.css']
    all_unknown = {}
    for rel in files:
        p = os.path.join(webroot, rel.replace('/', os.sep))
        if not os.path.exists(p):
            continue
        new, unknown, changed = apply_file(p, mapping, dry=not write)
        if write and changed:
            open(p, 'w', encoding='utf-8').write(new)
        if unknown:
            all_unknown[rel] = unknown
        if report:
            print(f"{rel:22s} translated={changed:3d} unknown={len(unknown):3d}")
    return all_unknown


if __name__ == '__main__':
    web = sys.argv[1]
    mapfile = sys.argv[2]
    unk = run(web, mapfile, write='--dry' not in sys.argv)
    for rel, items in unk.items():
        print('\n== UNKNOWN', rel, len(items))
        for kind, s in items:
            print(f"   [{kind}] {s[:160]}")