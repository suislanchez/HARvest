# HAR File Size Limits & Streaming

Research into handling large HAR files: memory limits, streaming parsers, chunked processing, and practical size constraints.

---

## Real-World HAR File Sizes

| Category | Size range | Examples |
|----------|-----------|---------|
| **Small** | 50KB–2MB | Simple page loads, few resources |
| **Medium** | 2MB–20MB | SPAs with many API calls, third-party scripts, fonts |
| **Large** | 20MB–100MB | Extended recording sessions, enterprise apps, video pages |
| **Extreme** | 100MB–500MB+ | Long dev sessions, automated test suites, binary responses |

**Practical guideline**: 10MB limit is conservative but safe. 50MB is reasonable for enterprise users. Above 100MB requires streaming.

---

## What Happens with JSON.parse on Large Files

### Memory Amplification

A 200MB JSON file can consume **up to 2GB of heap** during parsing (~10x the raw file size):

- V8 builds an in-memory object graph from the JSON AST
- String data is allocated as V8 heap strings
- Multiple intermediate representations may exist simultaneously
- Garbage collector pressure increases dramatically

### V8 Heap Limits

Default `--max-old-space-size` is ~1.5GB on 64-bit systems. Parsing a 200MB JSON can trigger OOM.

Memory during HAR processing (all held simultaneously):
```
Raw file bytes (Buffer)           → 200MB
Parsed JSON tree (object graph)   → 400-800MB
Filtered/transformed entries      → 50-200MB
                                    ─────────
Total peak                        → 650MB-1.2GB
```

### Event Loop Blocking

`JSON.parse` is **synchronous** — it blocks the event loop for the entire duration. A 50MB JSON parse can block for hundreds of milliseconds, causing latency spikes for all concurrent requests.

---

## Streaming JSON Parsers

### stream-json (Recommended)

SAX-inspired streaming parser. Emits individual JSON tokens as a Node.js Readable stream.

```typescript
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/Pick';
import { streamArray } from 'stream-json/streamers/StreamArray';

const pipeline = chain([
  fs.createReadStream('large.har'),
  parser(),
  pick({ filter: 'log.entries' }),     // Select nested path
  streamArray(),                        // Iterate array elements
]);

pipeline.on('data', ({ value: entry }) => {
  processEntry(entry);  // Each entry processed individually
});
```

**Memory footprint**: Processes files far exceeding available memory with sub-100MB usage. Only one entry is in memory at a time.

**HAR-specific usage**: HAR structure is `{ log: { entries: [...] } }` — `pick` selects `entries`, then `streamArray` iterates individual entries.

### JSONStream

```typescript
const stream = JSONStream.parse('log.entries.*');
fs.createReadStream('large.har').pipe(stream);
stream.on('data', (entry) => processEntry(entry));
```

- Simpler API with dot-notation path selectors
- Older, less actively maintained
- Known OOM issues if individual array elements are very large

### clarinet

- Lower-level SAX-style parser
- More boilerplate but full control
- Good for highly custom processing

### Recommendation

| File size | Strategy |
|-----------|----------|
| < 50MB | `JSON.parse` — simpler and faster |
| 50-200MB | `stream-json` with `Pick` + `StreamArray` |
| > 200MB | `stream-json` + worker threads |

---

## Multer File Size Configuration

### Current Approach: Memory Storage

```typescript
FileInterceptor('file', {
  storage: memoryStorage(),   // Entire file in req.file.buffer
  limits: {
    fileSize: 50 * 1024 * 1024,  // 50MB hard limit
    files: 1,
  },
})
```

With `memoryStorage()`, the entire file lives in `req.file.buffer` (a `Buffer` in RAM). This is fine for files under ~50MB but becomes problematic for larger files.

### For Large Files: Disk Storage

```typescript
import { diskStorage } from 'multer';

FileInterceptor('file', {
  storage: diskStorage({
    destination: '/tmp/har-uploads',
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },  // 200MB
})

// In controller:
const readStream = fs.createReadStream(file.path);
// Pipe through stream-json...
// After processing:
fs.unlink(file.path, () => {});
```

**Trade-off**: Disk storage doesn't consume heap for file content, but violates the "memory-only file handling" security principle (HAR files contain auth tokens). If using disk storage, ensure the temp directory has restricted permissions and files are deleted immediately after processing.

### Hybrid Approach

- < 50MB: `memoryStorage()` (current approach, secure)
- 50-200MB: `diskStorage()` with immediate cleanup + restricted temp directory
- > 200MB: Consider rejecting or requiring chunked upload

---

## Worker Threads for CPU-Intensive Parsing

For large files, JSON parsing blocks the event loop. Offload to a worker thread:

```typescript
import { Worker } from 'worker_threads';

function parseInWorker(filePath: string): Promise<HarData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./har-parse-worker.js', {
      workerData: { filePath },
    });
    worker.on('message', resolve);
    worker.on('error', reject);
  });
}
```

This isolates parsing to a separate V8 isolate with its own heap, preventing event loop blocking in the main thread.

**When to use**: Files > 20MB where parse time exceeds ~100ms. Below that, the worker overhead isn't worth it.

---

## Chunked Processing Strategies

### For LLM Token Limits

Even after streaming, if you're sending all entries to an LLM in one prompt, token limits apply. Strategies:

1. **Summarize first** (current approach): Stream-parse, filter, summarize to ~20 tokens/entry. At 50 entries, that's ~1,000 tokens — well within limits.

2. **Chunk and stitch**: For very large HAR files (500+ unique entries after dedup), split into batches of ~100, analyze each batch separately, then synthesize results.

3. **Two-pass pipeline**: First pass with cheap model narrows candidates, second pass with better model confirms. (See TOKEN-OPTIMIZATION-GUIDE.md)

### HAR Size Reduction Before LLM

What to drop:
- Response bodies (80-95% of total tokens)
- Standard boilerplate headers
- Timing details
- Connection info

What to keep:
- URL, method, status
- Auth-related headers
- Request body (for GraphQL operationName)
- Response MIME type and size

Result: A 50MB HAR can reduce to a ~500KB summary suitable for LLM context.

---

## Memory Profiling

### Tools

| Tool | What it does |
|------|-------------|
| `clinic doctor` | Profiles CPU, memory, event loop lag, I/O in one run |
| `clinic heapprofiler` | Continuous heap allocation samples — which code paths allocate most |
| V8 heap snapshots | `v8.writeHeapSnapshot()` or Chrome DevTools Memory tab |
| `heapdump` (npm) | Programmatic heap snapshots on demand (`kill -USR2 <pid>`) |

### Profiling HAR Processing

```typescript
const before = process.memoryUsage().heapUsed;
const result = await parseHar(buffer);
const after = process.memoryUsage().heapUsed;
logger.info({
  heapDelta: after - before,
  fileSize: buffer.length,
  entryCount: result.log.entries.length,
}, 'HAR parse memory usage');
```

Take heap snapshot before → process HAR → snapshot after → compare in Chrome DevTools to see what was allocated and retained.

---

## Recommendations for This Project

### Current State

- `memoryStorage()` with no file size limit configured
- `JSON.parse` on full buffer (synchronous, blocks event loop)
- No memory monitoring

### Implementation Plan

```
Phase 1: Add file size limit (immediate)
  - Configure Multer limit: 50MB
  - Return 413 with clear error message for oversized files

Phase 2: Memory monitoring (low effort)
  - Log heap usage before/after HAR parsing
  - Log file size and entry count per request
  - Alert if heap usage exceeds 80% of max

Phase 3: Streaming (if large files needed)
  - Switch to stream-json for files > 50MB
  - Consider diskStorage for large files with immediate cleanup
  - Worker thread for CPU isolation

Phase 4: Chunked LLM processing (if needed)
  - Only if regularly seeing 500+ unique entries after dedup
  - Implement batch analysis with result synthesis
```

### Quick Wins

1. **Set Multer file size limit** — prevents accidental OOM from huge uploads
2. **Log `process.memoryUsage().heapUsed`** before/after parse — visibility into memory pressure
3. **Set `--max-old-space-size=4096`** in production — give V8 more heap room for large files

## References

- [stream-json GitHub](https://github.com/uhop/stream-json)
- [Node.js Memory Limits](https://blog.appsignal.com/2021/12/08/nodejs-memory-limits-what-you-should-know.html)
- [Node.js Heap Snapshot Guide](https://nodejs.org/en/learn/diagnostics/memory/using-heap-snapshot)
- [Clinic.js](https://clinicjs.org/)
- [NestJS File Upload Docs](https://docs.nestjs.com/techniques/file-upload)
- [Handling Large JSON in Node.js](https://blog.faizahmed.in/streaming-huge-json-in-nodejs)
