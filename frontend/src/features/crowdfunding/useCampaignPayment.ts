import { useCallback, useSyncExternalStore } from "react";
import { api, CrowdfundingApiError, type Payment } from "./client";

type Snapshot = { payment?: Payment; busy: boolean; error: string };
type RecordState = {
  snapshot: Snapshot;
  sequence: number;
  listeners: Set<() => void>;
};
const empty: Snapshot = { busy: false, error: "" };
// Tab-scoped ownership survives SPA unmount/remount. No credentials enter URLs.
const records = new Map<string, RecordState>();
const storageKey = (id: string) => `zkt.crowdfunding.payment.${id}`;
const unresolved = (payment?: Payment) =>
  payment &&
  ["PENDING", "CREATED", "CREATING", "GATEWAY_ERROR", "NOT_FOUND"].includes(
    payment.status.toUpperCase(),
  );
function record(id: string): RecordState {
  let value = records.get(id);
  if (!value) {
    let payment: Payment | undefined;
    try {
      const stored = sessionStorage.getItem(storageKey(id));
      if (stored) payment = JSON.parse(stored);
    } catch {
      /* Storage unavailable or invalid: keep in-memory ownership. */
    }
    value = {
      snapshot: { ...empty, payment },
      sequence: 0,
      listeners: new Set(),
    };
    records.set(id, value);
  }
  return value;
}
function publish(value: RecordState, snapshot: Snapshot) {
  value.snapshot = snapshot;
  value.listeners.forEach((listener) => listener());
}
async function operate(
  id: string,
  kind: "create" | "check" | "retry",
  body?: unknown,
): Promise<boolean> {
  const value = record(id);
  const previous = value.snapshot.payment;
  if (
    value.snapshot.busy ||
    (kind === "create" && unresolved(previous)) ||
    (kind !== "create" && !previous?.accessToken)
  )
    return false;
  const sequence = ++value.sequence;
  const current = () =>
    value.sequence === sequence &&
    (kind === "create" || value.snapshot.payment?.id === previous?.id);
  publish(value, { ...value.snapshot, busy: kind !== "check", error: "" });
  const persist = (payment: Payment) => {
    if (!current()) return false;
    // Persist even without a mounted detail page, but never replace a newer intent.
    try {
      sessionStorage.setItem(storageKey(id), JSON.stringify(payment));
    } catch {
      /* The tab-scoped record still retains recovery access. */
    }
    publish(value, { payment, busy: false, error: "" });
    return true;
  };
  try {
    const response = await api<{ payment: Payment }>(
      kind === "create"
        ? `/campaigns/${encodeURIComponent(id)}/donations`
        : `/payments/${encodeURIComponent(previous!.id)}${kind === "retry" ? "/retry" : ""}`,
      {
        method: kind === "check" ? "GET" : "POST",
        public: true,
        paymentToken: kind === "create" ? undefined : previous!.accessToken,
        body,
      },
    );
    if (!current()) return false;
    if (kind !== "create" && response.payment.id !== previous!.id)
      throw new Error("Respons ID pembayaran tidak sesuai.");
    return persist(
      kind === "create"
        ? response.payment
        : {
            ...previous!,
            ...response.payment,
            accessToken: previous!.accessToken,
          },
    );
  } catch (error) {
    if (!current()) return false;
    if (
      error instanceof CrowdfundingApiError &&
      error.payment &&
      (kind === "create"
        ? Boolean(error.payment.accessToken)
        : error.payment.id === previous!.id)
    ) {
      persist(
        kind === "create"
          ? error.payment
          : {
              ...previous!,
              ...error.payment,
              accessToken: previous!.accessToken,
            },
      );
    }
    publish(value, {
      ...value.snapshot,
      busy: false,
      error:
        error instanceof Error
          ? error.message
          : "Pembayaran belum dapat diproses.",
    });
    return false;
  }
}

export function useCampaignPayment(campaignId: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const value = record(campaignId);
      value.listeners.add(listener);
      return () => {
        value.listeners.delete(listener);
      };
    },
    [campaignId],
  );
  const getSnapshot = useCallback(
    () => record(campaignId).snapshot,
    [campaignId],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => empty);
  const create = useCallback(
    (body: unknown) => operate(campaignId, "create", body),
    [campaignId],
  );
  const check = useCallback(() => operate(campaignId, "check"), [campaignId]);
  const retry = useCallback(() => operate(campaignId, "retry"), [campaignId]);
  return { ...snapshot, create, check, retry };
}
