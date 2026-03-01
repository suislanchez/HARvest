import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  async captureHar(
    url: string,
    onProgress: (step: string, message: string) => void,
  ): Promise<string> {
    let browser: any = null;
    let harPath: string | null = null;

    try {
      // Dynamic import — playwright may not be installed
      let pw: typeof import('playwright');
      try {
        pw = await import('playwright');
      } catch {
        throw new Error(
          'Playwright is not installed. Run: npx playwright install chromium',
        );
      }

      onProgress('launching', 'Launching browser...');
      browser = await pw.chromium.launch({ headless: true });

      // Create a temp file path for HAR recording
      harPath = path.join(
        os.tmpdir(),
        `auto-capture-${Date.now()}.har`,
      );

      const context = await browser.newContext({
        recordHar: { path: harPath, mode: 'full' },
      });

      const page = await context.newPage();

      onProgress('navigating', `Navigating to ${url}...`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });

      onProgress('recording', 'Recording network traffic...');
      // Wait for additional API calls to fire after page load
      await page.waitForTimeout(3000);

      onProgress('processing', 'Processing HAR file...');
      // Close context to flush HAR to disk
      await context.close();

      // Read the HAR file
      const harContent = fs.readFileSync(harPath, 'utf-8');

      // Validate that we got entries
      const parsed = JSON.parse(harContent);
      if (!parsed?.log?.entries?.length) {
        throw new Error(
          'No network traffic captured — try a different URL',
        );
      }

      this.logger.log(
        `Captured ${parsed.log.entries.length} entries from ${url}`,
      );

      return harContent;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // Ignore cleanup errors
        }
      }
      if (harPath) {
        try {
          fs.unlinkSync(harPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}
