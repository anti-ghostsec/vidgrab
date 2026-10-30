#!/usr/bin/env bash
# Packages the extension into dist/vidgrab.xpi.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HERE/dist"
rm -f "$HERE/dist/vidgrab.xpi"
(cd "$HERE/extension" && zip -qr -X "$HERE/dist/vidgrab.xpi" . -x '*.DS_Store')
echo "Built $HERE/dist/vidgrab.xpi"
