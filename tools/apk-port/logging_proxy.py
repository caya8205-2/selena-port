"""Minimal logging HTTP CONNECT proxy (stdlib only, no admin needed).

Purpose: discover which hosts the PGR client contacts by having it use this
proxy via the HTTP_PROXY/HTTPS_PROXY env vars (libcurl honours them).

It does not decrypt anything. For CONNECT it logs the target host:port and the
SNI from the TLS ClientHello (if any), then relays bytes both ways so the
client keeps working normally. Plain HTTP requests are logged by absolute-URI
and relayed too.

Log: hosts.log next to this file, one line per new target.
"""
import socket
import sys
import threading
import time

LISTEN = ('127.0.0.1', 8899)
LOG = r'C:\Users\Caya\Desktop\Project\pgr-local\artifacts\hosts.log'
seen = set()
lock = threading.Lock()


def log(line):
    with lock:
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(f'{time.strftime("%H:%M:%S")} {line}\n')


def sni_from(data):
    """Best-effort SNI extraction from a TLS ClientHello byte string."""
    try:
        if len(data) < 45 or data[0] != 0x16:
            return None
        p = 43
        p += 1 + data[p]
        p += 2 + int.from_bytes(data[p:p + 2], 'big')
        p += 1 + data[p]
        ext_end = p + 2 + int.from_bytes(data[p:p + 2], 'big')
        p += 2
        while p + 4 <= ext_end:
            etype = int.from_bytes(data[p:p + 2], 'big')
            elen = int.from_bytes(data[p + 2:p + 4], 'big')
            if etype == 0:
                q = p + 4 + 2 + 1 + 2
                nlen = int.from_bytes(data[p + 4 + 3:p + 4 + 5], 'big')
                return data[q:q + nlen].decode('ascii', 'ignore')
            p += 4 + elen
    except Exception:
        return None
    return None


def pump(a, b, first=None):
    try:
        if first:
            b.sendall(first)
        while True:
            d = a.recv(65536)
            if not d:
                break
            b.sendall(d)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def handle(client, addr):
    try:
        client.settimeout(30)
        buf = b''
        while b'\r\n\r\n' not in buf and len(buf) < 65536:
            d = client.recv(4096)
            if not d:
                return
            buf += d
        head = buf.split(b'\r\n\r\n', 1)
        line = head[0].split(b'\r\n')[0].decode('latin-1')
        parts = line.split()
        if len(parts) < 2:
            return
        method, target = parts[0], parts[1]

        if method.upper() == 'CONNECT':
            host, _, port = target.rpartition(':')
            port = int(port or 443)
            key = f'{host}:{port}'
            with lock:
                new = key not in seen
                seen.add(key)
            if new:
                log(f'CONNECT {key}')
            upstream = socket.create_connection((host, port), timeout=15)
            client.sendall(b'HTTP/1.1 200 Connection established\r\n\r\n')
            # peek the first upstream-bound bytes to log the SNI
            rest = head[1] if len(head) > 1 else b''
            try:
                client.settimeout(5)
                peek = rest + client.recv(4096)
            except OSError:
                peek = rest
            sni = sni_from(peek)
            if sni and sni != host:
                log(f'SNI {sni} (for {key})')
            elif sni:
                log(f'SNI {sni}')
            t = threading.Thread(target=pump, args=(client, upstream, peek), daemon=True)
            t.start()
            pump(upstream, client)
            t.join(timeout=1)
        else:
            url = target
            host = url.split('//')[-1].split('/')[0] if '//' in url else url.split('/')[0]
            with lock:
                new = host not in seen
                seen.add(host)
            if new:
                log(f'{method} {host}')
            upstream = socket.create_connection((host, 80), timeout=15)
            upstream.sendall(buf)
            t = threading.Thread(target=pump, args=(client, upstream), daemon=True)
            t.start()
            pump(upstream, client)
            t.join(timeout=1)
    except Exception as e:
        log(f'ERR {type(e).__name__} {e}')
    finally:
        try:
            client.close()
        except OSError:
            pass


def main():
    open(LOG, 'w', encoding='utf-8').write('')
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(LISTEN)
    srv.listen(64)
    print(f'listening on {LISTEN[0]}:{LISTEN[1]} -> {LOG}', flush=True)
    while True:
        c, a = srv.accept()
        threading.Thread(target=handle, args=(c, a), daemon=True).start()


if __name__ == '__main__':
    sys.exit(main())