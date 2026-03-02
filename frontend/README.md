# HARvest Frontend

Next.js 16 web application for HARvest API Reverse Engineer.

## Quick Start

```bash
npm install
npm run dev     # http://localhost:3000
```

Requires the backend running at `http://localhost:3001`.

## Features

- HAR file upload (drag & drop or file picker)
- Auto-capture from URL
- HAR inspector table (sortable, filterable)
- AI-powered API matching with confidence scores
- Editable curl output with multi-language export
- In-browser curl execution via SSRF-protected proxy
- Response diff viewer (original HAR vs. live response)
- Analysis cancellation with timeout protection (90s analysis, 30s execution)
- Collection history sidebar
- Dark/light theme
- Keyboard shortcuts (?, H, I, Cmd+Enter)

## Tech Stack

- Next.js 16, React 19, TypeScript 5
- Tailwind CSS 4, shadcn/ui, Radix UI
- TanStack React Table 8

## Project Structure

```
src/
├── app/
│   ├── page.tsx          Main page (upload → inspect → analyze → results)
│   ├── layout.tsx        Root layout with theme provider
│   ├── globals.css       Global styles
│   └── api/proxy/        SSRF-protected curl execution proxy
├── components/           UI components (file-upload, har-inspector, curl-output, etc.)
├── hooks/                Custom hooks (use-har-data)
└── lib/                  Utilities (har-utils, collection storage)
```
