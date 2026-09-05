import fs from 'fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { logger } from './logger';

// This project's own dev/CI sandbox has a Chromium binary preinstalled at
// this fixed path. When present, it's used exactly as before — this keeps
// local development and the existing test suite (which render real PDFs)
// completely unaffected by the fallback added below.
const SANDBOX_CHROMIUM_PATH = '/opt/pw-browsers/chromium';

interface ChromiumLaunchOptions {
  executablePath: string;
  args: string[];
}

/**
 * Resolves which Chromium binary + launch flags to use, in priority order:
 *
 * 1. `CHROMIUM_EXECUTABLE_PATH` env var — an explicit override, for a host
 *    that already has its own Chrome/Chromium install (e.g. a VPS with
 *    `apt install chromium` run on it).
 * 2. This project's dev/CI sandbox binary, when present — unchanged from
 *    before.
 * 3. `@sparticuz/chromium`'s bundled, serverless-friendly static binary —
 *    the fallback for a fresh host with neither of the above (e.g. a
 *    Render/Railway-style web service with no system Chromium installed).
 *    Only ever required in that fallback case, so it costs nothing on a
 *    host where (1) or (2) already applies.
 */
async function resolveLaunchOptions(): Promise<ChromiumLaunchOptions> {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    return {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
  }
  if (fs.existsSync(SANDBOX_CHROMIUM_PATH)) {
    return {
      executablePath: SANDBOX_CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chromium = require('@sparticuz/chromium') as typeof import('@sparticuz/chromium');
  return {
    executablePath: await chromium.executablePath(),
    args: chromium.args,
  };
}

let browserPromise: Promise<Browser> | null = null;

/**
 * Lazily launches (and reuses) a single headless Chromium instance, shared
 * by every PDF-rendering feature in the app (report cards, fee challans,
 * transfer certificates, ...) rather than one browser process per feature.
 *
 * `puppeteer-core` is pinned to its last CommonJS release (24.x — 25.x
 * switched to an ESM-only build) specifically so this can be a plain static
 * import. An earlier version of this file routed through a dynamic
 * `import()` to work around that ESM-only build, but that triggered a
 * recurring Jest failure ("You are trying to `import` a file after the
 * Jest environment has been torn down") whenever more than one test file
 * rendered a PDF in the same run — Node's dynamic-import referrer tracking
 * doesn't cleanly respect Jest's per-file module sandboxing. A static
 * import is resolved once at module-load time with no such referrer
 * ambiguity, which removes the whole failure class rather than papering
 * over it with retries.
 */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = resolveLaunchOptions()
      .then(({ executablePath, args }) =>
        puppeteer.launch({
          executablePath,
          headless: true,
          args,
        }),
      )
      .catch((err) => {
        browserPromise = null; // allow retry on next call instead of caching a rejected promise
        throw err;
      });
  }
  return browserPromise;
}

export interface RenderHtmlToPdfOptions {
  format?: 'A4' | 'Letter';
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  landscape?: boolean;
}

async function renderOnce(html: string, options: RenderHtmlToPdfOptions): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: options.format ?? 'A4',
      printBackground: true,
      margin: options.margin ?? { top: '20px', bottom: '20px' },
      landscape: options.landscape ?? false,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch((err) => logger.warn('Failed to close puppeteer page', { err }));
  }
}

/**
 * Renders an HTML string to a PDF buffer using the shared headless browser.
 * Retries once against a freshly-relaunched browser on failure — the
 * long-lived shared instance can occasionally drop (crashed renderer,
 * closed connection) — before giving up.
 */
export async function renderHtmlToPdf(html: string, options: RenderHtmlToPdfOptions = {}): Promise<Buffer> {
  try {
    return await renderOnce(html, options);
  } catch (err) {
    logger.warn('PDF render attempt 1/2 failed, retrying against a fresh browser', {
      err: (err as Error)?.message,
    });
    await closePdfBrowser();
    return renderOnce(html, options);
  }
}

/**
 * Launches the shared Chromium instance proactively at server startup
 * instead of waiting for the first PDF request to trigger it lazily.
 * Without this, whoever happens to print the first admission
 * form/attendance report/report card/challan/transfer certificate after
 * a deploy or restart eats the full launch cost synchronously on their
 * request — measured at ~2.2s locally, versus ~120-150ms once the
 * browser is already up. Fire-and-forget: never throws, never blocks
 * server startup — a failure here just means the first real PDF request
 * falls back to the normal lazy-launch path in getBrowser().
 */
export function warmUpPdfBrowser(): void {
  getBrowser().catch((err) => {
    logger.warn('PDF browser warm-up failed — will retry lazily on first PDF request', {
      err: (err as Error)?.message,
    });
  });
}

export async function closePdfBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close();
    browserPromise = null;
  }
}
