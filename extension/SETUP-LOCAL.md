# Running HARvest Extension with Local LLM (Ollama)

Zero-cost, fully private API discovery — no data leaves your machine.

## Prerequisites

1. **Ollama** — local LLM runtime
   ```bash
   brew install ollama
   ollama serve
   ```

2. **Pull a model** (recommended: qwen2.5:7b for best accuracy)
   ```bash
   ollama pull qwen2.5:7b     # 98.4% accuracy, 4.7 GB
   # or for faster, lighter option:
   ollama pull qwen2.5:3b     # 77.8% accuracy, 1.9 GB
   ollama pull phi4-mini       # 90.5% accuracy, 2.5 GB
   ```

3. **Node.js 18+**

## Start the Backend with Local Provider

```bash
cd backend
npm install
LLM_PROVIDER=local LOCAL_LLM_MODEL=qwen2.5:7b npm run start:dev
```

The backend will run on `http://localhost:3001` and use Ollama for all LLM calls.

## Load the Extension

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" → select the `extension/` folder
4. Open any website → DevTools → "HAR Reverse Engineer" panel

## Verify

After analyzing a HAR capture, you should see a provider badge showing `local/qwen2.5:7b` next to the confidence score.

## Model Comparison

| Model | Accuracy | Speed | Size |
|-------|----------|-------|------|
| qwen2.5:7b | 98.4% | ~20s | 4.7 GB |
| phi4-mini | 90.5% | ~3s | 2.5 GB |
| qwen2.5:3b | 77.8% | ~10s | 1.9 GB |

## Troubleshooting

- **"Cannot connect to backend"** — ensure backend is running with `npm run start:dev`
- **Slow responses** — local models are slower than cloud APIs (3-20s vs 0.5s). Consider phi4-mini for faster interactive use.
- **Ollama not running** — run `ollama serve` in a separate terminal
