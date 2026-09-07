import type { AmilStatus } from "./types";

export const amilStatusLabel = (status: AmilStatus = "NOT_CHECKED"): string => ({
  WITHIN_CEILING: "Dalam plafon 12,5%",
  EXCEEDED: "Melampaui plafon 12,5%",
  NOT_CHECKED: "Belum dapat diperiksa",
})[status];
