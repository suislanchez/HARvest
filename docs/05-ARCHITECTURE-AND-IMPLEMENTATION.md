# 5. Architecture & Implementation Plan

## System Architecture

```
┌─────────────────────────────────────────────────┐
│                  FRONTEND (Next.js)              │
│                                                  │
│  ┌──────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │  Upload   │ │  HAR         │ │  Result      │ │
│  │  Zone     │ │  Inspector   │ │  Panel       │ │
│  │(dropzone) │ │ (data table) │ │ (curl + run) │ │
│  └────┬─────┘ └──────────────┘ └──────┬───────┘ │
│       │                               │         │
│  ┌────┴───────────────────────────────┴───────┐ │
│  │          Next.js API Route /api/proxy       │ │
│  │          (CORS proxy for curl execution)    │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │ POST /analyze (file + description)
                   ▼
┌─────────────────────────────────────────────────┐
│                BACKEND (NestJS)                  │
│                                                  │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ Upload       │  │ Analysis Module          │  │
│  │ Controller   │──│                          │  │
│  │ (Multer)     │  │  ┌───────────────────┐   │  │
│  └──────────────┘  │  │ 1. Parse HAR      │   │  │
│                    │  │ 2. Pre-filter      │   │  │
│                    │  │ 3. Summarize       │   │  │
│                    │  │ 4. LLM Pass 1      │──│──│── GPT-4.1-nano
│                    │  │ 5. LLM Pass 2      │──│──│── GPT-4.1-mini
│                    │  │ 6. Generate curl   │   │  │
│                    │  └───────────────────┘   │  │
│                    └─────────────────────────┘  │
│                                                  │
│  ┌──────────────┐                               │
│  │ OpenAI       │ ← wraps OpenAI SDK            │
│  │ Module       │                               │
│  └──────────────┘                               │
└─────────────────────────────────────────────────┘
```

## NestJS Backend Structure

```
backend/
├── src/
│   ├── modules/
│   │   ├── upload/
│   │   │   ├── upload.controller.ts    ← POST /upload-har (Multer FileInterceptor)
│   │   │   ├── upload.module.ts
│   │   │   └── dto/
│   │   │       └── analyze-har.dto.ts  ← { description: string }
│   │   ├── analysis/
│   │   │   ├── analysis.service.ts     ← Core logic: parse → filter → LLM → curl
│   │   │   ├── analysis.module.ts
│   │   │   ├── har-parser.service.ts   ← Parse + pre-filter HAR entries
│   │   │   ├── har-to-curl.service.ts  ← Convert HAR entry → curl string
│   │   │   └── interfaces/
│   │   │       └── har-entry.interface.ts
│   │   └── openai/
│   │       ├── openai.service.ts       ← OpenAI SDK wrapper
│   │       └── openai.module.ts
│   ├── common/
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   └── constants/
│   │       ├── skip-domains.ts         ← Analytics/tracking domain list
│   │       ├── skip-headers.ts         ← Headers to exclude from curl
│   │       └── api-mime-types.ts       ← MIME types that indicate APIs
│   ├── app.module.ts
│   └── main.ts
├── .env                                ← OPENAI_API_KEY
├── package.json
└── tsconfig.json
```

## Next.js Frontend Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── page.tsx                    ← Main page layout
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   └── api/
│   │       └── proxy/
│   │           └── route.ts            ← CORS proxy for executing curl
│   ├── components/
│   │   ├── file-upload.tsx             ← Drag & drop (react-dropzone + Card)
│   │   ├── har-inspector.tsx           ← Data table of requests (TanStack Table)
│   │   ├── description-input.tsx       ← Textarea for user description
│   │   ├── curl-output.tsx             ← Code block with copy button
│   │   ├── response-viewer.tsx         ← Tabs: Body | Headers (after execution)
│   │   └── analyze-button.tsx          ← Submit button with loading state
│   ├── hooks/
│   │   ├── use-har-parser.ts           ← Client-side HAR parsing for inspector
│   │   └── use-api-executor.ts         ← Execute curl via proxy
│   ├── lib/
│   │   ├── utils.ts                    ← shadcn cn() utility
│   │   └── api.ts                      ← Fetch wrapper for backend calls
│   └── components/ui/                  ← shadcn/ui components
│       ├── button.tsx
│       ├── card.tsx
│       ├── table.tsx
│       ├── tabs.tsx
│       ├── textarea.tsx
│       ├── badge.tsx
│       └── label.tsx
├── package.json
├── tailwind.config.ts
├── next.config.js
└── tsconfig.json
```

## API Contract

### POST /api/analyze
```typescript
// Request (multipart/form-data)
{
  file: File,           // .har file
  description: string   // "Return the API that fetches weather for SF"
}

// Response
{
  curl: string,              // The generated curl command
  matchedRequest: {
    method: string,
    url: string,
    status: number,
    contentType: string,
  },
  confidence: number,        // 0-1
  reason: string,            // Why this request was selected
  totalRequests: number,     // Total entries in HAR
  filteredRequests: number,  // After pre-filtering
}
```

### POST /api/proxy (Next.js route)
```typescript
// Request
{
  url: string,
  method: string,
  headers?: Record<string, string>,
  body?: string
}

// Response
{
  status: number,
  statusText: string,
  headers: Record<string, string>,
  body: unknown,
  duration: string
}
```

## Data Flow (Step by Step)

```
1. User drops .har file
   → Client parses JSON, populates inspector table
   → File stored in state (not uploaded yet)

2. User types description: "Get me the weather API for San Francisco"

3. User clicks "Analyze"
   → POST /api/analyze (file + description) to NestJS backend

4. Backend: Parse HAR
   → JSON.parse(file.buffer.toString())
   → Validate: has log.entries[]

5. Backend: Pre-filter
   → Remove static assets (by extension)
   → Remove tracking domains
   → Remove non-API MIME types
   → Remove OPTIONS, status 0, redirects
   → 200 entries → ~15 candidates

6. Backend: Summarize
   → Each candidate → "1. GET /api/weather?city=SF → application/json 200"

7. Backend: LLM Pass 1 (GPT-4.1-nano)
   → Send summaries + user description
   → Receive: { match_index: 3, confidence: 0.92 }
   → If confidence > 0.8 and only 1 match: skip Pass 2

8. Backend: LLM Pass 2 (GPT-4.1-mini) [if needed]
   → Send full stripped entries for top 3 candidates
   → Confirm best match

9. Backend: Generate curl
   → harEntryToCurl(entries[matchIndex])
   → Return curl string + metadata

10. Frontend: Display curl in CodeBlock with copy button

11. User clicks "Execute"
    → Parse curl back into { url, method, headers, body }
    → POST /api/proxy (Next.js route)
    → Display response in ResponseViewer
```

## Key Dependencies

### Backend (NestJS)
```json
{
  "@nestjs/common": "^10",
  "@nestjs/core": "^10",
  "@nestjs/platform-express": "^10",
  "@nestjs/config": "^3",
  "openai": "^4",
  "class-validator": "^0.14",
  "class-transformer": "^0.5",
  "@types/multer": "^1",
  "@types/har-format": "^1"
}
```

### Frontend (Next.js)
```json
{
  "next": "^14",
  "react": "^18",
  "tailwindcss": "^3",
  "react-dropzone": "^14",
  "@tanstack/react-table": "^8",
  "zod": "^3",
  "lucide-react": "^0.300"
}
```

## UI Layout (rough wireframe)

```
┌────────────────────────────────────────────────────┐
│  HAR Reverse Engineer                              │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │  📂 Drop your .har file here, or click      │  │
│  │     to browse                                │  │
│  │     Supports .har files                      │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ Method │ URL             │ Status │ Type     │  │
│  │ GET    │ /api/weather... │ 200    │ json     │  │
│  │ POST   │ /api/auth/lo...│ 200    │ json     │  │
│  │ GET    │ /static/bund...│ 200    │ js       │  │
│  │ ...    │ ...             │ ...    │ ...      │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ Describe the API you want to reverse-engineer│  │
│  │ ┌────────────────────────────────────────┐   │  │
│  │ │ Return the API that fetches the       │   │  │
│  │ │ weather of San Francisco               │   │  │
│  │ └────────────────────────────────────────┘   │  │
│  │                           [🔍 Analyze]       │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ curl                                  [Copy] │  │
│  │ ┌────────────────────────────────────────┐   │  │
│  │ │ curl 'https://api.weather.com/...' \  │   │  │
│  │ │   -H 'Accept: application/json' \     │   │  │
│  │ │   --compressed                        │   │  │
│  │ └────────────────────────────────────────┘   │  │
│  │                           [▶ Execute]        │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ Response  [Body] [Headers]        200 OK 45ms│  │
│  │ ┌────────────────────────────────────────┐   │  │
│  │ │ {                                     │   │  │
│  │ │   "temperature": 65,                  │   │  │
│  │ │   "humidity": 40,                     │   │  │
│  │ │   "conditions": "Partly Cloudy"       │   │  │
│  │ │ }                                     │   │  │
│  │ └────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

## Bonus Features to Consider

1. **Request detail panel**: Click a row in inspector → see full headers, body, response
2. **Multiple match suggestions**: Show top 3 matches with confidence scores
3. **Export options**: Copy as curl, Python requests, JavaScript fetch, etc.
4. **HAR diff**: Compare two HAR files to find unique API calls
5. **History**: Save previous analyses
6. **Syntax highlighting**: Proper curl syntax highlighting in code block
7. **Dark mode**: shadcn/ui supports it out of the box
8. **Request/response size indicators**: Visual bars showing relative sizes
