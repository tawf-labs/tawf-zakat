import { getApiBaseUrl } from "../../lib/contracts";
import type { RecordingIntent } from "../../../../shared/report-registry";
export async function recordingRequest<T = { intent: RecordingIntent }>(path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}/api/evidence/${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Pencatatan tidak dapat diproses.");
  return payload;
}
