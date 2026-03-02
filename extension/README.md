# HAR Reverse Engineer — Chrome Extension

A Chrome DevTools panel extension that captures HAR data directly from the Network tab and sends it to the backend for analysis.

## Prerequisites

- Backend running at `localhost:3001`
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
2. Click the **HAR Reverse Engineer** tab in the DevTools panel bar
3. Click **Capture HAR** — you'll see a count of captured requests
4. Type a description of the API you're looking for (e.g. "the login endpoint")
5. Click **Find API**
6. View the curl command, confidence score, and reasoning
7. Click **Copy curl** to copy to clipboard

## Notes

- DevTools must be open **before or during** page load to capture requests
- The extension uses `chrome.devtools.network.getHAR()` which only captures requests made while DevTools is open
- No special permissions required — HAR access is available to any DevTools extension
- The backend API endpoint (`POST /api/analyze`) is unchanged; the extension sends the same FormData format as the web UI
