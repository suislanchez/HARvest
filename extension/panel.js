const DEFAULT_API_URL = 'http://localhost:3001/api/analyze';

const captureBtn = document.getElementById('captureBtn');
const requestCount = document.getElementById('requestCount');
const harWarning = document.getElementById('harWarning');
const description = document.getElementById('description');
const analyzeBtn = document.getElementById('analyzeBtn');
const spinner = document.getElementById('spinner');
const statusText = document.getElementById('statusText');
const error = document.getElementById('error');
const result = document.getElementById('result');
const confidence = document.getElementById('confidence');
const matchedRequest = document.getElementById('matchedRequest');
const reason = document.getElementById('reason');
const curlOutput = document.getElementById('curlOutput');
const copyBtn = document.getElementById('copyBtn');
const otherMatches = document.getElementById('otherMatches');
const otherMatchesList = document.getElementById('otherMatchesList');
const apiUrlInput = document.getElementById('apiUrl');

let harData = null;
let isCapturing = false;
let isAnalyzing = false;

function getApiUrl() {
  const val = apiUrlInput.value.trim();
  return val || DEFAULT_API_URL;
}

// --- HttpError ---
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function formatError(err) {
  const url = getApiUrl();
  if (err.name === 'TimeoutError') {
    return 'Request timed out after 60s. The analysis may be taking too long — try a smaller HAR capture.';
  }
  if (err instanceof HttpError) {
    if (err.status === 429) return 'Rate limited by the backend. Please wait a moment and try again.';
    if (err.status === 413) return 'HAR file is too large for the backend to process. Capture fewer requests.';
    if ([502, 503, 504].includes(err.status)) return 'Backend appears to be down or restarting. Please try again shortly.';
    return err.message;
  }
  if (err.message === 'Failed to fetch') {
    return `Cannot connect to backend at ${url}. Is it running with CORS_ORIGIN=* ?`;
  }
  return err.message;
}

// --- Capture HAR ---
captureBtn.addEventListener('click', () => {
  if (isCapturing) return;
  isCapturing = true;

  // Clear stale state
  hideError();
  harWarning.classList.add('hidden');
  result.classList.add('hidden');
  harData = null;

  chrome.devtools.network.getHAR((harLog) => {
    isCapturing = false;

    if (!harLog.entries || harLog.entries.length === 0) {
      showError('No requests captured. Make sure the page has loaded with DevTools open.');
      return;
    }

    harData = { log: harLog };

    // HAR size validation
    const harJson = JSON.stringify(harData);
    const sizeMB = harJson.length / (1024 * 1024);

    if (sizeMB > 100) {
      showError('HAR capture is over 100 MB — too large to upload. Reload the page and capture fewer requests.');
      harData = null;
      return;
    }

    if (sizeMB > 50) {
      harWarning.textContent = `Warning: HAR capture is ${Math.round(sizeMB)} MB. Upload may be slow or fail.`;
      harWarning.classList.remove('hidden');
    }

    requestCount.textContent = `${harLog.entries.length} requests`;
    requestCount.classList.remove('hidden');
    description.disabled = false;
    description.focus();
    updateAnalyzeBtn();
  });
});

// --- Enable/disable analyze button ---
description.addEventListener('input', updateAnalyzeBtn);

function updateAnalyzeBtn() {
  analyzeBtn.disabled = isAnalyzing || !(harData && description.value.trim().length >= 5);
}

// --- Analyze ---
analyzeBtn.addEventListener('click', async () => {
  if (isAnalyzing) return;

  const desc = description.value.trim();
  if (!harData || desc.length < 5) return;

  isAnalyzing = true;
  analyzeBtn.disabled = true;
  spinner.classList.remove('hidden');
  statusText.textContent = 'Uploading HAR...';
  statusText.classList.remove('hidden');
  hideError();
  result.classList.add('hidden');

  const statusTimer = setTimeout(() => {
    statusText.textContent = 'Analyzing with AI...';
  }, 3000);

  try {
    const blob = new Blob([JSON.stringify(harData)], { type: 'application/json' });
    const file = new File([blob], 'capture.har', { type: 'application/json' });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('description', desc);

    const res = await fetch(getApiUrl(), {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new HttpError(res.status, body?.message || `Server error ${res.status}`);
    }

    const data = await res.json();

    if (!data.curl || data.confidence === undefined) {
      throw new Error('Invalid response from backend — missing curl or confidence.');
    }

    displayResult(data);
  } catch (err) {
    showError(formatError(err));
  } finally {
    clearTimeout(statusTimer);
    isAnalyzing = false;
    spinner.classList.add('hidden');
    statusText.classList.add('hidden');
    updateAnalyzeBtn();
  }
});

// --- Display result ---
function displayResult(data) {
  const pct = Math.max(0, Math.min(100, Math.round(data.confidence * 100)));
  confidence.textContent = `${pct}%`;
  confidence.className = 'confidence-badge';
  if (pct >= 80) confidence.classList.add('confidence-high');
  else if (pct >= 50) confidence.classList.add('confidence-medium');
  else confidence.classList.add('confidence-low');

  if (data.matchedRequest) {
    const label = `${data.matchedRequest.method} ${data.matchedRequest.url}`;
    matchedRequest.textContent = label;
    matchedRequest.title = label;
  }

  reason.textContent = data.reason || '';
  curlOutput.textContent = data.curl || '';

  if (data.topMatches && data.topMatches.length > 0) {
    otherMatchesList.innerHTML = '';
    for (const match of data.topMatches) {
      const li = document.createElement('li');
      const confSpan = document.createElement('span');
      confSpan.className = 'match-confidence';
      const matchPct = Math.max(0, Math.min(100, Math.round(match.confidence * 100)));
      confSpan.textContent = `${matchPct}%`;
      const methodSpan = document.createElement('span');
      methodSpan.className = 'match-method';
      const matchLabel = `${match.method} ${match.url}`;
      methodSpan.textContent = matchLabel;
      methodSpan.title = matchLabel;
      li.appendChild(confSpan);
      li.appendChild(methodSpan);
      if (match.reason) {
        const reasonText = document.createTextNode(` — ${match.reason}`);
        li.appendChild(reasonText);
      }
      otherMatchesList.appendChild(li);
    }
    otherMatches.classList.remove('hidden');
  } else {
    otherMatches.classList.add('hidden');
  }

  result.classList.remove('hidden');
}

// --- Copy curl ---
copyBtn.addEventListener('click', async () => {
  if (copyBtn.disabled) return;
  copyBtn.disabled = true;

  const text = curlOutput.textContent;
  let copied = false;

  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    // Fallback: hidden textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      copied = false;
    }
  }

  copyBtn.textContent = copied ? 'Copied!' : 'Failed to copy';
  setTimeout(() => {
    copyBtn.textContent = 'Copy curl';
    copyBtn.disabled = false;
  }, 1500);
});

// --- Helpers ---
function showError(msg) {
  error.textContent = msg;
  error.classList.remove('hidden');
}

function hideError() {
  error.classList.add('hidden');
}
