#!/usr/bin/env python3
"""Builds web.zip (repo root) for Netlify Drop: only the files the site serves.

Usage: python3 web/tools/package.py
"""
import hashlib
import json
import os
import re
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "web")
SHIP = ["index.html", "sw.js", "manifest.webmanifest", "css", "js", "data", "assets"]
SKIP = {"map-london.jpg"}


def shipped():
    files = []
    for item in SHIP:
        path = os.path.join(WEB, item)
        found = [path] if os.path.isfile(path) else [os.path.join(d, f) for d, _, fs in os.walk(path) for f in fs]
        files += [f for f in found if os.path.basename(f) not in SKIP]
    return sorted(files)


def stamp_service_worker():
    """Writes the offline file list and a content hash into sw.js, so each deploy refreshes the cache."""
    sw_path = os.path.join(WEB, "sw.js")
    rel = [os.path.relpath(f, WEB).replace(os.sep, "/") for f in shipped() if not f.endswith("sw.js") and not f.endswith(".json")]
    h = hashlib.sha256()
    for f in sorted(rel):
        with open(os.path.join(WEB, f), "rb") as fh:
            h.update(f.encode() + b"\0" + fh.read())
    with open(sw_path) as fh:
        sw = fh.read()
    sw = re.sub(r'var VERSION = "[^"]*";', 'var VERSION = "fy-' + h.hexdigest()[:12] + '";', sw)
    sw = re.sub(r"/\*FILES\*/.*?/\*END\*/", "/*FILES*/" + json.dumps(["./"] + rel) + "/*END*/", sw, flags=re.S)
    with open(sw_path, "w") as fh:
        fh.write(sw)
    return h.hexdigest()[:12]


def main():
    version = stamp_service_worker()
    out = os.path.join(ROOT, "web.zip")
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for item in SHIP:
            path = os.path.join(WEB, item)
            files = [path] if os.path.isfile(path) else [os.path.join(d, f) for d, _, fs in os.walk(path) for f in sorted(fs)]
            for f in sorted(files):
                if os.path.basename(f) in SKIP:
                    continue
                z.write(f, os.path.relpath(f, WEB))
                n += 1
    print(f"wrote {out}: {n} files, {os.path.getsize(out) // 1024} KB, offline cache version fy-{version}")


if __name__ == "__main__":
    main()
