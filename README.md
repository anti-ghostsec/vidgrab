# VidGrab

A LibreWolf / Firefox add-on that downloads videos from YouTube and the
1000+ other sites [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports
(PeerTube, Odysee, Rumble, BitChute, Vimeo, Dailymotion, Twitch VODs, …).

Old in-browser downloaders keep breaking because YouTube changes its player
code every few weeks. VidGrab hands the actual downloading to yt-dlp, which is
updated within days of every change — when something breaks, click
**Update yt-dlp** in settings instead of waiting for an add-on update.

## How it works

```
extension (popup, right-click menu, stream sniffer)
   │  native messaging
   ▼
host/vidgrab_host.py  ──►  yt-dlp  ──►  ffmpeg  ──►  ~/Downloads
```

## Install

1. Install the helper and yt-dlp:

   ```bash
   ./install.sh --fetch-ytdlp
   ```

   You also need `ffmpeg` (`sudo apt install ffmpeg`) for HD video (YouTube
   serves video and audio separately above 360p) and MP3 conversion.

2. Build the add-on:

   ```bash
   ./build.sh
   ```

3. Install it in LibreWolf. LibreWolf lets you run unsigned add-ons permanently:
   - open `about:config`, set `xpinstall.signatures.required` to `false`
   - open `about:addons` → gear icon → **Install Add-on From File…** → pick `dist/vidgrab.xpi`

   For quick testing without that change, use `about:debugging` →
   **This LibreWolf** → **Load Temporary Add-on…** → pick `extension/manifest.json`
   (removed again when the browser restarts).

## Use

- **Toolbar button** → choose quality → **Download** downloads the video on the current page.
- **Right-click** a page or a link → *Download video on this page* / *Download linked video* / *…as MP3*.
- On sites yt-dlp doesn't know, the toolbar icon shows a green dot when it
  spots a video stream (MP4, WebM, HLS `.m3u8`, DASH `.mpd`); the popup lists
  them under *Detected media streams*. Start the video playing first so the
  page actually requests the stream.

## Settings

Download folder, default quality, file name template, playlists, subtitles,
embedded metadata/thumbnail, SponsorBlock, and extra yt-dlp arguments.
Extra arguments take download, format, subtitle and file-name options only
(`--limit-rate`, `-N`, `-f`, `--sub-langs`, …): ones that run programs or
reach other files (`--exec`, `-o`, `--config-locations`, …) are refused, the
file name template must stay inside the download folder, and the yt-dlp
path must name a `yt-dlp` program. `python3 tests/test_host.py` checks this.

**Age-restricted, members-only, or "Sign in to confirm you're not a bot"
errors** are handled automatically: when a site asks for a login, VidGrab
retries using your LibreWolf cookies. The helper finds the profile of the
running browser by itself (shown on the settings page). Change this under
*Use my LibreWolf login*, or set *Cookie source override* if it picks the
wrong profile.

## Troubleshooting

- **"Native helper not found"** — run `./install.sh` again and restart LibreWolf.
  Check `~/.librewolf/native-messaging-hosts/vidgrab.json` exists.
- **A site stopped working** — Settings → *Update yt-dlp*.
- **Flatpak LibreWolf** — the sandbox blocks native helpers. Use the distro
  package/AppImage, or put the manifest in
  `~/.var/app/io.gitlab.librewolf-community/.librewolf/native-messaging-hosts/`
  and grant `flatpak override --user --talk-name=org.freedesktop.Flatpak io.gitlab.librewolf-community`
  (then the host must call out via `flatpak-spawn --host`; not supported out of the box).
- **Uninstall the helper** — `./install.sh --uninstall`.

Only download content you have the right to download.
