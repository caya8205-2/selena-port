"""Mock AscNet SDK server for panel development.

Implements the three endpoints the panel uses, with the same response shapes as
AscNet.SDKServer, so the UI can be exercised without MongoDB or the game:

    POST /api/AscNet/login      -> { code, msg, account: { Id, Uid, Username, Token } }
    GET  /api/AscNet/commands   -> { code, msg, data: [ { name, help } ] }
    POST /api/AscNet/command/{name} -> { msg }

Not part of the panel: dev-only, listens on 127.0.0.1:8085 by default.
"""
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COMMANDS = [
    ("item", "Command to interact with user's items (add/clear/reset)"),
    ("character", "Command to modify characters (add)"),
    ("equip", "Command to modify equipment (add/prune/sync)"),
    ("coating", "Unlock character coatings"),
    ("scene", "Unlock scene backgrounds"),
    ("level", "Change the Commandant level"),
    ("stage", "Clear stages"),
    ("bc", "Grant Black Cards"),
    ("save", "Save the current account"),
]

TOKEN = "mock-token-0001"


class Handler(BaseHTTPRequestHandler):
    # HTTP/1.0 keeps the connection single-shot; the panel reuses pooled
    # connections and a half-closed keep-alive socket makes it look like the
    # server is down.
    protocol_version = "HTTP/1.0"

    def _send(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[mock-sdk] " + fmt % args + "\n")

    def do_GET(self):
        if self.path.startswith("/api/AscNet/commands"):
            return self._send({"code": 0, "msg": "OK", "data": [{"name": n, "help": h} for n, h in COMMANDS]})
        return self._send({"code": -1, "msg": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            body = {}

        if self.path in ("/api/AscNet/login", "/api/AscNet/register"):
            user = (body.get("username") or "").strip()
            if not user:
                return self._send({"code": -1, "msg": "Invalid request"})
            return self._send({
                "code": 0,
                "msg": "OK",
                "account": {"Id": 1, "Uid": 1000001, "Username": user, "Token": TOKEN},
            })

        m = re.match(r"^/api/AscNet/command/([A-Za-z0-9_]+)$", self.path)
        if m:
            if self.headers.get("Authorization") != TOKEN:
                return self._send({"msg": "Invalid token!"}, 401)
            name = m.group(1)
            # Offline fixture: lets the panel's status probe be exercised without
            # a real game session.
            if os.environ.get("MOCK_OFFLINE") == "1":
                return self._send({"msg": "Player is offline!"}, 400)
            args = body.get("args") or []
            if name not in [c for c, _ in COMMANDS]:
                return self._send({"msg": "Command does not exists!"}, 404)
            return self._send({"msg": "OK (mock): %s %s" % (name, " ".join(str(a) for a in args))})

        return self._send({"code": -1, "msg": "not found"}, 404)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8085
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()