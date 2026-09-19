import { describe, expect, it } from "bun:test";
import { createResendTransport, donorEmailTransportFromEnv, isEmailAddress, MessageDeliveryError } from "../src/email-transport";

describe("Resend email transport (ticket #104)", () => {
  it("posts one plain-text email from the configured sender", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport = createResendTransport({
      apiKey: "re_test",
      from: "ZKT <otp@example.org>",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
      }) as typeof fetch,
    });

    await transport.send({ to: " donatur@example.org ", body: "Kode verifikasi akses kontribusi Anda: 123456." });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: "ZKT <otp@example.org>",
      to: ["donatur@example.org"],
      subject: "Kode verifikasi akses kontribusi",
      text: "Kode verifikasi akses kontribusi Anda: 123456.",
    });
  });

  it("fails on a provider or network error without echoing the recipient", async () => {
    const refusing = createResendTransport({
      apiKey: "re_test",
      from: "otp@example.org",
      fetch: (async () => new Response("{\"to\":\"donatur@example.org\"}", { status: 422 })) as unknown as typeof fetch,
    });
    const error = await refusing.send({ to: "donatur@example.org", body: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(MessageDeliveryError);
    expect(error.message).not.toContain("donatur@example.org");

    const offline = createResendTransport({
      apiKey: "re_test",
      from: "otp@example.org",
      fetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch,
    });
    await expect(offline.send({ to: "donatur@example.org", body: "x" })).rejects.toBeInstanceOf(MessageDeliveryError);
  });

  it("reaches email addresses only", () => {
    expect(isEmailAddress("donatur@example.org")).toBe(true);
    expect(isEmailAddress("081234567890")).toBe(false);
    expect(isEmailAddress("donatur@localhost")).toBe(false);
  });

  it("is configured only when both key and sender are set", () => {
    expect(donorEmailTransportFromEnv({ RESEND_API_KEY: "re_x" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(donorEmailTransportFromEnv({ DONOR_OTP_EMAIL_FROM: "otp@example.org" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(donorEmailTransportFromEnv({ RESEND_API_KEY: "re_x", DONOR_OTP_EMAIL_FROM: "otp@example.org" } as NodeJS.ProcessEnv)).toBeDefined();
  });
});
