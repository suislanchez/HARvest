# Architecture Diagrams

> Visual reference for every pipeline, data flow, and architectural decision in the system.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Module Dependency Graph](#2-module-dependency-graph)
3. [HTTP Request Lifecycle](#3-http-request-lifecycle)
4. [HAR Analysis Pipeline (5 Steps)](#4-har-analysis-pipeline)
5. [7-Layer Filtering Pipeline](#5-7-layer-filtering-pipeline)
6. [Deduplication & Grouping Engine](#6-deduplication--grouping-engine)
7. [Token Optimization Funnel](#7-token-optimization-funnel)
8. [LLM Integration (Index-Return Pattern)](#8-llm-integration-index-return-pattern)
9. [Curl Generation & Execution Cycle](#9-curl-generation--execution-cycle)
10. [SSRF Protection Pipeline](#10-ssrf-protection-pipeline)
11. [Rate Limiting Architecture](#11-rate-limiting-architecture)
12. [Error Handling & Exception Filter](#12-error-handling--exception-filter)
13. [Frontend Component Architecture](#13-frontend-component-architecture)
14. [Security Threat Model](#14-security-threat-model)
15. [Test Pyramid](#15-test-pyramid)
16. [Data Transformation Pipeline](#16-data-transformation-pipeline)
17. [Caching Strategy (Future)](#17-caching-strategy)
18. [HAR Capture & Test Flow](#18-har-capture--test-flow)

---

## 1. System Architecture Overview

```mermaid
graph TB
    subgraph Browser["Browser (Client)"]
        UI["Next.js Frontend<br/>localhost:3000"]
        Proxy["API Proxy Route<br/>/api/proxy"]
    end

    subgraph Backend["NestJS Backend — localhost:3001"]
        Guard["ThrottlerGuard<br/>5 req/10s · 20 req/min"]
        Filter["AllExceptionsFilter"]
        Pipe["ValidationPipe"]

        subgraph AnalysisModule["Analysis Module"]
            Controller["AnalysisController<br/>POST /api/analyze"]
            Service["AnalysisService<br/>analyzeHar()"]
            Parser["HarParserService<br/>parse · filter · summarize"]
            CurlGen["HarToCurlService<br/>generate · parse curl"]
        end

        subgraph OpenAIModule["OpenAI Module"]
            OpenAI["OpenaiService<br/>identifyApiRequest()"]
        end
    end

    subgraph External["External Services"]
        GPT["OpenAI API<br/>gpt-4o-mini"]
        LiveAPI["Live Public APIs<br/>(curl execution targets)"]
    end

    UI -->|"multipart upload<br/>file + description"| Guard
    Guard --> Controller
    Controller --> Service
    Service --> Parser
    Service --> OpenAI
    Service --> CurlGen
    OpenAI -->|"HTTP"| GPT

    UI -->|"POST /api/proxy<br/>{curl: string}"| Proxy
    Proxy -->|"SSRF check → fetch"| LiveAPI

    Filter -.->|"catches exceptions"| Controller
    Pipe -.->|"validates DTO"| Controller

    style Browser fill:#e3f2fd,stroke:#1565c0
    style Backend fill:#f3e5f5,stroke:#7b1fa2
    style External fill:#fff3e0,stroke:#e65100
    style AnalysisModule fill:#e8f5e9,stroke:#2e7d32
    style OpenAIModule fill:#fce4ec,stroke:#c62828
```

---

## 2. Module Dependency Graph

```mermaid
graph LR
    subgraph Root
        AppModule
    end

    subgraph Global["Global Providers"]
        Config["ConfigModule<br/>(isGlobal: true)"]
        Throttler["ThrottlerModule<br/>short: 5/10s<br/>medium: 20/60s"]
        ThrottlerGuard["ThrottlerGuard<br/>(APP_GUARD)"]
    end

    subgraph Analysis["AnalysisModule"]
        AC["AnalysisController"]
        AS["AnalysisService"]
        HPS["HarParserService"]
        HTCS["HarToCurlService"]
    end

    subgraph OpenAI["OpenaiModule"]
        OAS["OpenaiService"]
    end

    subgraph Constants["Shared Constants"]
        SH["SKIP_HEADERS<br/>(37 headers)"]
        SD["SKIP_DOMAINS<br/>(71 domains)"]
        SE["SKIP_EXTENSIONS<br/>(regex pattern)"]
    end

    AppModule --> Config
    AppModule --> Throttler
    AppModule --> Analysis
    Throttler --> ThrottlerGuard

    Analysis --> OpenAI
    AC --> AS
    AS --> HPS
    AS --> OAS
    AS --> HTCS

    HTCS --> SH
    HPS --> SD
    HPS --> SE

    OAS --> Config

    style Root fill:#fff9c4,stroke:#f57f17
    style Global fill:#e0f7fa,stroke:#00838f
    style Analysis fill:#e8f5e9,stroke:#2e7d32
    style OpenAI fill:#fce4ec,stroke:#c62828
    style Constants fill:#f5f5f5,stroke:#616161
```

---

## 3. HTTP Request Lifecycle

```mermaid
sequenceDiagram
    participant U as User Browser
    participant F as Next.js Frontend
    participant G as ThrottlerGuard
    participant V as ValidationPipe
    participant C as AnalysisController
    participant S as AnalysisService
    participant P as HarParserService
    participant L as OpenaiService
    participant K as HarToCurlService
    participant O as OpenAI API

    U->>F: Upload .har + type description
    F->>G: POST /api/analyze (multipart)

    alt Rate limit exceeded
        G-->>F: 429 Too Many Requests
    end

    G->>V: Pass request
    V->>V: Validate DTO (description ≥ 5 chars)

    alt Validation fails
        V-->>F: 400 Bad Request
    end

    V->>C: FileInterceptor extracts file

    alt No file or wrong extension
        C-->>F: 400 Bad Request
    end

    C->>S: analyzeHar(buffer, description)
    S->>P: parseHar(buffer)
    P-->>S: Har object (all entries)

    S->>P: filterApiRequests(entries)
    P-->>S: filtered entries (~15% of total)

    alt No API requests after filtering
        S-->>C: Error: "No API requests found"
        C-->>F: 400 Bad Request
    end

    S->>P: generateLlmSummary(filtered, total)
    P-->>S: {summary: string, uniqueCount: number}

    S->>L: identifyApiRequest(summary, description)
    L->>O: chat.completions.create()
    O-->>L: JSON {topMatches, confidence}
    L-->>S: LlmMatchResult

    S->>K: generateCurl(matchedEntry)
    K-->>S: curl string

    S-->>C: AnalysisResult
    C-->>F: 201 Created (JSON)
    F-->>U: Display curl + stats + inspector
```

---

## 4. HAR Analysis Pipeline

```mermaid
graph TD
    Input["HAR File Buffer<br/>📄 (up to 50MB)"] --> Step1

    subgraph Step1["Step 1 — Parse"]
        Parse["JSON.parse(buffer)"]
        Validate["Validate log.entries exists"]
        Parse --> Validate
    end

    Step1 -->|"all entries"| Step2

    subgraph Step2["Step 2 — Filter"]
        F1["Remove data URIs"]
        F2["Remove failed requests (status 0)"]
        F3["Remove OPTIONS preflight"]
        F4["Remove redirects (301-308)"]
        F5["Remove static extensions (.js .css .png .woff2)"]
        F6["Remove tracking domains (71 domains)"]
        F7["Remove non-API MIME types"]
        F1 --> F2 --> F3 --> F4 --> F5 --> F6 --> F7
    end

    Step2 -->|"~15% survive"| Step3

    subgraph Step3["Step 3 — Summarize"]
        Dedup["Deduplicate<br/>method + parameterized path"]
        Group["Group by hostname"]
        Auth["Detect auth headers<br/>Bearer · API-Key · Cookie"]
        Preview["Add response preview<br/>(150 chars)"]
        Format["Generate compact text<br/>~20 tokens/entry"]
        Dedup --> Group --> Auth --> Preview --> Format
    end

    Step3 -->|"summary string"| Step4

    subgraph Step4["Step 4 — LLM Match"]
        Prompt["Build prompt:<br/>system + user description + summary"]
        Call["gpt-4o-mini<br/>temp: 0.1 · json_object"]
        Parse2["Parse topMatches<br/>validate indices"]
        Prompt --> Call --> Parse2
    end

    Step4 -->|"matchIndex"| Step5

    subgraph Step5["Step 5 — Curl Generation"]
        Entry["Get matched HAR entry"]
        Curl["Generate shell-safe curl<br/>single-quoted · --data-raw"]
        Entry --> Curl
    end

    Step5 --> Output["AnalysisResult<br/>curl + confidence + stats + allRequests"]

    style Step1 fill:#e3f2fd,stroke:#1565c0
    style Step2 fill:#ffebee,stroke:#c62828
    style Step3 fill:#e8f5e9,stroke:#2e7d32
    style Step4 fill:#fff3e0,stroke:#e65100
    style Step5 fill:#f3e5f5,stroke:#7b1fa2
```

---

## 5. 7-Layer Filtering Pipeline

```mermaid
graph LR
    In["All HAR Entries<br/>100%"] --> L1

    L1["Layer 1<br/>Data URIs &<br/>Empty URLs"] -->|"~99%"| L2
    L2["Layer 2<br/>Failed Requests<br/>status === 0"] -->|"~95%"| L3
    L3["Layer 3<br/>OPTIONS &<br/>Redirects<br/>301-308"] -->|"~85%"| L4
    L4["Layer 4<br/>Static Extensions<br/>.js .css .png<br/>.woff2 .svg .map"] -->|"~40%"| L5
    L5["Layer 5<br/>Tracking Domains<br/>71 blocked<br/>google-analytics<br/>facebook · hotjar"] -->|"~30%"| L6
    L6["Layer 6<br/>Non-API MIME<br/>text/html<br/>application/javascript<br/>image/* · font/*<br/>audio/* · video/*"] -->|"~18%"| L7
    L7["Layer 7<br/>Conservative Keep<br/>unknown types ✓<br/>4xx/5xx errors ✓<br/>octet-stream ✓"] --> Out

    Out["API Candidates<br/>~10-20%"]

    style In fill:#ffcdd2,stroke:#b71c1c
    style L1 fill:#ffcdd2,stroke:#c62828
    style L2 fill:#ffcdd2,stroke:#c62828
    style L3 fill:#ffe0b2,stroke:#e65100
    style L4 fill:#fff9c4,stroke:#f57f17
    style L5 fill:#dcedc8,stroke:#558b2f
    style L6 fill:#c8e6c9,stroke:#2e7d32
    style L7 fill:#b2dfdb,stroke:#00695c
    style Out fill:#e8f5e9,stroke:#1b5e20
```

### Filtering Examples (Real HAR Files)

```mermaid
graph LR
    subgraph SFGate["sfgate.har (5MB)"]
        S1["117 total"] --> S2["9 filtered"]
        S2 --> S3["9 unique"]
    end

    subgraph Jokes["jokes-real.har (1.7MB)"]
        J1["34 total"] --> J2["3 filtered"]
        J2 --> J3["3 unique"]
    end

    subgraph Large["jokes-large.har (91MB)"]
        L1_["1,727 total"] --> L2_["220 filtered"]
        L2_ --> L3_["~50 unique"]
    end

    style SFGate fill:#e8f5e9,stroke:#2e7d32
    style Jokes fill:#e3f2fd,stroke:#1565c0
    style Large fill:#fff3e0,stroke:#e65100
```

---

## 6. Deduplication & Grouping Engine

```mermaid
graph TD
    Input["Filtered Entries<br/>(e.g. 20 requests)"] --> Param

    subgraph Parameterize["Path Parameterization"]
        Param["Replace IDs with {id}"]
        Ex1["/users/123 → /users/{id}"]
        Ex2["/posts/550e8400-... → /posts/{id}"]
        Ex3["/api/v2/items/42/reviews → /api/v2/items/{id}/reviews"]
        Param --> Ex1
        Param --> Ex2
        Param --> Ex3
    end

    Parameterize --> GQL

    subgraph GraphQL["GraphQL Discrimination"]
        GQL["Check for /graphql endpoint"]
        GQL1["POST /graphql + body.operationName=GetUser<br/>→ POST /graphql:GetUser"]
        GQL2["POST /graphql + body.operationName=GetFeed<br/>→ POST /graphql:GetFeed"]
        GQL --> GQL1
        GQL --> GQL2
    end

    GraphQL --> DedupKey

    subgraph Dedup["Dedup Key = method + parameterized path"]
        DedupKey["Build dedup key"]
        Map["Map<key, {entries[], count}>"]
        Collapse["Collapse duplicates<br/>keep first, annotate (×N)"]
        DedupKey --> Map --> Collapse
    end

    Dedup --> Grouping

    subgraph Grouping["Hostname Grouping"]
        G1["Group entries by hostname"]
        G2["Detect shared auth per host<br/>Bearer *** · API-Key *** · Cookie"]
        G3["Format compact summary"]
        G1 --> G2 --> G3
    end

    Grouping --> Output

    Output["LLM Summary String<br/>~20 tokens per unique entry"]

    style Parameterize fill:#e3f2fd,stroke:#1565c0
    style GraphQL fill:#f3e5f5,stroke:#7b1fa2
    style Dedup fill:#fff3e0,stroke:#e65100
    style Grouping fill:#e8f5e9,stroke:#2e7d32
```

### Example Output

```
=== HAR Analysis: 5 unique API requests (12 total, duplicates collapsed) from 200 raw entries ===

[api.weather.com] (2 requests, Auth: Bearer ***)
  0. GET /v3/wx/forecast?geocode=37.77,-122.42 → 200 json (2.0KB)
     Preview: {"temperature":72,"humidity":65,"condition":"partly cloudy"...
  1. GET /v3/wx/conditions → 200 json (800B)  (×3)

[api.example.com] (3 requests, Auth: Bearer ***)
  2. POST /graphql:GetUser → 200 json body: {"operationName":"GetUser"...
  3. GET /api/v2/users/{id} → 200 json (4.5KB)  (×4)
  4. POST /graphql:GetFeed → 200 json body: {"operationName":"GetFeed"...
```

---

## 7. Token Optimization Funnel

```mermaid
graph TD
    Raw["🔴 Raw HAR Entries<br/>200 entries · ~40,000 tokens naive"]
    Raw -->|"7-layer filter"| Filtered

    Filtered["🟠 Filtered API Candidates<br/>~24 entries (88% removed)"]
    Filtered -->|"path parameterization<br/>+ dedup"| Deduped

    Deduped["🟡 Unique Entries<br/>~12 entries (50% collapsed)"]
    Deduped -->|"hostname grouping<br/>+ shared auth"| Grouped

    Grouped["🟢 Grouped Summary<br/>~8 groups · shared context"]
    Grouped -->|"compact format<br/>~20 tokens/entry"| Final

    Final["✅ LLM Input<br/>~160 tokens total<br/>Cost: ~$0.00002"]

    style Raw fill:#ffcdd2,stroke:#b71c1c
    style Filtered fill:#ffe0b2,stroke:#e65100
    style Deduped fill:#fff9c4,stroke:#f57f17
    style Grouped fill:#c8e6c9,stroke:#2e7d32
    style Final fill:#a5d6a7,stroke:#1b5e20
```

### Cost at Each Stage

| Stage | Entries | Tokens (est.) | Cost (gpt-4o-mini) |
|-------|---------|---------------|---------------------|
| Raw (naive) | 200 | ~40,000 | ~$0.006 |
| After filter | 24 | ~4,800 | ~$0.0007 |
| After dedup | 12 | ~2,400 | ~$0.0004 |
| After grouping | 12 | ~240 | ~$0.00004 |
| **Final (with format)** | **12** | **~160** | **~$0.00002** |

**Total savings: 99.6% token reduction**

---

## 8. LLM Integration (Index-Return Pattern)

```mermaid
graph TD
    subgraph Traditional["❌ Traditional: LLM Generates Curl"]
        T1["HAR data"] --> T2["LLM"]
        T2 --> T3["Generated curl string<br/>(may hallucinate URLs,<br/>headers, body)"]
    end

    subgraph Ours["✅ Our Approach: LLM Returns Index"]
        O1["Compact summary<br/>(~160 tokens)"] --> O2["LLM<br/>gpt-4o-mini"]
        O2 --> O3["JSON: {matchIndex: 3,<br/>confidence: 0.95}"]
        O3 --> O4["Original HAR entry[3]"]
        O4 --> O5["Deterministic<br/>curl generation"]
    end

    style Traditional fill:#ffebee,stroke:#c62828
    style Ours fill:#e8f5e9,stroke:#2e7d32
```

### LLM Prompt Structure

```mermaid
graph LR
    subgraph SystemPrompt["System Prompt (cached by OpenAI)"]
        S1["Role: API reverse-engineering expert"]
        S2["Instructions: match user description<br/>to numbered API entries"]
        S3["Focus: URL paths, query params,<br/>request body, response previews"]
        S4["Format: JSON {topMatches: [...]}"]
    end

    subgraph UserPrompt["User Prompt (per request)"]
        U1["User wants to find:<br/>'the weather forecast API'"]
        U2["--- grouped HAR summary ---"]
    end

    subgraph Response["LLM Response"]
        R1["temperature: 0.1<br/>response_format: json_object<br/>max_tokens: 500"]
        R2["{<br/>  topMatches: [<br/>    {index: 0, confidence: 0.95,<br/>     reason: 'weather forecast endpoint'},<br/>    {index: 3, confidence: 0.3,<br/>     reason: 'conditions endpoint'}<br/>  ]<br/>}"]
    end

    SystemPrompt --> Response
    UserPrompt --> Response

    style SystemPrompt fill:#e3f2fd,stroke:#1565c0
    style UserPrompt fill:#fff3e0,stroke:#e65100
    style Response fill:#e8f5e9,stroke:#2e7d32
```

---

## 9. Curl Generation & Execution Cycle

```mermaid
graph TD
    subgraph Generate["Backend: Curl Generation"]
        Entry["Matched HAR Entry"] --> URL["Single-quote URL<br/>'https://api.example.com/v1/data'"]
        Entry --> Method["Infer method<br/>skip -X for GET<br/>skip -X POST if body present"]
        Entry --> Headers["Filter headers<br/>remove 37 noise headers<br/>SKIP_HEADERS set"]
        Entry --> Cookies["Cookies → -b flag"]
        Entry --> Body["Body → --data-raw<br/>(prevents @ interpretation)"]
        Entry --> Compressed["--compressed flag"]

        URL --> Assemble["Assemble curl string<br/>multi-line with \\ continuation"]
        Method --> Assemble
        Headers --> Assemble
        Cookies --> Assemble
        Body --> Assemble
        Compressed --> Assemble
    end

    Assemble --> Display["Frontend displays curl"]
    Display --> Edit["User may edit curl"]
    Edit --> Execute

    subgraph Execute["Frontend: Curl Execution"]
        Parse["parseCurlToRequest()"]
        SSRF["SSRF validation<br/>(10-point check)"]
        Fetch["fetch(url, {method, headers, body})"]
        Response["Capture response<br/>status · headers · body · duration"]

        Parse --> SSRF --> Fetch --> Response
    end

    Response --> View["Display in ResponseViewer<br/>or ResponseDiff"]

    style Generate fill:#e8f5e9,stroke:#2e7d32
    style Execute fill:#e3f2fd,stroke:#1565c0
```

### Header Classification

```mermaid
graph LR
    subgraph Kept["✅ Kept in Curl"]
        K1["Authorization"]
        K2["Content-Type"]
        K3["Accept"]
        K4["X-Api-Key"]
        K5["X-Custom-*"]
        K6["Referer"]
    end

    subgraph Removed["❌ Removed (37 headers)"]
        R1[":authority · :method · :path · :scheme<br/>(HTTP/2 pseudo-headers)"]
        R2["Host · Connection · Content-Length<br/>(auto-managed by curl)"]
        R3["Accept-Encoding · Accept-Language<br/>(browser preferences)"]
        R4["Sec-Ch-Ua · Sec-Ch-Ua-Mobile<br/>Sec-Ch-Ua-Platform<br/>(client hints)"]
        R5["Sec-Fetch-Dest · Sec-Fetch-Mode<br/>Sec-Fetch-Site<br/>(fetch metadata)"]
        R6["Cache-Control · Pragma<br/>(caching directives)"]
    end

    style Kept fill:#e8f5e9,stroke:#2e7d32
    style Removed fill:#ffebee,stroke:#c62828
```

---

## 10. SSRF Protection Pipeline

```mermaid
graph TD
    Input["Incoming curl command"] --> Parse["Parse URL from curl"]

    Parse --> C1{"Valid URL?"}
    C1 -->|No| Block1["❌ 400 Bad Request"]
    C1 -->|Yes| C2{"HTTP or HTTPS<br/>protocol?"}

    C2 -->|No| Block2["❌ 403 Blocked<br/>(ftp://, file://, gopher://)"]
    C2 -->|Yes| C3{"Localhost?<br/>127.0.0.1 · localhost<br/>::1 · [::1] · 0.0.0.0"}

    C3 -->|Yes| Block3["❌ 403 Blocked"]
    C3 -->|No| C4{"Cloud metadata?<br/>169.254.169.254<br/>metadata.google.internal"}

    C4 -->|Yes| Block4["❌ 403 Blocked"]
    C4 -->|No| C5{"Private IP range?"}

    subgraph PrivateRanges["Private IP Ranges"]
        PR1["10.0.0.0/8"]
        PR2["172.16.0.0/12"]
        PR3["192.168.0.0/16"]
        PR4["169.254.0.0/16<br/>(link-local)"]
        PR5["0.0.0.0/8"]
    end

    C5 -->|Yes| Block5["❌ 403 Blocked"]
    C5 -->|No| C6{"IPv6 private?<br/>::ffff:127.0.0.1<br/>::ffff:10.x.x.x<br/>[::]"}

    C6 -->|Yes| Block6["❌ 403 Blocked"]
    C6 -->|No| C7{"IP obfuscation?<br/>Octal: 0177.0.0.1<br/>Hex: 0x7f000001<br/>Decimal: 2130706433"}

    C7 -->|Yes| Block7["❌ 403 Blocked"]
    C7 -->|No| Allow["✅ Execute fetch()<br/>30s timeout"]

    Allow --> Response["Return response<br/>status · headers · body · duration"]

    style Block1 fill:#ffcdd2,stroke:#b71c1c
    style Block2 fill:#ffcdd2,stroke:#b71c1c
    style Block3 fill:#ffcdd2,stroke:#b71c1c
    style Block4 fill:#ffcdd2,stroke:#b71c1c
    style Block5 fill:#ffcdd2,stroke:#b71c1c
    style Block6 fill:#ffcdd2,stroke:#b71c1c
    style Block7 fill:#ffcdd2,stroke:#b71c1c
    style Allow fill:#c8e6c9,stroke:#2e7d32
    style PrivateRanges fill:#fff3e0,stroke:#e65100
```

### Known Limitation: DNS Rebinding

```mermaid
sequenceDiagram
    participant App as Proxy Route
    participant DNS as DNS Server
    participant Attacker as Attacker DNS

    Note over App: TOCTOU vulnerability (documented)
    App->>DNS: Resolve evil.com
    DNS->>Attacker: Query evil.com
    Attacker-->>DNS: 203.0.113.1 (public IP) ✅
    DNS-->>App: 203.0.113.1
    App->>App: Validate IP → passes all checks

    Note over Attacker: Attacker changes DNS record

    App->>DNS: Connect to evil.com (2nd resolution)
    DNS->>Attacker: Query evil.com
    Attacker-->>DNS: 127.0.0.1 (localhost!) ⚠️
    DNS-->>App: 127.0.0.1
    App->>App: Connects to localhost 💀

    Note over App: Mitigation: resolve-then-connect<br/>(not yet implemented)
```

---

## 11. Rate Limiting Architecture

```mermaid
graph TD
    Request["Incoming Request"] --> Tier1

    subgraph Tier1["Tier 1 — Short Burst"]
        S1["Window: 10 seconds"]
        S2["Limit: 5 requests"]
        S3["Per: IP address"]
    end

    Tier1 -->|"passes"| Tier2

    subgraph Tier2["Tier 2 — Sustained Load"]
        M1["Window: 60 seconds"]
        M2["Limit: 20 requests"]
        M3["Per: IP address"]
    end

    Tier2 -->|"passes"| Process["Process Request"]

    Tier1 -->|"exceeded"| Reject["429 Too Many Requests<br/>Retry-After header"]
    Tier2 -->|"exceeded"| Reject

    style Tier1 fill:#fff3e0,stroke:#e65100
    style Tier2 fill:#e3f2fd,stroke:#1565c0
    style Reject fill:#ffcdd2,stroke:#b71c1c
    style Process fill:#c8e6c9,stroke:#2e7d32
```

### Window Boundary Burst Problem

```mermaid
gantt
    title Fixed Window Rate Limiting — Boundary Burst
    dateFormat X
    axisFormat %s

    section Window 1 (0-10s)
    5 requests at t=8-10s     :a1, 8, 10

    section Window 2 (10-20s)
    5 requests at t=10-12s    :a2, 10, 12

    section Actual Impact
    10 requests in 4 seconds! :crit, a3, 8, 12
```

> NestJS Throttler uses fixed windows. The burst at window boundaries means up to 2x the limit can occur in a short period. This is acceptable for our use case (API calls cost ~$0.001 each).

---

## 12. Error Handling & Exception Filter

```mermaid
graph TD
    Exception["Exception Thrown"] --> Type{"Exception Type?"}

    Type -->|HttpException| Http["Extract status + message<br/>from HttpException"]
    Type -->|BadRequestException| Bad["400 Bad Request<br/>(validation, parse errors)"]
    Type -->|Generic Error| Internal["500 Internal Server Error<br/>Log stack trace"]

    Http --> Format
    Bad --> Format
    Internal --> Format

    subgraph Format["AllExceptionsFilter"]
        F1["Build response body"]
        F2["{<br/>  statusCode: 400,<br/>  error: 'Bad Request',<br/>  message: 'Description must be...',<br/>  timestamp: '2026-02-25T...'<br/>}"]
        F1 --> F2
    end

    Format --> Response["Send HTTP Response"]

    style Format fill:#fff3e0,stroke:#e65100
```

### Error Taxonomy

```mermaid
graph TD
    Error["Error Occurs"] --> Class{"Classification"}

    Class -->|"Client Error"| Client
    Class -->|"Server Error"| Server

    subgraph Client["4xx — Client Errors"]
        C1["400 — No file uploaded"]
        C2["400 — Invalid JSON in HAR"]
        C3["400 — Description too short (< 5 chars)"]
        C4["400 — Wrong file extension"]
        C5["400 — No API requests after filtering"]
        C6["429 — Rate limit exceeded"]
    end

    subgraph Server["5xx — Server Errors"]
        S1["500 — OpenAI API error"]
        S2["500 — LLM returned no valid matches"]
        S3["500 — Unexpected parse failure"]
        S4["504 — Proxy timeout (30s)"]
    end

    style Client fill:#fff3e0,stroke:#e65100
    style Server fill:#ffebee,stroke:#c62828
```

---

## 13. Frontend Component Architecture

```mermaid
graph TD
    subgraph Page["page.tsx (Main)"]
        State["State: harData, result, error,<br/>isAnalyzing, pipelineStep,<br/>editedCurl, proxyResponse"]
    end

    subgraph Upload["Upload Phase"]
        FU["FileUpload<br/>drag & drop · click"]
        HI["HarInspector<br/>sortable table · filters"]
    end

    subgraph Analyze["Analysis Phase"]
        DI["DescriptionInput<br/>textarea · example chips"]
        PS["PipelineStats<br/>progress bars · timing"]
    end

    subgraph Results["Results Phase"]
        CO["CurlOutput<br/>editable · copy · execute"]
        RD["ResponseDiff<br/>HAR vs live side-by-side"]
        RV["ResponseViewer<br/>status · headers · body"]
    end

    subgraph Modals["Overlays"]
        TD_["TechDeepDive<br/>architecture info"]
        KS["KeyboardShortcuts<br/>? H I Esc"]
        CS["CollectionSidebar<br/>localStorage history"]
    end

    subgraph Shared["Shared UI"]
        TT["ThemeToggle<br/>dark/light mode"]
        HW["HowItWorks<br/>feature explainer"]
    end

    Page --> Upload
    Page --> Analyze
    Page --> Results
    Page --> Modals
    Page --> Shared

    FU -->|"harData"| HI
    DI -->|"POST /api/analyze"| PS
    PS -->|"result"| CO
    CO -->|"POST /api/proxy"| RV
    CO -->|"POST /api/proxy"| RD

    style Page fill:#e3f2fd,stroke:#1565c0
    style Upload fill:#e8f5e9,stroke:#2e7d32
    style Analyze fill:#fff3e0,stroke:#e65100
    style Results fill:#f3e5f5,stroke:#7b1fa2
    style Modals fill:#fce4ec,stroke:#c62828
    style Shared fill:#f5f5f5,stroke:#616161
```

### User Interaction Flow

```mermaid
stateDiagram-v2
    [*] --> Empty: Page load

    Empty --> FileLoaded: Upload .har file
    FileLoaded --> FileLoaded: Inspect HAR entries
    FileLoaded --> Analyzing: Type description + submit

    Analyzing --> Step1: Parse HAR
    Step1 --> Step2: Filter entries
    Step2 --> Step3: Summarize
    Step3 --> Step4: LLM matching
    Step4 --> ResultReady: Curl generated

    Analyzing --> Error: Pipeline failure
    Error --> FileLoaded: Try again

    ResultReady --> ResultReady: Copy curl
    ResultReady --> Editing: Edit curl
    Editing --> Executing: Execute
    ResultReady --> Executing: Execute (original)

    Executing --> ResponseView: Show response
    ResponseView --> ResultReady: Back to curl

    ResultReady --> Saved: Auto-save to collection
    Saved --> ResultReady: Restore from collection

    ResultReady --> FileLoaded: Upload new file
```

---

## 14. Security Threat Model

```mermaid
graph TD
    subgraph Threats["Threat Vectors"]
        T1["🔴 SSRF via curl execution<br/>Access internal services"]
        T2["🔴 Shell injection via curl<br/>Execute arbitrary commands"]
        T3["🟠 API key exposure<br/>Leak OpenAI key to client"]
        T4["🟠 Sensitive data in HAR<br/>Auth tokens, cookies, PII"]
        T5["🟡 Rate limit abuse<br/>DDoS or cost exhaustion"]
        T6["🟡 Large file DoS<br/>Memory exhaustion"]
        T7["🟡 XSS via response display<br/>Malicious API response content"]
    end

    subgraph Mitigations["Mitigations"]
        M1["10-point IP blocklist<br/>+ protocol validation<br/>+ 30s timeout"]
        M2["Single-quote shell escaping<br/>--data-raw (no @ interp)<br/>Deterministic generation"]
        M3["Key stays on backend<br/>never sent to frontend<br/>env-only config"]
        M4["Memory-only file handling<br/>files never written to disk<br/>buffer discarded after use"]
        M5["Two-tier throttle<br/>5/10s + 20/60s<br/>per-IP tracking"]
        M6["50MB upload limit<br/>Multer memory storage<br/>streaming for large files"]
        M7["React auto-escaping<br/>CSP headers<br/>Content-Type validation"]
    end

    T1 --> M1
    T2 --> M2
    T3 --> M3
    T4 --> M4
    T5 --> M5
    T6 --> M6
    T7 --> M7

    style Threats fill:#ffebee,stroke:#c62828
    style Mitigations fill:#e8f5e9,stroke:#2e7d32
```

---

## 15. Test Pyramid

```mermaid
graph TD
    subgraph Pyramid["Test Pyramid — 334 Tests"]
        L1["🔺 Stress Tests (12)<br/>Concurrent · Large files · Edge cases<br/>e2e-stress.spec.ts"]
        L2["🔺 HTTP E2E (10)<br/>Multipart upload through NestJS<br/>e2e-http.spec.ts"]
        L3["🔺 Pipeline E2E (15)<br/>Full analyzeHar() + curl execution<br/>e2e-pipeline.spec.ts"]
        L4["🔺 Live API E2E (57)<br/>Build HAR → LLM → execute curl<br/>e2e-live.spec.ts + e2e-live-expanded.spec.ts"]
        L5["🔺 Real-World Eval (5)<br/>Assignment HARs + execution<br/>eval-real-world.spec.ts"]
        L6["🔺 Synthetic Eval (63)<br/>10 categories · 4 difficulties<br/>eval.spec.ts"]
        L7["🔺 Unit Tests (192)<br/>Parser · Curl · Service · Controller · SSRF · Perf<br/>7 spec files"]
    end

    L1 --- L2
    L2 --- L3
    L3 --- L4
    L4 --- L5
    L5 --- L6
    L6 --- L7

    style L1 fill:#ffcdd2,stroke:#b71c1c
    style L2 fill:#ffe0b2,stroke:#e65100
    style L3 fill:#fff9c4,stroke:#f57f17
    style L4 fill:#dcedc8,stroke:#558b2f
    style L5 fill:#c8e6c9,stroke:#2e7d32
    style L6 fill:#b2dfdb,stroke:#00695c
    style L7 fill:#b3e5fc,stroke:#0277bd
```

### Test Coverage Across Pipeline Stages

```mermaid
graph LR
    subgraph Stage["Pipeline Stage"]
        P["Parse"] --> F["Filter"] --> D["Dedup"] --> S["Summarize"] --> L["LLM"] --> C["Curl Gen"] --> E["Execute"]
    end

    subgraph Coverage["Test Coverage"]
        P1["Unit: 48 tests<br/>har-parser.spec"] -.-> P
        P1 -.-> F
        P2["Unit: 35 tests<br/>har-to-curl.spec"] -.-> C
        P3["Unit: 8 tests<br/>analysis.service.spec"] -.-> P
        P3 -.-> F
        P3 -.-> D
        P3 -.-> S
        P4["Eval: 63 tests<br/>eval.spec"] -.-> L
        P5["Pipeline: 15 tests<br/>e2e-pipeline.spec"] -.-> P
        P5 -.-> F
        P5 -.-> D
        P5 -.-> S
        P5 -.-> L
        P5 -.-> C
        P5 -.-> E
        P6["HTTP: 10 tests<br/>e2e-http.spec"] -.-> P
        P6 -.-> E
        P7["Live: 57 tests<br/>e2e-live*.spec"] -.-> L
        P7 -.-> C
        P7 -.-> E
    end

    style Stage fill:#e3f2fd,stroke:#1565c0
    style Coverage fill:#f5f5f5,stroke:#9e9e9e
```

---

## 16. Data Transformation Pipeline

Traces a single HAR entry through every transformation stage:

```mermaid
graph TD
    subgraph Raw["1. Raw HAR Entry"]
        R1["request:<br/>  method: GET<br/>  url: https://api.weather.com/v3/wx/forecast?geocode=37.77,-122.42&format=json<br/>  headers: [Accept: application/json, Authorization: Bearer sk-abc123...,<br/>    Sec-Fetch-Mode: cors, :authority: api.weather.com, ...]<br/>  cookies: [session=xyz]<br/>response:<br/>  status: 200<br/>  content: {mimeType: application/json, size: 2048}<br/>  body: {temperature: 72, humidity: 65, ...}<br/>time: 245"]
    end

    Raw -->|"filterApiRequests()"| Filtered

    subgraph Filtered["2. Survives Filtering"]
        F1["✅ Not a static extension<br/>✅ Not a tracking domain<br/>✅ application/json MIME type<br/>✅ Status 200 (not redirect/failed)<br/>✅ Not OPTIONS preflight"]
    end

    Filtered -->|"parameterizePath()"| Parameterized

    subgraph Parameterized["3. Path Parameterized"]
        P1["URL stays same (no numeric IDs in path)<br/>Dedup key: GET /v3/wx/forecast"]
    end

    Parameterized -->|"generateLlmSummary()"| Summary

    subgraph Summary["4. LLM Summary Line"]
        S1["[api.weather.com] (1 request, Auth: Bearer ***)<br/>  0. GET /v3/wx/forecast?geocode=37.77,-122.42&format=json → 200 json (2.0KB)<br/>     Preview: {&quot;temperature&quot;:72,&quot;humidity&quot;:65,&quot;condition&quot;:&quot;partly cloudy&quot;..."]
    end

    Summary -->|"LLM returns index 0"| Matched

    subgraph Matched["5. LLM Match"]
        M1["matchIndex: 0<br/>confidence: 0.95<br/>reason: 'Weather forecast endpoint with geocode parameters'"]
    end

    Matched -->|"generateCurl()"| Curl

    subgraph Curl["6. Generated Curl"]
        C1["curl 'https://api.weather.com/v3/wx/forecast?geocode=37.77,-122.42&format=json' \<br/>  -H 'Accept: application/json' \<br/>  -H 'Authorization: Bearer sk-abc123...' \<br/>  -b 'session=xyz' \<br/>  --compressed"]
    end

    Curl -->|"execute via proxy"| Executed

    subgraph Executed["7. Live Execution"]
        E1["HTTP 200 OK<br/>{temperature: 68, humidity: 71, condition: 'sunny'}<br/>Duration: 312ms"]
    end

    style Raw fill:#ffebee,stroke:#c62828
    style Filtered fill:#fff3e0,stroke:#e65100
    style Parameterized fill:#fff9c4,stroke:#f57f17
    style Summary fill:#e8f5e9,stroke:#2e7d32
    style Matched fill:#e3f2fd,stroke:#1565c0
    style Curl fill:#f3e5f5,stroke:#7b1fa2
    style Executed fill:#e0f2f1,stroke:#00695c
```

---

## 17. Caching Strategy

> Not yet implemented — documented as future architecture.

```mermaid
graph TD
    Request["analyzeHar(buffer, description)"] --> L1

    subgraph L1["Layer 1: Exact Match Cache"]
        Hash["SHA-256(harHash + description + model)"]
        Lookup["In-memory Map lookup"]
        Hash --> Lookup
    end

    L1 -->|"HIT"| Return["Return cached result<br/>(skip all processing)"]
    L1 -->|"MISS"| L2

    subgraph L2["Layer 2: Semantic Cache (future)"]
        Embed["Embed description → vector"]
        Cosine["Cosine similarity search<br/>threshold: 0.95"]
        Embed --> Cosine
    end

    L2 -->|"HIT"| Return
    L2 -->|"MISS"| L3

    subgraph L3["Layer 3: OpenAI Prompt Cache"]
        Prefix["System prompt (identical across requests)<br/>→ cached by OpenAI automatically"]
        Note["50% discount on cached input tokens<br/>128-token chunk granularity"]
        Prefix --> Note
    end

    L3 --> LLM["Full LLM call<br/>gpt-4o-mini"]
    LLM --> Store["Store result in L1 cache<br/>TTL: 1 hour"]
    Store --> Return

    style L1 fill:#e8f5e9,stroke:#2e7d32
    style L2 fill:#e3f2fd,stroke:#1565c0
    style L3 fill:#fff3e0,stroke:#e65100
```

---

## 18. HAR Capture & Test Flow

```mermaid
graph TD
    subgraph Capture["Playwright HAR Capture"]
        Sites["6 Target Sites<br/>Open-Meteo · USGS · PokeAPI<br/>HN · Dog CEO · JSONPlaceholder"]
        Browser["chromium.launch({headless: true})"]
        Record["context.recordHar({path, mode: 'full'})"]
        Navigate["page.goto(url, {waitUntil: 'networkidle'})"]
        Interact["Custom interactions<br/>(click buttons, fetch APIs)"]
        Close["context.close() → flush HAR"]
        Sites --> Browser --> Record --> Navigate --> Interact --> Close
    end

    Close --> Files["test-fixtures/captured/*.har<br/>(gitignored)"]

    subgraph Pipeline["Pipeline Tests (e2e-pipeline.spec.ts)"]
        Read["Read .har as Buffer"]
        Analyze["service.analyzeHar(buffer, description)"]
        Assert["Assert: correct URL, method, confidence"]
        Execute["Execute curl via fetch()"]
        Verify["Verify: HTTP 200, expected body shape"]
        Read --> Analyze --> Assert --> Execute --> Verify
    end

    subgraph HTTP["HTTP Tests (e2e-http.spec.ts)"]
        Upload["supertest: POST /api/analyze<br/>.attach('file', harPath)<br/>.field('description', '...')"]
        Check["Assert 201 + response shape"]
        Exec2["Execute returned curl"]
        Upload --> Check --> Exec2
    end

    subgraph Stress["Stress Tests (e2e-stress.spec.ts)"]
        Concurrent["5 parallel analyzeHar() calls"]
        Large["87MB HAR file"]
        Rapid["5 rapid sequential uploads"]
        Edge["Edge: empty, static-only, unicode"]
        Consistent["3x same input → same output"]
    end

    Files --> Pipeline
    Files --> HTTP
    Files --> Stress

    style Capture fill:#e3f2fd,stroke:#1565c0
    style Pipeline fill:#e8f5e9,stroke:#2e7d32
    style HTTP fill:#fff3e0,stroke:#e65100
    style Stress fill:#f3e5f5,stroke:#7b1fa2
```
