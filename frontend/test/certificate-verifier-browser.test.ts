import { expect, it } from "bun:test";
import type { PublicCertificateSummary } from "../../shared/certificate-nft";

// Same optional browser seam as the certificate API smoke. No hook/cache mocks:
// the real route talks HTTP to a controlled public endpoint for failure/race cases.
it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("public verifier refreshes, clears stale success and cancels obsolete lookups", async () => {
  const build = await Bun.build({
    entrypoints: [new URL("./certificate-verifier-smoke.tsx", import.meta.url).pathname],
    target: "browser", define: { "import.meta.env": "{}" },
  });
  if (!build.success) throw new Error(build.logs.join("\n"));
  const bundle = await build.outputs[0]!.text();
  const certificate: PublicCertificateSummary = {
    institutionId: "institution-one", certificateId: "certificate-one", activityId: "activity-one",
    tokenId: "1", version: "1", issuer: `0x${"1".repeat(40)}`,
    custodian: `0x${"2".repeat(40)}`, contentDigest: `0x${"3".repeat(64)}`,
    observation: { state: "CONFIRMED", confirmations: 2, requiredConfirmations: 2, confirmationPolicy: "test" },
    totals: { confirmedCount: 4, disputedCount: 1, unconfirmedCount: 2, totalRealizedIdr: "1000" },
  };
  const success = (overrides: Partial<PublicCertificateSummary> = {}) => Response.json({
    success: true, certificate: { ...certificate, ...overrides, beneficiaryName: "PRIVATE-MARKER" },
  });
  const requests: Request[] = [];
  let reply: () => Response | Promise<Response> = () => success();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "text/javascript" } });
    if (path.startsWith("/api/public/certificates/")) { requests.push(request); return reply(); }
    if (path === "/sertifikat") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
    return new Response("Not found", { status: 404 });
  } });
  const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
  const browser = await chromium.launch({
    ...(process.env.REGISTRY_BROWSER_EXECUTABLE ? { executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE } : {}),
    headless: true, args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.context().addCookies([{ name: "private-session", value: "not-public", url: server.url.origin }]);
    await page.goto(`${server.url.origin}/sertifikat`);
    const institution = page.getByLabel("ID Lembaga", { exact: true });
    const id = page.getByLabel("ID Sertifikat", { exact: true });
    const verify = page.getByRole("button", { name: "Periksa", exact: true });
    const result = page.getByRole("heading", { name: /^Sertifikat #/ });
    await institution.waitFor();
    expect(requests).toHaveLength(0);
    await institution.fill(" institution-one ");
    await id.fill(" certificate-one ");
    await verify.click();
    await page.getByRole("heading", { name: "Sertifikat #1", exact: true }).waitFor();
    expect(await page.getByText("CONFIRMED", { exact: true }).count()).toBe(1);
    expect(await page.getByText("PRIVATE-MARKER").count()).toBe(0);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/public/certificates/institution-one/certificate-one");
    expect(requests[0]!.headers.get("authorization")).toBeNull();
    expect(requests[0]!.headers.get("cookie")).toBeNull();

    // A second click with identical IDs must reach the server and hide old success
    // both during the request and after a current content-verification failure.
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    reply = () => pending;
    await verify.click();
    await page.getByText("Memeriksa sertifikat…", { exact: true }).waitFor();
    expect(await result.count()).toBe(0);
    release(Response.json({ success: false, error: "Keterikatan isi sertifikat tidak valid." }, { status: 409 }));
    await page.getByRole("alert").waitFor();
    expect(await result.count()).toBe(0);
    expect(await page.getByRole("alert").textContent()).toBe("Keterikatan isi sertifikat tidak valid.");
    expect(requests).toHaveLength(2);
    reply = () => success();
    await verify.click();
    await result.waitFor();
    expect(requests).toHaveLength(3);

    // Institution is part of the identity even with an unchanged certificate ID.
    await institution.fill("institution-two");
    expect(await result.count()).toBe(0);
    reply = () => success({ institutionId: "institution-two", tokenId: "2" });
    await verify.click();
    await page.getByRole("heading", { name: "Sertifikat #2", exact: true }).waitFor();
    expect(new URL(requests[3]!.url).pathname).toBe("/api/public/certificates/institution-two/certificate-one");

    // Editing IDs aborts the active HTTP fetch, not merely its state update.
    const obsolete = new Promise<Response>((resolve) => { release = resolve; });
    reply = () => obsolete;
    await id.fill("obsolete");
    const started = page.waitForRequest((request: { url(): string }) => request.url().endsWith("/obsolete"));
    await verify.click();
    await started;
    const aborted = page.waitForEvent("requestfailed", { predicate: (request: { url(): string }) => request.url().endsWith("/obsolete") });
    await id.fill("certificate-three");
    await aborted;
    expect(await result.count()).toBe(0);
    reply = () => success({ institutionId: "institution-two", certificateId: "certificate-three", tokenId: "3" });
    await verify.click();
    await page.getByRole("heading", { name: "Sertifikat #3", exact: true }).waitFor();
    release(success({ tokenId: "999" }));
    expect(await page.getByRole("heading", { name: "Sertifikat #999", exact: true }).count()).toBe(0);

    // Shared URLs still verify automatically, without a submit click.
    await page.goto(`${server.url.origin}/sertifikat?institutionId=institution-two&certificateId=certificate-three`);
    await page.getByRole("heading", { name: "Sertifikat #3", exact: true }).waitFor();
    expect(await institution.inputValue()).toBe("institution-two");
    expect(await id.inputValue()).toBe("certificate-three");

    // The trace links to the version it displayed, not silently to a newer official head.
    await page.goto(`${server.url.origin}/sertifikat?institutionId=institution-two&certificateId=certificate-three&version=1`);
    await page.getByRole("heading", { name: "Sertifikat #3", exact: true }).waitFor();
    expect(new URL(requests.at(-1)!.url).pathname).toBe("/api/public/certificates/institution-two/certificate-three/versions/1");
    await page.getByRole("button", { name: "Kembali ke versi resmi terkini" }).click();
    await page.getByRole("heading", { name: "Sertifikat #3", exact: true }).waitFor();
    expect(new URL(requests.at(-1)!.url).pathname).toBe("/api/public/certificates/institution-two/certificate-three");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await server.stop(true);
  }
}, 30000);
