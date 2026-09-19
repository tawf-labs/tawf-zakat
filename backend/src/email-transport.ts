/**
 * Email delivery of donor OTP codes through Resend (ticket #104).
 *
 * Only a plain HTTP call, so no mail library is added. The transport can only
 * reach email addresses; it says so through `canDeliver`, and the donor store
 * refuses a phone-only contact honestly instead of pretending to send.
 */

import type { RecipientMessageTransport } from "./workspace-runtime";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmailAddress = (value: string) => EMAIL_PATTERN.test(value.trim());

export class MessageDeliveryError extends Error {
  constructor(readonly status: number | null) {
    super(`Pengiriman email gagal${status ? ` (HTTP ${status})` : ""}.`);
    this.name = "MessageDeliveryError";
  }
}

export function createResendTransport(options: {
  apiKey: string;
  from: string;
  subject?: string;
  fetch?: typeof fetch;
}): RecipientMessageTransport {
  const send = options.fetch ?? fetch;
  return {
    canDeliver: isEmailAddress,
    async send({ to, body }) {
      let res: Response;
      try {
        res = await send(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: options.from,
            to: [to.trim()],
            subject: options.subject ?? "Kode verifikasi akses kontribusi",
            text: body,
          }),
        });
      } catch {
        throw new MessageDeliveryError(null);
      }
      // The provider's body may echo the recipient; it is not carried into the error.
      if (!res.ok) throw new MessageDeliveryError(res.status);
    },
  };
}

/** Both variables or nothing: a half-configured channel is not offered. */
export function donorEmailTransportFromEnv(env: NodeJS.ProcessEnv = process.env): RecipientMessageTransport | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.DONOR_OTP_EMAIL_FROM?.trim();
  if (!apiKey || !from) return undefined;
  return createResendTransport({ apiKey, from });
}
