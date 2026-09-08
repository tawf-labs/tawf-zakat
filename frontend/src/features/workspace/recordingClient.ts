import type { PrivateRequests } from "./privateRequests";
import type { RecordingIntent } from "../../../../shared/report-registry";
export async function recordingRequest<T = { intent: RecordingIntent }>(path: string, requests: PrivateRequests, body?: unknown): Promise<T> {
  return requests.json<T>(`/api/evidence/${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
