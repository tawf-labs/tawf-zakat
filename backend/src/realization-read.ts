/**
 * Reading the realization stream's records once, for whichever sides are built from them.
 *
 * A read that throws is answered as `failed`, never as an empty source. The activity
 * trace is a relation of the source, not the source itself: when it cannot be read
 * the realizations are still returned, and the provenance says why the trace is absent.
 */

import type { ActivityStore } from "./activity-store";
import type { DisbursementStore } from "./disbursement-store";
import type { ActivityTraceData, RealizationSourceData } from "./realization-source";

export type RealizationRead =
  | { ok: true; data: RealizationSourceData; activityTrace: ActivityTraceData | { unavailable: string } | undefined }
  | { ok: false };

export async function readRealizationRecords(
  disbursement: DisbursementStore,
  activities: ActivityStore | undefined,
  institutionId: string
): Promise<RealizationRead> {
  let data: RealizationSourceData;
  try {
    data = await disbursement.readRealizationSourceData(institutionId);
  } catch (error) {
    console.error("[evidence] realization source read failed", error);
    return { ok: false };
  }
  let activityTrace: ActivityTraceData | { unavailable: string } | undefined;
  if (activities) {
    try {
      activityTrace = await activities.readActivityTrace(institutionId);
    } catch (error) {
      console.error("[evidence] activity trace read failed", error);
      activityTrace = { unavailable: "Kegiatan penyaluran dan alokasi kontribusi tidak dapat dibaca dari penyimpanan." };
    }
  }
  return { ok: true, data, activityTrace };
}
