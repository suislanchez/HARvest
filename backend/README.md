# HARvest Backend

NestJS 11 API server powering HARvest API Reverse Engineer.

## Quick Start

```bash
npm install
npm run start:dev     # http://localhost:3001
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/analyze` | Upload HAR + description, get matched curl |
| `GET` | `/api/health` | Health check (uptime, memory, status) |
| `POST` | `/api/capture` | Store captured HAR data |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `groq` | Provider: `local`, `groq`, or `openai` |
| `LLM_FALLBACK` | — | Fallback chain (e.g. `groq,local`) |
| `GROQ_API_KEY` | — | Groq API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `LOCAL_LLM_MODEL` | `qwen2.5:3b` | Ollama model for local mode |
| `LOCAL_LLM_BASE_URL` | `http://localhost:11434/v1` | Ollama API URL |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origins (comma-separated) |

## CLI

```bash
npx harvest-api capture.har --description "the weather API"
npx harvest-api capture.har -d "login" --provider local --model qwen2.5:7b
npx harvest-api capture.har -d "cart" --json --top 3
```

The CLI supports SIGINT/SIGTERM for clean cancellation and has a 60s LLM timeout.

## Architecture

```
src/
├── main.ts                      App bootstrap + graceful shutdown
├── cli.ts                       CLI tool with signal handling
├── app.module.ts                Root module (throttler + health)
├── common/
│   ├── utils/llm-retry.ts       Retry utility (timeout + backoff)
│   ├── constants/               Skip domains, extensions, headers
│   └── filters/                 Global exception filter
└── modules/
    ├── analysis/                HAR parse → filter → dedup → summarize → match
    ├── health/                  GET /api/health endpoint
    ├── llm/                     Provider interface + fallback chain
    ├── openai/                  OpenAI provider (with retry, 30s timeout)
    ├── groq/                    Groq provider (with retry, 30s timeout)
    ├── local-llm/               Ollama provider (with retry, 60s timeout)
    └── capture/                 HAR capture storage
```

## Fault Tolerance

- **LLM retry**: 2 retries with exponential backoff on timeout, 429, 5xx, connection errors
- **Per-attempt timeout**: 30s cloud, 60s local (via AbortController)
- **Token overflow**: Summaries capped at 100k chars (~25k tokens), truncated at last complete line
- **Provider fallback**: `LLM_FALLBACK=groq,local` tries providers in order
- **Graceful shutdown**: `app.enableShutdownHooks()` for clean process termination
- **Health check**: `GET /api/health` returns status, uptime, memory usage

## Tests

```bash
npx jest                                          # 221 unit tests
npx jest --testPathIgnorePatterns='eval|e2e|ablation|performance|quantized'  # Core tests only
npx jest llm-retry                                # Retry utility tests
npx jest fallback-llm                             # Fallback chain tests
npx jest health                                   # Health endpoint tests
```
