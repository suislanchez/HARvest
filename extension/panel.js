const DEFAULT_API_URL = 'http://localhost:3001/api/analyze';

// --- DOM refs ---
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
const otherMatches = document.getElementById('otherMatches');
const otherMatchesList = document.getElementById('otherMatchesList');
const apiUrlInput = document.getElementById('apiUrl');
const themeToggle = document.getElementById('themeToggle');
const liveToggle = document.getElementById('liveToggle');
const liveIndicator = document.getElementById('liveIndicator');
const liveCountEl = document.getElementById('liveCount');
const filterOptions = document.getElementById('filterOptions');
const filterXhr = document.getElementById('filterXhr');
const filterAssets = document.getElementById('filterAssets');
const filterTracking = document.getElementById('filterTracking');
const dropZone = document.getElementById('dropZone');
const diffBtn = document.getElementById('diffBtn');
const diffResult = document.getElementById('diffResult');
const requestPreview = document.getElementById('requestPreview');
const requestPreviewContent = document.getElementById('requestPreviewContent');
const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistory');
const onboarding = document.getElementById('onboarding');
const onboardingDismiss = document.getElementById('onboardingDismiss');

// --- State ---
let harData = null;
let rawHarData = null; // unfiltered copy
let isCapturing = false;
let isAnalyzing = false;
let liveMode = false;
let liveEntries = [];
let liveListener = null;
let previousHarData = null;
let currentResultData = null;
let currentExportFormat = 'curl';

// Tracking domains to filter
const TRACKING_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'facebook.com/tr', 'analytics.', 'hotjar.com',
  'segment.io', 'segment.com', 'mixpanel.com', 'amplitude.com',
  'sentry.io', 'newrelic.com', 'datadoghq.com', 'fullstory.com',
  'clarity.ms', 'mouseflow.com', 'crazyegg.com', 'optimizely.com',
  'intercom.io', 'hubspot.com', 'marketo.net', 'pardot.com',
];

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

// =====================
// ONBOARDING
// =====================
(function initOnboarding() {
  chrome.storage.local.get('onboarded', (data) => {
    if (!data.onboarded) {
      onboarding.classList.remove('hidden');
    }
  });
})();

onboardingDismiss.addEventListener('click', () => {
  onboarding.classList.add('hidden');
  chrome.storage.local.set({ onboarded: true });
});

// =====================
// THEME TOGGLE
// =====================
(function initTheme() {
  chrome.storage.local.get('theme', (data) => {
    if (data.theme === 'light') {
      document.body.dataset.theme = 'light';
      themeToggle.textContent = '\u263E'; // moon
    }
  });
})();

themeToggle.addEventListener('click', () => {
  const isLight = document.body.dataset.theme === 'light';
  if (isLight) {
    delete document.body.dataset.theme;
    themeToggle.textContent = '\u2606'; // sun
    chrome.storage.local.set({ theme: 'dark' });
  } else {
    document.body.dataset.theme = 'light';
    themeToggle.textContent = '\u263E'; // moon
    chrome.storage.local.set({ theme: 'light' });
  }
});

// =====================
// REQUEST TYPE FILTERING
// =====================
function applyFilters(data) {
  if (!data || !data.log || !data.log.entries) return data;

  let entries = data.log.entries.slice();

  if (filterXhr.checked) {
    entries = entries.filter((e) => {
      const resType = (e._resourceType || '').toLowerCase();
      const mime = (e.response && e.response.content && e.response.content.mimeType) || '';
      if (resType === 'xhr' || resType === 'fetch') return true;
      if (mime.includes('json') || mime.includes('xml') || mime.includes('text/plain')) return true;
      // Keep if no resource type hint (e.g. from file import)
      if (!resType) return true;
      return false;
    });
  }

  if (filterAssets.checked) {
    entries = entries.filter((e) => {
      const url = e.request.url.toLowerCase();
      const resType = (e._resourceType || '').toLowerCase();
      if (['image', 'font', 'stylesheet'].includes(resType)) return false;
      if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|css)(\?|$)/i.test(url)) return false;
      return true;
    });
  }

  if (filterTracking.checked) {
    entries = entries.filter((e) => {
      const url = e.request.url.toLowerCase();
      return !TRACKING_DOMAINS.some((d) => url.includes(d));
    });
  }

  return { log: { ...data.log, entries } };
}

function onFilterChange() {
  if (!rawHarData) return;
  harData = applyFilters(rawHarData);
  const count = harData.log.entries.length;
  requestCount.textContent = `${count} requests`;
  requestCount.classList.remove('hidden');
}

filterXhr.addEventListener('change', onFilterChange);
filterAssets.addEventListener('change', onFilterChange);
filterTracking.addEventListener('change', onFilterChange);

// =====================
// CAPTURE HAR
// =====================
captureBtn.addEventListener('click', () => {
  if (isCapturing) return;
  isCapturing = true;

  hideError();
  harWarning.classList.add('hidden');
  result.classList.add('hidden');
  diffResult.classList.add('hidden');

  chrome.devtools.network.getHAR((harLog) => {
    isCapturing = false;

    if (!harLog.entries || harLog.entries.length === 0) {
      showError('No requests captured. Make sure the page has loaded with DevTools open.');
      return;
    }

    // Store previous for diff
    if (harData) {
      previousHarData = harData;
    }

    rawHarData = { log: harLog };
    harData = applyFilters(rawHarData);

    // HAR size validation
    const harJson = JSON.stringify(rawHarData);
    const sizeMB = harJson.length / (1024 * 1024);

    if (sizeMB > 100) {
      showError('HAR capture is over 100 MB — too large to upload. Reload the page and capture fewer requests.');
      harData = null;
      rawHarData = null;
      return;
    }

    if (sizeMB > 50) {
      harWarning.textContent = `Warning: HAR capture is ${Math.round(sizeMB)} MB. Upload may be slow or fail.`;
      harWarning.classList.remove('hidden');
    }

    requestCount.textContent = `${harData.log.entries.length} requests`;
    requestCount.classList.remove('hidden');
    filterOptions.classList.remove('hidden');
    description.disabled = false;
    description.focus();
    updateAnalyzeBtn();
    updateDiffBtn();
  });
});

// =====================
// LIVE CAPTURE MODE
// =====================
liveToggle.addEventListener('click', () => {
  if (liveMode) {
    stopLiveCapture();
  } else {
    startLiveCapture();
  }
});

function startLiveCapture() {
  liveMode = true;
  liveEntries = [];
  liveToggle.textContent = 'Stop';
  liveIndicator.classList.remove('hidden');
  liveCountEl.textContent = '0';

  hideError();
  harWarning.classList.add('hidden');

  liveListener = (request) => {
    liveEntries.push(request);
    liveCountEl.textContent = String(liveEntries.length);
  };

  chrome.devtools.network.onRequestFinished.addListener(liveListener);
}

function stopLiveCapture() {
  liveMode = false;
  liveToggle.textContent = 'Live Capture';
  liveIndicator.classList.add('hidden');

  if (liveListener) {
    chrome.devtools.network.onRequestFinished.removeListener(liveListener);
    liveListener = null;
  }

  if (liveEntries.length === 0) {
    showError('No requests captured during live session.');
    return;
  }

  // Store previous for diff
  if (harData) {
    previousHarData = harData;
  }

  // Wrap entries into HAR format
  const harLog = {
    version: '1.2',
    creator: { name: 'HAR Reverse Engineer (live)', version: '0.3.0' },
    entries: liveEntries.map((req) => {
      // onRequestFinished gives us a HAR entry-like object
      return req;
    }),
  };

  rawHarData = { log: harLog };
  harData = applyFilters(rawHarData);

  requestCount.textContent = `${harData.log.entries.length} requests`;
  requestCount.classList.remove('hidden');
  filterOptions.classList.remove('hidden');
  description.disabled = false;
  description.focus();
  updateAnalyzeBtn();
  updateDiffBtn();
}

// Clean up on unload
window.addEventListener('unload', () => {
  if (liveListener) {
    chrome.devtools.network.onRequestFinished.removeListener(liveListener);
  }
});

// =====================
// HAR DIFF
// =====================
function updateDiffBtn() {
  if (previousHarData && harData) {
    diffBtn.classList.remove('hidden');
  } else {
    diffBtn.classList.add('hidden');
  }
}

diffBtn.addEventListener('click', () => {
  if (!previousHarData || !harData) return;

  const prevKeys = new Set(
    previousHarData.log.entries.map((e) => `${e.request.method}|${e.request.url}`)
  );

  const newEntries = harData.log.entries.filter(
    (e) => !prevKeys.has(`${e.request.method}|${e.request.url}`)
  );

  if (newEntries.length === 0) {
    diffResult.innerHTML = 'No new requests compared to previous capture.';
  } else {
    let html = `<strong>${newEntries.length} new request${newEntries.length > 1 ? 's' : ''}:</strong><ul>`;
    for (const e of newEntries.slice(0, 20)) {
      const method = e.request.method;
      const url = e.request.url;
      const short = url.length > 60 ? url.slice(0, 57) + '...' : url;
      html += `<li>${method} ${short}</li>`;
    }
    if (newEntries.length > 20) {
      html += `<li>... and ${newEntries.length - 20} more</li>`;
    }
    html += '</ul>';
    diffResult.innerHTML = html;
  }

  diffResult.classList.remove('hidden');
});

// =====================
// DRAG & DROP HAR IMPORT
// =====================
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');

  const file = e.dataTransfer.files[0];
  if (!file) return;

  if (!file.name.endsWith('.har') && !file.name.endsWith('.json')) {
    showError('Please drop a .har or .json file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);

      if (!parsed.log || !parsed.log.entries || !Array.isArray(parsed.log.entries)) {
        showError('Invalid HAR file — missing log.entries array.');
        return;
      }

      if (parsed.log.entries.length === 0) {
        showError('HAR file contains no entries.');
        return;
      }

      // Size check
      const sizeMB = reader.result.length / (1024 * 1024);
      if (sizeMB > 100) {
        showError('HAR file is over 100 MB — too large to upload.');
        return;
      }

      if (sizeMB > 50) {
        harWarning.textContent = `Warning: HAR file is ${Math.round(sizeMB)} MB. Upload may be slow or fail.`;
        harWarning.classList.remove('hidden');
      }

      // Store previous for diff
      if (harData) {
        previousHarData = harData;
      }

      rawHarData = parsed;
      harData = applyFilters(rawHarData);

      hideError();
      requestCount.textContent = `${harData.log.entries.length} requests`;
      requestCount.classList.remove('hidden');
      filterOptions.classList.remove('hidden');
      description.disabled = false;
      description.focus();
      updateAnalyzeBtn();
      updateDiffBtn();

      dropZone.textContent = `Loaded: ${file.name}`;
      setTimeout(() => { dropZone.textContent = 'or drop a .har file here'; }, 3000);
    } catch {
      showError('Failed to parse file as JSON.');
    }
  };
  reader.readAsText(file);
});

// Also allow click to open file picker
dropZone.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.har,.json';
  input.addEventListener('change', () => {
    if (input.files[0]) {
      const dt = new DataTransfer();
      dt.items.add(input.files[0]);
      dropZone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt }));
    }
  });
  input.click();
});

// =====================
// ENABLE/DISABLE ANALYZE
// =====================
description.addEventListener('input', updateAnalyzeBtn);

function updateAnalyzeBtn() {
  analyzeBtn.disabled = isAnalyzing || !(harData && description.value.trim().length >= 5);
}

// =====================
// ANALYZE
// =====================
analyzeBtn.addEventListener('click', () => runAnalysis());

async function runAnalysis(customHarData) {
  if (isAnalyzing) return;

  const sendData = customHarData || harData;
  const desc = description.value.trim();
  if (!sendData || desc.length < 5) return;

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
    const blob = new Blob([JSON.stringify(sendData)], { type: 'application/json' });
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

    currentResultData = data;
    currentExportFormat = 'curl';
    displayResult(data);
    saveToHistory(desc, data);
  } catch (err) {
    showError(formatError(err));
  } finally {
    clearTimeout(statusTimer);
    isAnalyzing = false;
    spinner.classList.add('hidden');
    statusText.classList.add('hidden');
    updateAnalyzeBtn();
  }
}

// =====================
// DISPLAY RESULT
// =====================
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

  // Reset export buttons
  const exportBtns = document.querySelectorAll('.export-group .btn-small');
  exportBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.format === 'curl');
  });

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

  // Request preview
  showRequestPreview(data);

  result.classList.remove('hidden');
}

// =====================
// REQUEST PREVIEW
// =====================
function showRequestPreview(data) {
  if (!data.matchedRequest || !harData) {
    requestPreview.classList.add('hidden');
    return;
  }

  const matched = data.matchedRequest;
  const entry = harData.log.entries.find(
    (e) => e.request.url === matched.url && e.request.method === matched.method
  );

  if (!entry) {
    requestPreview.classList.add('hidden');
    return;
  }

  let html = '<div class="request-preview-content">';

  // Request headers
  html += '<h4>Request Headers</h4>';
  if (entry.request.headers && entry.request.headers.length > 0) {
    for (const h of entry.request.headers) {
      html += `${escapeHtml(h.name)}: ${escapeHtml(h.value)}\n`;
    }
  } else {
    html += '(none)\n';
  }

  // Response headers
  html += '<h4>Response Headers</h4>';
  if (entry.response && entry.response.headers && entry.response.headers.length > 0) {
    for (const h of entry.response.headers) {
      html += `${escapeHtml(h.name)}: ${escapeHtml(h.value)}\n`;
    }
  } else {
    html += '(none)\n';
  }

  // Response body
  html += '<h4>Response Body</h4>';
  const bodyText = entry.response && entry.response.content && entry.response.content.text;
  if (bodyText) {
    let display = bodyText.slice(0, 2000);
    // Try to pretty-print JSON
    try {
      const parsed = JSON.parse(bodyText);
      display = JSON.stringify(parsed, null, 2).slice(0, 2000);
    } catch { /* not JSON, use raw */ }
    html += escapeHtml(display);
    if (bodyText.length > 2000) html += '\n... (truncated)';
  } else {
    html += '(empty)';
  }

  html += '</div>';

  requestPreviewContent.innerHTML = html;
  requestPreview.classList.remove('hidden');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =====================
// MULTI-FORMAT EXPORT
// =====================
function parseCurl(curlStr) {
  const result = { method: 'GET', url: '', headers: {}, body: null };

  // Extract URL (first non-flag argument or after curl)
  const urlMatch = curlStr.match(/curl\s+'([^']+)'/) || curlStr.match(/curl\s+"([^"]+)"/) || curlStr.match(/curl\s+(\S+)/);
  if (urlMatch) result.url = urlMatch[1];

  // Method
  const methodMatch = curlStr.match(/-X\s+'?([A-Z]+)'?/) || curlStr.match(/--request\s+'?([A-Z]+)'?/);
  if (methodMatch) result.method = methodMatch[1];

  // Headers
  const headerRegex = /-H\s+'([^']+)'/g;
  let hMatch;
  while ((hMatch = headerRegex.exec(curlStr)) !== null) {
    const colonIdx = hMatch[1].indexOf(':');
    if (colonIdx > 0) {
      const name = hMatch[1].slice(0, colonIdx).trim();
      const value = hMatch[1].slice(colonIdx + 1).trim();
      result.headers[name] = value;
    }
  }

  // Body
  const bodyMatch = curlStr.match(/(?:-d|--data|--data-raw|--data-binary)\s+'([^']*(?:\\.[^']*)*)'/) ||
                    curlStr.match(/(?:-d|--data|--data-raw|--data-binary)\s+"([^"]*(?:\\.[^"]*)*)"/);
  if (bodyMatch) {
    result.body = bodyMatch[1];
    if (result.method === 'GET') result.method = 'POST';
  }

  return result;
}

function generateFetch(curlStr) {
  const p = parseCurl(curlStr);
  let code = `fetch('${p.url}'`;

  const opts = [];
  if (p.method !== 'GET') opts.push(`  method: '${p.method}'`);

  if (Object.keys(p.headers).length > 0) {
    const hLines = Object.entries(p.headers)
      .map(([k, v]) => `    '${k}': '${v}'`)
      .join(',\n');
    opts.push(`  headers: {\n${hLines}\n  }`);
  }

  if (p.body) {
    opts.push(`  body: ${JSON.stringify(p.body)}`);
  }

  if (opts.length > 0) {
    code += `, {\n${opts.join(',\n')}\n}`;
  }

  code += ')\n  .then(res => res.json())\n  .then(data => console.log(data));';
  return code;
}

function generateAxios(curlStr) {
  const p = parseCurl(curlStr);
  const method = p.method.toLowerCase();

  let code = `axios.${method}('${p.url}'`;

  if (p.body && ['post', 'put', 'patch'].includes(method)) {
    // Try to parse as JSON for clean output
    try {
      const parsed = JSON.parse(p.body);
      code += `, ${JSON.stringify(parsed, null, 2)}`;
    } catch {
      code += `, ${JSON.stringify(p.body)}`;
    }
  }

  if (Object.keys(p.headers).length > 0) {
    const hLines = Object.entries(p.headers)
      .map(([k, v]) => `    '${k}': '${v}'`)
      .join(',\n');
    code += `, {\n  headers: {\n${hLines}\n  }\n}`;
  }

  code += '\n  .then(res => console.log(res.data));';
  return code;
}

function generatePython(curlStr) {
  const p = parseCurl(curlStr);
  let code = 'import requests\n\n';

  if (Object.keys(p.headers).length > 0) {
    code += 'headers = {\n';
    for (const [k, v] of Object.entries(p.headers)) {
      code += `    '${k}': '${v}',\n`;
    }
    code += '}\n\n';
  }

  if (p.body) {
    // Try JSON
    try {
      JSON.parse(p.body);
      code += `data = ${p.body}\n\n`;
    } catch {
      code += `data = '${p.body}'\n\n`;
    }
  }

  code += `response = requests.${p.method.toLowerCase()}(\n    '${p.url}'`;
  if (Object.keys(p.headers).length > 0) code += ',\n    headers=headers';
  if (p.body) {
    try {
      JSON.parse(p.body);
      code += ',\n    json=data';
    } catch {
      code += ',\n    data=data';
    }
  }
  code += '\n)\n\nprint(response.json())';
  return code;
}

// Export button click handler
document.querySelector('.export-group').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-format]');
  if (!btn || !currentResultData) return;

  const format = btn.dataset.format;
  currentExportFormat = format;

  // Update active state
  document.querySelectorAll('.export-group .btn-small').forEach((b) => {
    b.classList.toggle('active', b.dataset.format === format);
  });

  // Generate code
  const curlStr = currentResultData.curl;
  let output;
  switch (format) {
    case 'curl': output = curlStr; break;
    case 'fetch': output = generateFetch(curlStr); break;
    case 'axios': output = generateAxios(curlStr); break;
    case 'python': output = generatePython(curlStr); break;
    default: output = curlStr;
  }

  curlOutput.textContent = output;

  // Copy to clipboard
  copyToClipboard(output, btn);
});

async function copyToClipboard(text, feedbackEl) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
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

  if (feedbackEl) {
    const orig = feedbackEl.textContent;
    feedbackEl.textContent = copied ? 'Copied!' : 'Failed';
    setTimeout(() => { feedbackEl.textContent = orig; }, 1500);
  }
}

// =====================
// ANALYSIS HISTORY
// =====================
function saveToHistory(desc, data) {
  chrome.storage.local.get('har_history', (stored) => {
    const history = stored.har_history || [];

    history.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      description: desc,
      confidence: data.confidence,
      curl: data.curl,
      matchedRequest: data.matchedRequest,
      reason: data.reason,
    });

    // Cap at 50
    if (history.length > 50) history.length = 50;

    chrome.storage.local.set({ har_history: history }, () => {
      renderHistory(history);
    });
  });
}

function loadHistory() {
  chrome.storage.local.get('har_history', (stored) => {
    const history = stored.har_history || [];
    renderHistory(history);
  });
}

function renderHistory(history) {
  historyList.innerHTML = '';

  if (history.length === 0) {
    historySection.classList.add('hidden');
    return;
  }

  historySection.classList.remove('hidden');

  for (const item of history) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.dataset.id = item.id;

    const ts = document.createElement('span');
    ts.className = 'history-timestamp';
    const d = new Date(item.timestamp);
    ts.textContent = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

    const desc = document.createElement('span');
    desc.className = 'history-desc';
    desc.textContent = item.description;

    const conf = document.createElement('span');
    conf.className = 'history-confidence';
    const pct = Math.round(item.confidence * 100);
    conf.textContent = `${pct}%`;

    li.appendChild(ts);
    li.appendChild(desc);
    li.appendChild(conf);

    li.addEventListener('click', () => {
      currentResultData = item;
      currentExportFormat = 'curl';
      displayResult(item);
      result.scrollIntoView({ behavior: 'smooth' });
    });

    historyList.appendChild(li);
  }
}

clearHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear all analysis history?')) return;
  chrome.storage.local.set({ har_history: [] }, () => {
    renderHistory([]);
  });
});

// Load history on startup
loadHistory();

// =====================
// KEYBOARD SHORTCUTS
// =====================
document.addEventListener('keydown', (e) => {
  // Enter — trigger analyze (when description focused and valid)
  if (e.key === 'Enter' && !e.shiftKey && document.activeElement === description) {
    if (!analyzeBtn.disabled) {
      e.preventDefault();
      runAnalysis();
    }
    return;
  }

  // Ctrl/Cmd + C — copy current output (when result visible and no text selected)
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    const selection = window.getSelection().toString();
    if (!selection && !result.classList.contains('hidden')) {
      e.preventDefault();
      copyToClipboard(curlOutput.textContent);
    }
    return;
  }

  // Escape — clear result and error
  if (e.key === 'Escape') {
    result.classList.add('hidden');
    hideError();
    diffResult.classList.add('hidden');
    requestPreview.classList.add('hidden');
    return;
  }
});

// =====================
// HELPERS
// =====================
function showError(msg) {
  error.textContent = msg;
  error.classList.remove('hidden');
}

function hideError() {
  error.classList.add('hidden');
}
