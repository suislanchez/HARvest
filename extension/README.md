# HARvest — Chrome DevTools Extension

A Chrome DevTools panel extension that captures HAR data directly from the Network tab and sends it to the HARvest backend for AI-powered API discovery.

## Prerequisites

- HARvest backend running at `localhost:3001`
- Chrome or Chromium-based browser

## Setup

### 1. Start the backend with CORS enabled

```bash
cd backend
CORS_ORIGIN=* npm run dev
```

### 2. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `extension/` directory

## Usage

1. Open any website and open DevTools (F12)
2. Click the **HARvest** tab in the DevTools panel bar
3. Check the connection dot (green = backend connected, yellow = checking, red = unreachable)
4. Click **Capture HAR** — you'll see a count of captured requests
5. Or use **Live Capture** to record requests in real time (50MB warning, 100MB auto-stop)
6. Type a description of the API you're looking for (e.g. "the login endpoint")
7. Click **Find API**
8. View the curl command, confidence score, and reasoning
9. Export as curl, fetch, axios, or Python

## Features

- **One-click HAR capture** from DevTools Network tab
- **Live capture mode** with automatic size limits
- **Connection status indicator** — green/yellow/red dot showing backend health
- **Retry on transient errors** — automatic retry with backoff on 429/5xx/network errors
- **Multi-format export** — curl, fetch, axios, Python
- **Analysis history** — stored in `chrome.storage.local` (50 item cap)
- **HAR diff** — compare new requests vs. previous capture
- **Provider badge** — shows which LLM was used for matching
- **Dark/light theme**
- **Drag & drop** HAR file import
- **Storage error handling** — graceful fallback on `chrome.storage` errors

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Analyze (when description focused) |
| Ctrl/Cmd+C | Copy curl output |
| Escape | Clear result |

## Notes

- DevTools must be open **before or during** page load to capture requests
- The extension uses `chrome.devtools.network.getHAR()` which only captures requests made while DevTools is open
- No special permissions required — HAR access is available to any DevTools extension
- The backend API endpoint (`POST /api/analyze`) is unchanged; the extension sends the same FormData format as the web UI

## Local LLM Setup

See [`SETUP-LOCAL.md`](./SETUP-LOCAL.md) for running with Ollama (zero cost, fully private).
