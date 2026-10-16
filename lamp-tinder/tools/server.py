"""
Local server for Lamp Tinder: serves the project folder and lets tools/embed.html
save its output into data/.   python tools/server.py [port]
"""
import http.server
import os
import shutil
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = {"embeddings.json"}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        name = urllib.parse.parse_qs(u.query).get("name", [""])[0]
        if u.path != "/save" or name not in ALLOWED:
            self.send_error(403)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        with open(os.path.join(ROOT, "data", name), "wb") as f:
            f.write(body)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"saved")
        print(f"saved data/{name} ({len(body)} bytes)", flush=True)
        if name == "embeddings.json":
            # thumbnails were only needed to compute the fingerprints; don't leave them on disk
            shutil.rmtree(os.path.join(ROOT, "catalog_img"), ignore_errors=True)
            print("deleted catalog_img/ thumbnails", flush=True)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Lamp Tinder at http://localhost:{port}/  (close this window to stop)", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
