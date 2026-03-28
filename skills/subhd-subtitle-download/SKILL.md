---
name: subhd-subtitle-download
description:
  Download Chinese subtitles from SubHD (subhd.tv) for TV series or movies.
  Searches SubHD, evaluates subtitle quality, and downloads via CDN extraction
  or download API. Use when user wants Chinese subtitles, asks to "download
  subtitles", "find Chinese subs", or has media files needing subtitle files.
  Triggers on requests involving Chinese subtitles, SubHD, or subtitle
  downloading for video files.
---

# SubHD Subtitle Download

## Overview

SubHD is a Chinese subtitle site. Workflow:

1. **Search** — find subtitles on SubHD (parallelizable with WebFetch + workers)
2. **Evaluate** — pick best entries by quality
3. **Download** — two methods depending on entry type:
   - **Single-file entries** (per-episode ASS/SRT): extract CDN filename from HTML → direct download, no captcha
   - **Archive entries** (season pack ZIP/RAR): call download API → solve captcha → get CDN URL → download
4. **Deploy** — extract archives, match to video files, rename per naming convention

## 1. Identify Target Files

Scan the user's directory for video files (`*.mkv *.mp4 *.avi`). Parse series name, season, and episode numbers from filenames. Check for existing subtitle files (`.srt`, `.ass`, `.ssa`) to determine which episodes still need subtitles.

## 2. Search SubHD

### Search URL

```
https://subhd.tv/search/{url_encoded_query}
```

### Parallel Search

Search queries don't need the browser. Launch multiple worker subagents with WebFetch (`format: "text"`) to search for different series in parallel:

```
Worker prompt:
Search SubHD for these series using WebFetch (format "text"):
1. https://subhd.tv/search/Counterpart
2. https://subhd.tv/search/Pantheon
Make ALL web fetch calls in parallel.
Extract subtitle links (/a/{id}), uploader, download count, language info.
```

### Search Strategy

- First try: `{English Name} S{season:02d}` (e.g., "Tracker S03")
- If few results: try the Chinese name, or broaden to just the series name
- For Japanese dramas: try both Japanese title and Chinese translation
- Look for season packs as well as per-episode entries

## 3. Evaluate Subtitle Quality

| Priority | Type | Indicators |
|----------|------|------------|
| 1 (Best) | Official subtitles | "官方字幕", "官方" |
| 2 | Professional team | "人人影视", "YYeTs", "伊甸园", etc. |
| 3 | Polished fan translation | "精修", "特效打磨", high download count |
| 4 | AI translated | "AI翻润色", "AI翻译" |
| 5 (Worst) | Machine translated | "机器翻译", "Google翻译" |

Additional signals: bilingual ("双语") preferred, ASS > SRT, matching release group improves sync odds, season packs are convenient.

## 4. Download Method A: CDN Filename Extraction (Single-File Entries)

**Applies to**: Subtitle entries that are a single file (one ASS or SRT). These entries have a `data-filename` attribute in their detail page HTML.

**Does NOT apply to**: Archive/season pack entries (ZIP/RAR). These have no `data-filename` — use Method B (Section 5) instead.

### 4a. Extract Filename

On the detail page `/a/{id}`, look for elements with `data-filename`:

```javascript
async () => {
  const els = document.querySelectorAll('[data-filename]');
  return Array.from(els).map(el => ({
    filename: el.getAttribute('data-filename'),
    text: el.textContent.trim()
  }));
}
```

The filename is a 13-digit millisecond timestamp + extension, e.g. `1772788454048.ass`.

### 4b. Batch Extraction

To extract filenames for multiple entries without navigating to each page, fetch the HTML in bulk via `evaluate_script`:

```javascript
async () => {
  const sids = ['L5cYwp', 'KsYBG5', 'hfmluB'];
  const results = [];
  for (const sid of sids) {
    const resp = await fetch(`/a/${sid}`, { credentials: 'include' });
    const html = await resp.text();
    const match = html.match(/data-filename="(\d{10,}\.(?:ass|srt|ssa|sub))"/i);
    results.push({ sid, filename: match ? match[1] : null });
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}
```

### 4c. Construct CDN URL and Download

Derive year/month from the timestamp, then download directly:

```
https://dl.subhd.tv/{YYYY}/{MM}/{filename}
```

Example: timestamp `1772788454048` → `new Date(1772788454048)` → March 2026 → `https://dl.subhd.tv/2026/03/1772788454048.ass`

```bash
curl -sL -o /tmp/sub.ass "https://dl.subhd.tv/2026/03/1772788454048.ass" -H "Referer: https://subhd.tv"
```

CDN URLs are **publicly accessible** (`access-control-allow-origin: *`) — no authentication needed. Known CDN domains: `dl.subhd.tv`, `dlus.subhd.tv`.

**Advantages**: No captcha, no API call, fast. Ideal for batch per-episode downloads.

## 5. Download Method B: Download API (Archive Entries / Fallback)

**Use when**: The entry is an archive (ZIP/RAR season pack), or `data-filename` is not found on the page.

### 5a. Navigate to Detail Page

Navigate the browser to `https://subhd.tv/a/{id}`. Required because the API uses session cookies.

### 5b. Call the Download API

```javascript
async () => {
  const response = await fetch('https://subhd.tv/api/sub/down', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sid: '{id}'})
  });
  return await response.json();
}
```

### 5c. Handle the Response

**Captcha required** (common on first call per session):
```json
{"success": true, "msg": "<svg ...>...</svg>", "pass": false, "url": null}
```

**Success** (captcha solved or session verified):
```json
{"success": true, "msg": "验证通过", "pass": true, "url": "https://dl.subhd.tv/2019/03/155179327521938.zip"}
```

**Session expired**:
```json
{"success": false, "msg": "时间过长本临时页面已经失效"}
```
→ Navigate back to `/a/{id}` and retry.

### 5d. Solve the SVG Captcha

1. Render the SVG captcha in the browser DOM, scaled up (450x150):

```javascript
async () => {
  const response = await fetch('https://subhd.tv/api/sub/down', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sid: '{id}'})
  });
  const data = await response.json();
  if (!data.pass && data.msg && data.msg.includes('<svg')) {
    const div = document.createElement('div');
    div.id = 'captcha-display';
    div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:white;padding:40px;border:3px solid red;border-radius:10px;';
    div.innerHTML = '<h2 style="text-align:center;margin-bottom:20px;">CAPTCHA</h2>' + data.msg;
    const svg = div.querySelector('svg');
    if (svg) { svg.setAttribute('width', '450'); svg.setAttribute('height', '150'); }
    document.body.appendChild(div);
    return 'captcha_needed';
  }
  return data;
}
```

2. Take a screenshot to read the captcha text visually.
3. Submit the answer:

```javascript
async () => {
  const response = await fetch('https://subhd.tv/api/sub/down', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({sid: '{id}', cap: '{answer}'})
  });
  return await response.json();
}
```

### 5e. Batch API Downloads

After solving one captcha, subsequent API calls in the same session **often** bypass the captcha — but **not always**. Be prepared to solve additional captchas.

```
For each subtitle entry:
  1. Navigate to https://subhd.tv/a/{id}
  2. Call API: POST /api/sub/down with {sid: "{id}"}
  3. If pass: true → extract CDN URL from response.url
  4. If captcha returned → solve it, then retry
  5. Download with curl -H "Referer: https://subhd.tv"
```

## 6. CDN Download & Archive Handling

### Direct Download

```bash
curl -sL -o /tmp/subs.zip "https://dl.subhd.tv/2019/03/155179327521938.zip" -H "Referer: https://subhd.tv"
```

### ZIP Archives with Chinese Filenames

macOS `unzip` cannot handle Chinese characters in ZIP filenames (CP437/GBK encoding). Use Python:

```python
import zipfile, os
zf = zipfile.ZipFile('/tmp/subs.zip')
for info in zf.infolist():
    try:
        fn = info.filename.encode('cp437').decode('utf-8')
    except:
        try:
            fn = info.filename.encode('cp437').decode('gbk')
        except:
            fn = info.filename
    basename = os.path.basename(fn)
    if not basename:
        continue
    with open(os.path.join('/tmp/extracted', basename), 'wb') as f:
        f.write(zf.read(info))
```

For RAR/7z: `unrar x archive.rar /tmp/subs/` or `7z x archive.7z -o/tmp/subs/`

Ignore `__MACOSX/` directories in archives.

## 7. File Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Bilingual (preferred) | `{video}.chs&eng.{ext}` | `Show.S01E01.1080p.WEB.mkv` → `Show.S01E01.1080p.WEB.chs&eng.ass` |
| Chinese only | `{video}.chs.{ext}` | `Show.S01E01.1080p.WEB.chs.srt` |
| Traditional Chinese | `{video}.cht.{ext}` | `Show.S01E01.1080p.WEB.cht.ass` |

Place subtitle files in the **same directory** as the video files.

To determine language tag: check subtitle description for "双语"/"bilingual"; for ASS files check `[V4+ Styles]` for separate Chinese/English styles; for SRT files look for alternating Chinese/English lines.

## 8. Concurrency

Chrome DevTools MCP is a single browser instance — no concurrent browser operations.

| Phase | Who | How |
|-------|-----|-----|
| Search | Workers (parallel) | WebFetch, no browser needed |
| Evaluate | Main agent | Review search results |
| Get URLs | Main agent (serial) | Browser: extract `data-filename` or call API |
| Download & deploy | Workers (parallel) | curl + file operations, no browser needed |

## 9. Batch Workflow

1. **Identify** — scan directories, find episodes missing Chinese subtitles
2. **Search** — parallel workers search SubHD via WebFetch
3. **Evaluate** — pick best subtitle per series/season
4. **Get URLs** — for each entry:
   - Try `data-filename` extraction first (Section 4)
   - If not found (archives), use download API (Section 5)
5. **Download & deploy** — parallel workers: curl download → extract → match to videos → rename
6. **Report** — episodes covered, formats, gaps

## Error Handling

- **No search results** → try alternate name (Chinese/English/Japanese), broaden query
- **API session expired** (`时间过长本临时页面已经失效`) → re-navigate to detail page, retry
- **Captcha solve fails** → API returns new captcha; re-render and retry
- **CDN 404** → file removed; try different subtitle entry
- **Anti-debugging blocks browser** → uBlock Origin with hagezi filters should handle this
- **Login expired** → re-login: `zezhengwu@163.com` / `Secant1995` (username: Secant)

## Notes

- SubHD's anti-debugging scripts (from `rtmark.net`, `axgbr.com`) are blocked by uBlock Origin with hagezi Pro filters, configured in the Chrome DevTools MCP browser profile.
- The download API requires being logged in. Browser should have session saved for user "Secant".
- CDN URLs are publicly accessible — no auth needed for file downloads.
- The API must be called from a SubHD page context (session cookies). Navigate to detail page first.
