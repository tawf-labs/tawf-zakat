import { expect, it } from "bun:test";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// Controlled panels isolate navigation, retained drafts and session boundaries.
// Real API capability enforcement remains covered by workspace access/controller tests.
it.skipIf(!process.env.REGISTRY_BROWSER_EXECUTABLE && !Bun.which("chromium"))("workspace sidebar is responsive, retains drafts, and clears private UI at access boundaries", async () => {
  const build = await Bun.build({ entrypoints: [new URL("./workspace-shell-smoke.tsx", import.meta.url).pathname], target: "browser" });
  if (!build.success) throw new Error(build.logs.join("\n"));
  const bundle = await build.outputs[0]!.text();
  const cssBuild = Bun.spawn(["bun", new URL("./build-smoke-css.ts", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
  const css = await new Response(cssBuild.stdout).text();
  if (await cssBuild.exited !== 0) throw new Error(await new Response(cssBuild.stderr).text());
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "text/javascript" } });
    if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
    return new Response('<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/smoke.css"></head><body><div id="root"></div><script type="module" src="/smoke.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  } });
  const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE || Bun.which("chromium") || undefined, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { (window as any).mountedPanels = []; window.addEventListener("panel-mounted", (event: any) => (window as any).mountedPanels.push(event.detail)); });
    await page.goto(server.url.toString());
    await page.getByRole("heading", { name: "Ringkasan", exact: true }).waitFor();
    expect(await page.evaluate(() => (window as any).mountedPanels)).toEqual(["overview"]);
    await page.getByRole("button", { name: "Kontribusi", exact: true }).click();
    await page.getByLabel("Draf contributions").fill("Draf yang belum disimpan");
    await page.getByRole("button", { name: "Kegiatan", exact: true }).click();
    expect(await page.getByLabel("Draf contributions").isVisible()).toBe(false);
    expect(await page.getByLabel("Draf contributions").evaluate(element => element.closest("[inert]") !== null)).toBe(true);
    await page.getByRole("button", { name: "Alokasi tersimpan", exact: true }).click();
    expect(await page.getByRole("region", { name: "Kegiatan", exact: true }).innerText()).toContain("Revisi alokasi: 1");
    await page.getByRole("button", { name: "Kontribusi", exact: true }).click();
    expect(await page.getByLabel("Draf contributions").inputValue()).toBe("Draf yang belum disimpan");
    expect(await page.evaluate(() => (window as any).mountedPanels.filter((id: string) => id === "contributions").length)).toBe(1);

    await page.getByRole("button", { name: "Ganti sesi", exact: true }).click();
    await page.getByRole("heading", { name: "Ringkasan", exact: true }).waitFor();
    await page.getByRole("button", { name: "Kontribusi", exact: true }).click();
    expect(await page.getByLabel("Draf contributions").inputValue()).toBe("");
    await page.getByLabel("Draf contributions").fill("Privat admin");
    await page.getByRole("button", { name: "Ganti peran", exact: true }).click();
    await page.getByRole("heading", { name: "Ringkasan", exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Petugas & akses", exact: true }).count()).toBe(0);
    expect(await page.getByLabel("Bagian ruang kerja").locator('option[value="members"]').count()).toBe(0);
    await page.getByRole("button", { name: "Kontribusi", exact: true }).focus();
    await page.keyboard.press("Enter");
    expect(await page.getByLabel("Draf contributions").inputValue()).toBe("");

    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 1024) {
        const select = page.getByRole("combobox", { name: "Bagian ruang kerja", exact: true });
        expect(await select.isVisible()).toBe(true);
        expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await select.selectOption("identity");
      } else {
        expect(await page.getByRole("navigation", { name: "Bagian ruang kerja" }).isVisible()).toBe(true);
        await page.getByRole("button", { name: "Identitas & mandat", exact: true }).click();
      }
      await page.getByRole("heading", { name: "Identitas & mandat", exact: true }).waitFor();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const headingTop = (await page.getByRole("heading", { name: "Identitas & mandat", exact: true }).boundingBox())!.y;
      expect(headingTop).toBeGreaterThanOrEqual(112);
      expect(headingTop).toBeLessThan(500);
      if (process.env.WORKSPACE_SCREENSHOT_DIR && (width === 375 || width === 1440)) {
        await mkdir(process.env.WORKSPACE_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: resolve(process.env.WORKSPACE_SCREENSHOT_DIR, `workspace-${width}.png`), fullPage: true });
      }
    }
    await page.getByRole("button", { name: "Keluar ruang kerja", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Sesi berakhir" }).waitFor();
    expect(await page.getByRole("region").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.stop(true); }
}, 30000);
