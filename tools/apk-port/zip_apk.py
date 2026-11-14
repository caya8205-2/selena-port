"""Zip a staged APK tree the way Android expects.

- skips META-INF (old signatures must not survive)
- stores already-compressed media and resources.arsc uncompressed
  (resources.arsc must stay stored + 4-byte aligned on modern targets)
"""
import os
import sys
import zipfile

STORE_EXT = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.ogg', '.arsc')


def build(src, out):
    files = []
    for root, _dirs, names in os.walk(src):
        for n in names:
            fp = os.path.join(root, n)
            rel = os.path.relpath(fp, src).replace('\\', '/')
            if rel.startswith('META-INF/'):
                continue
            files.append((fp, rel))
    files.sort(key=lambda x: x[1])
    with zipfile.ZipFile(out, 'w', allowZip64=True) as z:
        for fp, rel in files:
            comp = zipfile.ZIP_STORED if rel.lower().endswith(STORE_EXT) else zipfile.ZIP_DEFLATED
            zi = zipfile.ZipInfo(rel, date_time=(2026, 11, 15, 0, 0, 0))
            zi.compress_type = comp
            zi.external_attr = 0o644 << 16
            with open(fp, 'rb') as fh, z.open(zi, 'w') as dz:
                dz.write(fh.read())
    n = len(files)
    print(f'   wrote {out} ({n} entries, {os.path.getsize(out)/1048576:.1f} MB)')


if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])