#!/bin/bash
# Test the auto-capture endpoint with diverse real-world URLs
# Saves captured HARs to public-captures/

OUTPUT_DIR="public-captures"
mkdir -p "$OUTPUT_DIR"

capture() {
  local name="$1"
  local url="$2"
  local filename="$3"

  printf "  %-40s " "$name..."

  # Hit the capture endpoint, extract the HAR from SSE complete event
  response=$(curl -s -X POST http://localhost:3001/api/capture \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$url\"}" \
    --max-time 35 2>&1)

  # Check for error event
  if echo "$response" | grep -q '"event":"error"'; then
    error=$(echo "$response" | grep 'event: error' -A1 | grep 'data:' | sed 's/data: //')
    echo "FAIL - $error"
    return 1
  fi

  # Extract HAR JSON from complete event
  har=$(echo "$response" | grep '^data: ' | tail -1 | sed 's/^data: //' | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'har' in data:
    print(data['har'])
" 2>/dev/null)

  if [ -z "$har" ]; then
    echo "FAIL - no HAR data"
    return 1
  fi

  echo "$har" > "$OUTPUT_DIR/$filename"
  entries=$(echo "$har" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['log']['entries']))" 2>/dev/null)
  size=$(du -k "$OUTPUT_DIR/$filename" | cut -f1)
  echo "OK - $entries entries, ${size}KB"
  return 0
}

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  TESTING AUTO-CAPTURE ENDPOINT WITH REAL SITES"
echo "════════════════════════════════════════════════════════════"
echo ""

successes=0
failures=0

# Fresh sites not in the existing collection
capture "Lobsters (tech news)"           "https://lobste.rs"                              "lobsters.har"           && ((successes++)) || ((failures++))
capture "Lichess (chess platform)"        "https://lichess.org"                            "lichess.har"            && ((successes++)) || ((failures++))
capture "Are.na (creative platform)"      "https://www.are.na"                             "arena.har"              && ((successes++)) || ((failures++))
capture "Sourcegraph (code search)"       "https://sourcegraph.com/search"                 "sourcegraph.har"        && ((successes++)) || ((failures++))
capture "Exercism (coding exercises)"     "https://exercism.org/tracks"                    "exercism.har"           && ((successes++)) || ((failures++))
capture "Hacker News API (algolia)"       "https://hn.algolia.com/?q=rust"                 "hn-algolia.har"         && ((successes++)) || ((failures++))
capture "IndieHackers"                    "https://www.indiehackers.com"                   "indiehackers.har"       && ((successes++)) || ((failures++))
capture "Dev.to (blog platform)"          "https://dev.to"                                 "devto.har"              && ((successes++)) || ((failures++))
capture "Supabase Dashboard"              "https://supabase.com/dashboard"                 "supabase.har"           && ((successes++)) || ((failures++))
capture "Linear (project mgmt)"          "https://linear.app"                             "linear.har"             && ((successes++)) || ((failures++))
capture "Vercel (deploy platform)"        "https://vercel.com/templates"                   "vercel-templates.har"   && ((successes++)) || ((failures++))
capture "Crates.io (Rust registry)"       "https://crates.io"                              "crates-io.har"          && ((successes++)) || ((failures++))
capture "PyPI (Python registry)"          "https://pypi.org/project/requests/"              "pypi-requests.har"      && ((successes++)) || ((failures++))
capture "Homebrew Formulae"               "https://formulae.brew.sh"                       "homebrew.har"           && ((successes++)) || ((failures++))
capture "Can I Use (web compat)"          "https://caniuse.com"                            "caniuse.har"            && ((successes++)) || ((failures++))
capture "Bundlephobia (pkg size)"         "https://bundlephobia.com/package/react@18.2.0"  "bundlephobia.har"       && ((successes++)) || ((failures++))
capture "StackShare (tech stacks)"        "https://stackshare.io/trending/tools"           "stackshare.har"         && ((successes++)) || ((failures++))
capture "Product Hunt"                    "https://www.producthunt.com"                    "producthunt.har"        && ((successes++)) || ((failures++))
capture "Glitch (web apps)"              "https://glitch.com"                             "glitch.har"             && ((successes++)) || ((failures++))
capture "Observable (data viz)"          "https://observablehq.com/trending"              "observable.har"         && ((successes++)) || ((failures++))
capture "MDN Web Docs"                    "https://developer.mozilla.org/en-US/"           "mdn.har"               && ((successes++)) || ((failures++))
capture "Cloudflare Radar"               "https://radar.cloudflare.com"                   "cloudflare-radar.har"   && ((successes++)) || ((failures++))
capture "Postman Echo"                    "https://postman-echo.com/get?foo=bar"           "postman-echo.har"       && ((successes++)) || ((failures++))
capture "JSONBin.io"                      "https://jsonbin.io"                             "jsonbin.har"            && ((successes++)) || ((failures++))
capture "Netlify (hosting)"              "https://www.netlify.com"                        "netlify.har"            && ((successes++)) || ((failures++))

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  RESULTS: $successes succeeded, $failures failed"
echo "════════════════════════════════════════════════════════════"
echo ""
