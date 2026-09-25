// Shared settings for the chain suites. Playwright is not a repo dependency:
// point PLAYWRIGHT_MODULE at an installed copy (e.g. a global install).
import { mkdirSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

export { chromium };
export const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3102";
export const WORK = process.env.E2E_WORK ?? "/tmp/smartmirror-e2e";
export const OUT = `${WORK}/shots/`;
mkdirSync(OUT, { recursive: true });
