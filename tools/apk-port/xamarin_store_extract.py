"""Extract .NET assemblies from a Xamarin/Mono `libassembly-store.so`.

Store layout: `XABA` header -> entry descriptors -> per-entry payload, where
each payload may be an `XALZ` LZ4-block-compressed blob. ELF wrappers put the
store inside a section, so the header is located by scanning for the magic.
"""
import struct
import sys

import lz4.block


def find_store(data):
    for magic in (b'XABA', b'xaba'):
        off = data.find(magic)
        if off >= 0:
            return off
    raise SystemExit('no XABA magic found')


def parse(data):
    base = find_store(data)
    magic, version, entry_count, store_id_count, assembly_count, \
        index_entry_count, index_size = struct.unpack_from('<7I', data, base)
    print(f'store at 0x{base:x}: version={version} entries={entry_count} '
          f'stores={store_id_count} assemblies={assembly_count}')
    cur = base + 28
    entries = []
    for _ in range(entry_count):
        fields = struct.unpack_from('<7I', data, cur)
        cur += 28
        entries.append(fields)
    print(f'read {len(entries)} descriptors')
    out = []
    for i, (mi, off, size, dbg_off, dbg_sz, cfg_off, cfg_sz) in enumerate(entries):
        blob = data[off:off + size]
        if blob[:4] == b'XALZ':
            _m, index, unc_len = struct.unpack_from('<4sII', blob, 0)
            payload = blob[12:]
            if index == 0:
                raw = payload[:unc_len]
            else:
                raw = lz4.block.decompress(payload, uncompressed_size=unc_len)
        else:
            raw = blob
        out.append(raw)
    return out


def name_of(raw):
    """Best-effort assembly name from the PE metadata for readable filenames."""
    try:
        import re
        m = re.search(rb'[A-Za-z0-9_.\-]{3,60}\.dll', raw[:200000])
        return m.group(0).decode('ascii') if m else None
    except Exception:
        return None


if __name__ == '__main__':
    src, outdir = sys.argv[1], sys.argv[2]
    data = open(src, 'rb').read()
    assemblies = parse(data)
    import os
    os.makedirs(outdir, exist_ok=True)
    seen = 0
    for i, raw in enumerate(assemblies):
        nm = name_of(raw)
        fn = nm if nm else f'asm_{i:04d}.dll'
        path = os.path.join(outdir, fn)
        k = 1
        while os.path.exists(path):
            path = os.path.join(outdir, f'{fn[:-4]}_{k}.dll')
            k += 1
        open(path, 'wb').write(raw)
        seen += 1
    print(f'wrote {seen} assemblies to {outdir}')
    print(f'total bytes: {sum(len(a) for a in assemblies)/1048576:.1f} MB')