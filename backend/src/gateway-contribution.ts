/**
 * Online payments (Midtrans) into the institution's contribution ledger.
 *
 * A settled payment becomes a RECEIVED contribution attributed to the system, not
 * to an invented officer. It never moves past RECEIVED here: source reconciliation
 * and endorsement remain the work of people with the matching mandate, so a
 * gateway notification alone is never enough to enter a proof batch.
 */
import { ContributionDuplicateError, type ActorIdentity, type ContributionStore, type GatewayIntent } from "./contribution-store";
import type { JenisDana } from "./contribution";

/** The recorder of a gateway payment: a system actor with no officer or mandate. */
export const GATEWAY_ACTOR: ActorIdentity = { account: "system:midtrans", officerId: null };

/** Donation categories as the payment form names them; anything unrecognised is plain zakat. */
export function fundTypeOf(zakatType: string): JenisDana {
  const name = zakatType.toLowerCase();
  if (name.includes("fitrah")) return "FITRAH";
  if (name.includes("kurban")) return "KURBAN";
  if (name.includes("infaq") || name.includes("infak") || name.includes("sedekah")) return "INFAK_SEDEKAH";
  return "ZAKAT";
}

export type SettledDonation = {
  trxId: string;
  amountIDR: number;
  donorName: string;
  isAnonymous: boolean;
  paidAt?: string;
};

export type GatewayOutcome = "RECORDED" | "DUPLICATE" | "NO_INTENT";

export const rememberGatewayIntent = (store: ContributionStore, intent: GatewayIntent, now: number) =>
  store.saveGatewayIntent(intent, now);

/** Idempotent: the webhook and the status poll may both report the same payment. */
export async function recordSettledDonation(store: ContributionStore, donation: SettledDonation, now: number): Promise<GatewayOutcome> {
  const intent = await store.getGatewayIntent(donation.trxId);
  if (!intent) return "NO_INTENT";
  const paidAt = donation.paidAt ? Date.parse(donation.paidAt) : NaN;
  try {
    await store.createContribution(intent.institutionId, {
      sourceChannel: "QRIS",
      sourceReference: donation.trxId,
      currencyUnit: "IDR",
      amountExact: String(Math.trunc(donation.amountIDR)),
      fundType: fundTypeOf(intent.zakatType),
      purpose: "Donasi Online",
      receivedAt: Number.isFinite(paidAt) ? Math.floor(paidAt / 1000) : now,
      donorName: donation.donorName,
      donorContact: intent.donorContact,
    }, GATEWAY_ACTOR, now);
    return "RECORDED";
  } catch (error) {
    if (error instanceof ContributionDuplicateError) return "DUPLICATE";
    throw error;
  }
}
