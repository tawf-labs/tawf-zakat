import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createSandboxCampaignGateway } from "../src/crowdfunding-midtrans";

const key = "SB-Mid-server-local-test";
describe("crowdfunding Midtrans sandbox boundary", () => {
  test("only sandbox endpoints, actual redirect and authenticated status; signature checked", async () => {
    const requests: { url: string; options: RequestInit | undefined }[] = [];
    const gateway = createSandboxCampaignGateway(key, (async (url: any, options: any) => {
      requests.push({ url: String(url), options });
      return Response.json(String(url).includes("/status") ? { order_id: "CF-test", currency: "IDR", gross_amount: "10000.00", transaction_status: "pending" } : { token: "sandbox-token", redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/token" });
    }) as typeof fetch);
    const checkout = await gateway.create("CF-test", 10000, "Anonymous");
    expect(checkout.redirectUrl).toBe("https://app.sandbox.midtrans.com/snap/v4/redirection/token");
    expect(requests[0]!.url).toBe("https://app.sandbox.midtrans.com/snap/v1/transactions");
    expect(JSON.parse(requests[0]!.options!.body as string).transaction_details).toEqual({ order_id: "CF-test", gross_amount: 10000 });
    expect((await gateway.status("CF-test")).transaction_status).toBe("pending");
    expect(requests[1]!.url).toBe("https://api.sandbox.midtrans.com/v2/CF-test/status");
    expect((requests[1]!.options!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${key}:`).toString("base64")}`);
    const notification = { order_id: "CF-test", status_code: "200", gross_amount: "10000.00", signature_key: createHash("sha512").update(`CF-test20010000.00${key}`).digest("hex") };
    expect(gateway.verify(notification)).toBe(true);
    expect(gateway.verify({ ...notification, gross_amount: "1.00" })).toBe(false);
    expect(gateway.verify({ ...notification, signature_key: 1 })).toBe(false);
  });
  test("explicit order-not-created is distinguishable from network and malformed errors", async () => {
    for (const httpStatus of [200, 404]) {
      const gateway = createSandboxCampaignGateway(key, (async () => Response.json({ status_code: "404", status_message: "Transaction doesn't exist." }, { status: httpStatus })) as unknown as typeof fetch);
      await expect(gateway.status("CF-missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    const network = createSandboxCampaignGateway(key, (async () => { throw new Error("timeout"); }) as unknown as typeof fetch);
    await expect(network.status("CF-uncertain")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const generic404 = createSandboxCampaignGateway(key, (async () => new Response("proxy not found", { status: 404 })) as unknown as typeof fetch);
    await expect(generic404.status("CF-uncertain")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  test("unprefixed server keys still use sandbox only; invalid credentials fail closed", async () => {
    const urls: string[] = [];
    const gateway = createSandboxCampaignGateway("Mid-server-sandbox-compatible", (async (url: any) => {
      urls.push(String(url));
      return Response.json({ token: "token", redirect_url: "https://app.sandbox.midtrans.com/snap/token" });
    }) as typeof fetch);
    await expect(gateway.create("CF-test", 1000, "Anonymous")).resolves.toHaveProperty("token", "token");
    expect(urls).toEqual(["https://app.sandbox.midtrans.com/snap/v1/transactions"]);
    const denied = createSandboxCampaignGateway("Mid-server-invalid", (async () => Response.json({ error: "unauthorized" }, { status: 401 })) as unknown as typeof fetch);
    await expect(denied.create("CF-test", 1000, "Anonymous")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  test("no malformed key, mock checkout, production redirect, or fallback on failure", async () => {
    expect(() => createSandboxCampaignGateway("not-a-server-key")).toThrow("server key");
    const failed = createSandboxCampaignGateway(key, (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch);
    await expect(failed.create("CF-test", 1000, "Anonymous")).rejects.toThrow("unavailable");
    const production = createSandboxCampaignGateway(key, (async () => Response.json({ token: "token", redirect_url: "https://app.midtrans.com/snap/token" })) as unknown as typeof fetch);
    await expect(production.create("CF-test", 1000, "Anonymous")).rejects.toThrow("Invalid sandbox checkout");
    const missing = createSandboxCampaignGateway(key, (async () => Response.json({})) as unknown as typeof fetch);
    await expect(missing.create("CF-test", 1000, "Anonymous")).rejects.toThrow("Invalid sandbox checkout");
  });
});
