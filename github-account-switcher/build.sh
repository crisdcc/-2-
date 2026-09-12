#!/usr/bin/env bash
# Builds github-account-switcher.xpi from the source files in this folder.
# Usage: ./build.sh   (run from this directory)
set -euo pipefail
cd "$(dirname "$0")"

OUT="github-account-switcher.xpi"

python3 -c 'import json; json.load(open("manifest.json")); print("manifest.json: OK")'

for f in background.js popup/popup.js lib/hub-lib.mjs; do
  node --check "$f"
done
echo "syntax: OK"

rm -f "$OUT"
python3 -c '
import os
import zipfile

skip = {"build.sh", "README.md", ".DS_Store"}
out = "github-account-switcher.xpi"
files = []
for dirpath, dirnames, filenames in os.walk("."):
    dirnames[:] = [d for d in dirnames if not d.startswith(".")]
    for name in filenames:
        if name in skip:
            continue
        files.append(os.path.join(dirpath, name))

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for path in sorted(files):
        z.write(path, os.path.relpath(path, "."))

print(f"{out}: OK ({len(files)} files)")
'
