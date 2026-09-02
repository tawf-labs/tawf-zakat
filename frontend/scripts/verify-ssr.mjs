// Regression check for the Vercel SSR 500 crash: static/eager imports of
// browser-only packages (connectkit -> @aave/account touching `window`,
// walletConnect() eagerly touching `localStorage`) crash Node during SSR.
// Run after `VERCEL=1 vite build` to exercise the built Vercel function
// handler directly (no server process / network needed).
import { pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const handlerPath = path.join(here, "..", ".vercel/output/functions/__server.func/index.mjs");

const routes = ["/", "/donasi", "/verifikasi", "/tata-kelola", "/about"];

const { default: handler } = await import(pathToFileURL(handlerPath).href);

let failed = false;
for (const route of routes) {
  try {
    const res = await handler.fetch(new Request(`http://localhost${route}`), {});
    if (res.status >= 500) {
      failed = true;
      console.error(`FAIL ${route}: HTTP ${res.status}`);
    } else {
      console.log(`ok   ${route}: HTTP ${res.status}`);
    }
  } catch (err) {
    failed = true;
    console.error(`FAIL ${route}: threw`, err);
  }
}

if (failed) {
  console.error("\nSSR verification failed.");
  process.exit(1);
}

console.log("\nSSR verification passed.");
process.exit(0);
