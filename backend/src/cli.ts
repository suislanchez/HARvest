#!/usr/bin/env node

/**
 * HARvest API Reverse Engineer — CLI
 *
 * Identify API requests from HAR files using LLMs.
 *
 * Usage:
 *   npx harvest-api <har-file> --description "the login API" [--provider local|groq|openai] [--model ...] [--json] [--top N]
 *
 * Examples:
 *   npx harvest-api capture.har --description "the weather forecast API"
 *   npx harvest-api capture.har -d "shopping cart" --provider local --model qwen2.5:7b
 *   npx harvest-api capture.har -d "login endpoint" --json --top 3
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { HarParserService } from './modules/analysis/har-parser.service';
import { HarToCurlService } from './modules/analysis/har-to-curl.service';
import { OpenaiService } from './modules/openai/openai.service';
import { GroqService } from './modules/groq/groq.service';
import { LocalLlmService } from './modules/local-llm/local-llm.service';
import type { LlmProvider } from './modules/llm/llm-provider.interface';

// Load .env files
function loadEnv(): void {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnv();

// Global abort controller for clean shutdown
const cliAbort = new AbortController();

function handleSignal(signal: string): void {
  process.stderr.write(`\nReceived ${signal}, aborting...\n`);
  cliAbort.abort();
  // Give pending operations a moment to clean up
  setTimeout(() => process.exit(1), 500);
}

process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

const program = new Command();

program
  .name('harvest-api')
  .description('HARvest — Reverse engineer any API from browser network traces')
  .version('1.0.0')
  .argument('<har-file>', 'Path to the HAR file to analyze')
  .requiredOption('-d, --description <text>', 'Description of the API to find')
  .option('-p, --provider <provider>', 'LLM provider: local, groq, or openai', process.env.LLM_PROVIDER || 'groq')
  .option('-m, --model <model>', 'Model name (overrides provider default)')
  .option('--json', 'Output full result as JSON')
  .option('-t, --top <n>', 'Number of top matches to show', '3')
  .action(async (harFile: string, opts: { description: string; provider: string; model?: string; json?: boolean; top: string }) => {
    const harPath = path.resolve(harFile);

    if (!fs.existsSync(harPath)) {
      process.stderr.write(`Error: File not found: ${harPath}\n`);
      process.exit(1);
    }

    // Build a fake ConfigService from env + CLI flags
    const envOverrides: Record<string, string> = {};
    if (opts.model) {
      if (opts.provider === 'local') envOverrides['LOCAL_LLM_MODEL'] = opts.model;
      else if (opts.provider === 'openai') envOverrides['OPENAI_MODEL'] = opts.model;
      else if (opts.provider === 'groq') envOverrides['GROQ_MODEL'] = opts.model;
    }

    const configService = {
      get: (key: string) => envOverrides[key] || process.env[key],
    } as unknown as ConfigService;

    // Instantiate services
    const harParser = new HarParserService();
    const harToCurl = new HarToCurlService();

    let llm: LlmProvider;
    try {
      switch (opts.provider.toLowerCase()) {
        case 'local':
          llm = new LocalLlmService(configService);
          break;
        case 'openai':
          llm = new OpenaiService(configService);
          break;
        case 'groq':
        default:
          llm = new GroqService(configService);
          break;
      }
    } catch (e) {
      process.stderr.write(`Error initializing ${opts.provider} provider: ${(e as Error).message}\n`);
      process.exit(1);
    }

    try {
      const totalStart = performance.now();

      // Parse & filter
      const fileBuffer = fs.readFileSync(harPath);
      const har = harParser.parseHar(fileBuffer as unknown as Buffer);
      const allEntries = har.log.entries;
      const filtered = harParser.filterApiRequests(allEntries);

      if (filtered.length === 0) {
        process.stderr.write('Error: No API requests found after filtering.\n');
        process.exit(1);
      }

      const { summary: llmSummary, uniqueCount } = harParser.generateLlmSummary(filtered, allEntries.length);

      // LLM match with 60s timeout
      process.stderr.write(`Analyzing ${filtered.length} requests (${uniqueCount} unique) with ${opts.provider}...\n`);
      const llmTimeout = setTimeout(() => {
        if (!cliAbort.signal.aborted) {
          process.stderr.write('LLM call timed out after 60s\n');
          cliAbort.abort();
        }
      }, 60_000);
      let llmResult;
      try {
        llmResult = await llm.identifyApiRequest(llmSummary, opts.description, filtered.length, cliAbort.signal);
      } finally {
        clearTimeout(llmTimeout);
      }

      const matchedEntry = filtered[llmResult.matchIndex];
      const curl = harToCurl.generateCurl(matchedEntry);
      const totalEnd = performance.now();

      // Build top matches with curl
      const topN = Math.min(parseInt(opts.top, 10) || 3, llmResult.topMatches.length);
      const topMatches = llmResult.topMatches.slice(0, topN).map((m) => {
        const entry = filtered[m.index];
        return {
          index: m.index,
          confidence: m.confidence,
          reason: m.reason,
          method: entry?.request.method || 'UNKNOWN',
          url: entry?.request.url || 'UNKNOWN',
          curl: entry ? harToCurl.generateCurl(entry) : '',
        };
      });

      if (opts.json) {
        // JSON output to stdout
        const output = {
          curl,
          matchedRequest: {
            method: matchedEntry.request.method,
            url: matchedEntry.request.url,
            status: matchedEntry.response.status,
          },
          confidence: llmResult.confidence,
          reason: llmResult.reason,
          topMatches,
          stats: {
            totalRequests: allEntries.length,
            filteredRequests: filtered.length,
            uniqueRequests: uniqueCount,
            processingTime: Math.round(totalEnd - totalStart),
            provider: opts.provider,
            model: opts.model || 'default',
          },
        };
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      } else {
        // Human-readable output
        process.stderr.write(`\nMatch: ${matchedEntry.request.method} ${matchedEntry.request.url}\n`);
        process.stderr.write(`Confidence: ${Math.round(llmResult.confidence * 100)}%\n`);
        process.stderr.write(`Reason: ${llmResult.reason}\n`);
        process.stderr.write(`Time: ${Math.round(totalEnd - totalStart)}ms\n`);

        if (topMatches.length > 1) {
          process.stderr.write('\nOther matches:\n');
          for (const m of topMatches.slice(1)) {
            process.stderr.write(`  ${Math.round(m.confidence * 100)}% ${m.method} ${m.url}\n`);
          }
        }

        process.stderr.write('\n');
        // curl to stdout for piping
        process.stdout.write(curl + '\n');
      }
    } catch (e) {
      process.stderr.write(`Error: ${(e as Error).message}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
