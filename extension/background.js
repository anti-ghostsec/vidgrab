// shared.js is loaded first by the manifest.
/* global getOptions */

const HOST_NAME = "vidgrab";

let port = null;
let hostStatus = null; // last "status" reply, or {error} if the host can't start
const jobs = new Map(); // id -> job object
const sniffed = new Map(); // tabId -> Map(url -> media item)

// ---------- native host ----------

function connectHost() {
  if (port) return port;
  port = browser.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener((p) => {
    const err = (p && p.error && p.error.message) || browser.runtime.lastError?.message;
    port = null;
    hostStatus = { error: err || "Native host disconnected" };
    for (const job of jobs.values()) {
      if (job.state === "running" || job.state === "queued") {
        job.state = "error";
        job.error = "Lost connection to native host";
      }
    }
    broadcast();
  });
  return port;
}

async function postToHost(msg) {
  try {
    connectHost().postMessage(msg);
    return true;
  } catch (e) {
    hostStatus = { error: String(e.message || e) };
    broadcast();
    return false;
  }
}

async function refreshStatus() {
  const opts = await getOptions();
  postToHost({ action: "status", ytdlpPath: opts.ytdlpPath });
}

function onHostMessage(msg) {
  if (msg.type === "status") {
    hostStatus = msg;
  } else if (msg.type === "update") {
    hostStatus = Object.assign({}, hostStatus, { updateOutput: msg.output, updateOk: msg.ok });
    refreshStatus();
  } else if (msg.type === "job") {
    const job = jobs.get(msg.id);
    if (!job) return;
    const prevState = job.state;
    for (const k of ["state", "percent", "speed", "eta", "title", "stage", "error", "files", "dir", "warning"]) {
      if (k === "title" && job.fixedTitle) continue;
      if (msg[k] !== undefined) job[k] = msg[k];
    }
    if (msg.percent !== undefined) job.stage = "";
    if (prevState !== job.state && (job.state === "done" || job.state === "error")) {
      notifyJob(job);
    }
  } else if (msg.type === "error") {
    const job = msg.id && jobs.get(msg.id);
    if (job) {
      job.state = "error";
      job.error = msg.error;
    } else {
      console.error("VidGrab host error:", msg.error);
    }
  }
  updateBadge();
  broadcast();
}

// ---------- jobs ----------

let nextId = 1;

// "Some Video - SiteName" -> "Some Video": drop a trailing segment that
// looks like the site's name, so it doesn't end up in every file name.
function cleanPageTitle(title, pageUrl) {
  title = (title || "").trim();
  let host = "";
  try { host = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase(); } catch {}
  const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const site = squash(host.split(".").slice(0, -1).join("") || host);
  for (const sep of [" - ", " | ", " — ", " – ", " :: ", " · "]) {
    const i = title.lastIndexOf(sep);
    if (i <= 0) continue;
    const tail = squash(title.slice(i + sep.length));
    if (tail && site && (site.includes(tail) || tail.includes(site))) return title.slice(0, i).trim();
  }
  return title;
}

async function startDownload({ url, preset, referer, title, nameFromPage }) {
  const opts = await getOptions();
  const id = `${Date.now()}-${nextId++}`;
  // A raw stream URL has no title of its own (yt-dlp would name the file
  // after the stream, e.g. "master"), so use the page's title instead.
  const pageTitle = nameFromPage ? cleanPageTitle(title, referer || url) : undefined;
  const job = {
    id, url, preset: preset || opts.defaultPreset, title: pageTitle || title || url, fixedTitle: !!pageTitle,
    state: "queued", percent: 0, speed: "", eta: "", stage: "Starting…",
    created: Date.now(),
  };
  jobs.set(id, job);
  broadcast();
  const ok = await postToHost({ action: "download", id, url, preset: job.preset, referer, pageTitle, userAgent: navigator.userAgent, options: opts,
  });
  if (!ok) {
    job.state = "error";
    job.error = hostStatus?.error || "Native host unavailable";
  }
  updateBadge();
  broadcast();
  return id;
}

async function notifyJob(job) {
  const opts = await getOptions();
  if (!opts.notify) return;
  browser.notifications.create(`vidgrab-${job.id}`, {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon.svg"),
    title: job.state === "done" ? "Download finished" : "Download failed",
    message: job.state === "done" ? job.title : `${job.title}\n${job.error || ""}`,
  });
}

browser.notifications.onClicked.addListener((nid) => {
  const job = jobs.get(nid.replace(/^vidgrab-/, ""));
  if (job && job.state === "done") {
    postToHost({ action: "open", path: job.files?.[0] || job.dir, reveal: true });
  }
});

function updateBadge() {
  const active = [...jobs.values()].filter((j) => j.state === "running" || j.state === "queued").length;
  browser.browserAction.setBadgeText({ text: active ? String(active) : "" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#3b82f6" });
}

// ---------- media sniffing (for sites yt-dlp doesn't know) ----------

const MEDIA_TYPES = /^(video\/|audio\/|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i;
const MANIFEST_EXT = /\.(m3u8|mpd)(\?|$)/i;
const FILE_EXT = /\.(mp4|webm|mkv|mov|m4v|mp3|m4a|ogg|opus|flac)(\?|$)/i;
const SEGMENT_EXT = /\.(ts|m4s|aac|vtt)(\?|$)|\/(seg|segment|chunk|frag)[-_]?\d+/i;
// Sites where yt-dlp handles the page URL itself; their raw streams are noise.
const IGNORE_HOSTS = /(googlevideo\.com|youtube\.com|ytimg\.com|ggpht\.com)$/i;

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    let host;
    try { host = new URL(details.url).hostname; } catch { return; }
    if (IGNORE_HOSTS.test(host)) return;
    if (SEGMENT_EXT.test(details.url)) return;

    const headers = Object.fromEntries(
      (details.responseHeaders || []).map((h) => [h.name.toLowerCase(), h.value || ""])
    );
    const ctype = (headers["content-type"] || "").split(";")[0].trim();
    const isManifest = MANIFEST_EXT.test(details.url) || /mpegurl|dash\+xml/i.test(ctype);
    const isFile = FILE_EXT.test(details.url) || (MEDIA_TYPES.test(ctype) && !/mp2t|iso.segment/i.test(ctype));
    if (!isManifest && !isFile) return;

    const size = parseInt(headers["content-length"] || "0", 10);
    // Tiny files are usually ad pings, previews or audio cues.
    if (!isManifest && size && size < 300 * 1024) return;

    let tabMedia = sniffed.get(details.tabId);
    if (!tabMedia) sniffed.set(details.tabId, (tabMedia = new Map()));
    const key = details.url.split("#")[0];
    if (tabMedia.has(key)) return;
    tabMedia.set(key, {
      url: key,
      kind: isManifest ? (/mpd|dash/i.test(details.url + ctype) ? "DASH" : "HLS") : (ctype || "file"),
      size,
      referer: details.originUrl || details.documentUrl || "",
      time: Date.now(),
    });
    updateTabBadge(details.tabId);
    broadcast();
  },
  { urls: ["<all_urls>"], types: ["media", "xmlhttprequest", "other", "object"] },
  ["responseHeaders"]
);

function updateTabBadge(tabId) {
  const active = [...jobs.values()].some((j) => j.state === "running" || j.state === "queued");
  if (active) return;
  const n = sniffed.get(tabId)?.size || 0;
  browser.browserAction.setBadgeText({ tabId, text: n ? "●" : "" });
  browser.browserAction.setBadgeBackgroundColor({ tabId, color: "#22c55e" });
}

browser.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) {
    sniffed.delete(tabId);
    updateTabBadge(tabId);
  }
});
browser.tabs.onRemoved.addListener((tabId) => sniffed.delete(tabId));

// ---------- context menus ----------

browser.contextMenus.create({
  id: "vidgrab-page",
  title: "Download video on this page",
  contexts: ["page", "video", "audio"],
});
browser.contextMenus.create({
  id: "vidgrab-link",
  title: "Download linked video",
  contexts: ["link"],
});
browser.contextMenus.create({
  id: "vidgrab-link-audio",
  title: "Download linked video as MP3",
  contexts: ["link"],
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "vidgrab-page") {
    // For a <video> with a real (non-blob) src, prefer the page URL anyway:
    // yt-dlp extracts better quality from the page than from the element.
    startDownload({ url: tab.url, title: tab.title });
  } else if (info.menuItemId === "vidgrab-link") {
    startDownload({ url: info.linkUrl, referer: tab?.url });
  } else if (info.menuItemId === "vidgrab-link-audio") {
    startDownload({ url: info.linkUrl, referer: tab?.url, preset: "audio_mp3" });
  }
});

// ---------- popup / options messaging ----------

function snapshot(tabId) {
  return {
    hostStatus,
    jobs: [...jobs.values()].sort((a, b) => b.created - a.created),
    media: tabId != null ? [...(sniffed.get(tabId)?.values() || [])] : [],
  };
}

function broadcast() {
  browser.runtime.sendMessage({ type: "state-changed" }).catch(() => {});
}

browser.runtime.onMessage.addListener(async (msg) => {
  switch (msg.type) {
    case "get-state":
      if (!hostStatus) await refreshStatus();
      return snapshot(msg.tabId);
    case "download":
      return startDownload(msg);
    case "cancel":
      postToHost({ action: "cancel", id: msg.id });
      return true;
    case "remove-job":
      jobs.delete(msg.id);
      broadcast();
      return true;
    case "clear-finished":
      for (const [id, j] of jobs) if (!["running", "queued"].includes(j.state)) jobs.delete(id);
      broadcast();
      return true;
    case "open":
      postToHost({ action: "open", path: msg.path, reveal: msg.reveal });
      return true;
    case "browser-download":
      return browser.downloads.download({ url: msg.url, saveAs: true });
    case "refresh-status":
      hostStatus = null;
      if (port) { port.disconnect(); port = null; }
      await refreshStatus();
      return true;
    case "update-ytdlp": {
      const opts = await getOptions();
      hostStatus = Object.assign({}, hostStatus, { updateOutput: "Updating…" });
      broadcast();
      postToHost({ action: "update", ytdlpPath: opts.ytdlpPath });
      return true;
    }
  }
});

refreshStatus();
