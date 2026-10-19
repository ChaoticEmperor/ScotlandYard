#!/usr/bin/env python3
"""Builds web.zip (repo root) for Netlify Drop: only the files the site serves.

Usage: python3 web/tools/package.py
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "web")
SHIP = ["index.html", "css", "js", "data", "assets"]
SKIP = {"map-london.jpg"}


def main():
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
    print(f"wrote {out}: {n} files, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
