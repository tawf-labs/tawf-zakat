/** Report policy shared by reconciliation and period reports; amounts are whole minor units. */
export const AMIL_CEILING_BPS = 1250n;

export function assessAmilAmounts(collected: bigint, actual: bigint) {
  return {
    ceiling: collected * AMIL_CEILING_BPS / 10_000n,
    withinCeiling: actual * 10_000n <= collected * AMIL_CEILING_BPS,
  };
}
