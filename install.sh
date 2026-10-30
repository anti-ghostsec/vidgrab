#!/usr/bin/env bash
# Installs the VidGrab native helper for LibreWolf / Firefox on Linux.
#
#   ./install.sh               install helper + register it with the browser
#   ./install.sh --fetch-ytdlp also download the official yt-dlp binary
#   ./install.sh --uninstall   remove the helper and its registration
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$HOME/.local/share/vidgrab"
HOST_NAME="vidgrab"
EXT_ID="vidgrab@local"
MANIFEST_DIRS=(
  "$HOME/.librewolf/native-messaging-hosts"
  "$HOME/.mozilla/native-messaging-hosts"
)

if [[ "${1:-}" == "--uninstall" ]]; then
  for d in "${MANIFEST_DIRS[@]}"; do rm -f "$d/$HOST_NAME.json"; done
  rm -f "$DATA_DIR/vidgrab_host.py"
  echo "Removed VidGrab helper. (yt-dlp in $DATA_DIR was left in place.)"
  exit 0
fi

command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }

mkdir -p "$DATA_DIR"
install -m 755 "$HERE/host/vidgrab_host.py" "$DATA_DIR/vidgrab_host.py"

for d in "${MANIFEST_DIRS[@]}"; do
  mkdir -p "$d"
  cat > "$d/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "VidGrab yt-dlp bridge",
  "path": "$DATA_DIR/vidgrab_host.py",
  "type": "stdio",
  "allowed_extensions": ["$EXT_ID"]
}
EOF
  echo "Registered helper in $d"
done

if [[ "${1:-}" == "--fetch-ytdlp" ]]; then
  echo "Downloading yt-dlp from github.com/yt-dlp/yt-dlp…"
  curl -fL --progress-bar -o "$DATA_DIR/yt-dlp.tmp" \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
  chmod +x "$DATA_DIR/yt-dlp.tmp"
  mv "$DATA_DIR/yt-dlp.tmp" "$DATA_DIR/yt-dlp"
  echo "Installed yt-dlp $("$DATA_DIR/yt-dlp" --version) to $DATA_DIR/yt-dlp"
fi

echo
if [[ -x "$DATA_DIR/yt-dlp" ]] || command -v yt-dlp >/dev/null; then
  echo "✓ yt-dlp found"
else
  echo "✗ yt-dlp not found. Re-run with --fetch-ytdlp, or: pipx install yt-dlp"
fi
if command -v ffmpeg >/dev/null; then
  echo "✓ ffmpeg found"
else
  echo "✗ ffmpeg not found (needed for HD video and MP3). Install it: sudo apt install ffmpeg"
fi
if command -v flatpak >/dev/null && flatpak list 2>/dev/null | grep -qi librewolf; then
  echo "! Flatpak LibreWolf detected: its sandbox blocks native helpers by default."
  echo "  Use the distro/AppImage LibreWolf, or see README.md for the flatpak workaround."
fi
echo
echo "Next: build the add-on with ./build.sh and install dist/vidgrab.xpi in LibreWolf."
