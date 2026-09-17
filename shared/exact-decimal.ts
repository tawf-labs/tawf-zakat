export const isExactNonNegativeDecimal = (value: string): boolean => /^\d+(\.\d+)?$/.test(value);

/** Compares two non-negative decimal strings exactly. Returns -1 if a < b, 0 if a === b, 1 if a > b. */
export function compareDecimalStrings(a: string, b: string): number {
  const [aInt, aFrac = ""] = a.split(".");
  const [bInt, bFrac = ""] = b.split(".");
  const scale = Math.max(aFrac.length, bFrac.length);
  const left = BigInt(aInt + aFrac.padEnd(scale, "0"));
  const right = BigInt(bInt + bFrac.padEnd(scale, "0"));
  return left === right ? 0 : left < right ? -1 : 1;
}

/** Subtracts non-negative decimal string b from a exactly. Returns "0" if b >= a. */
export function subtractDecimalStrings(a: string, b: string): string {
  const [aInt, aFrac = ""] = a.split(".");
  const [bInt, bFrac = ""] = b.split(".");
  const scale = Math.max(aFrac.length, bFrac.length);
  const scaled = (int: string, frac: string) => BigInt(int + frac.padEnd(scale, "0"));
  const aVal = scaled(aInt, aFrac);
  const bVal = scaled(bInt, bFrac);
  if (aVal <= bVal) return "0";
  const diff = aVal - bVal;
  const digits = diff.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  const whole = digits.slice(0, -scale) || "0";
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Adds two non-negative decimal strings exactly, without passing through floats. */
export function addDecimalStrings(a: string, b: string): string {
  const [aInt, aFrac = ""] = a.split(".");
  const [bInt, bFrac = ""] = b.split(".");
  const scale = Math.max(aFrac.length, bFrac.length);
  const scaled = (int: string, frac: string) => BigInt(int + frac.padEnd(scale, "0"));
  const digits = (scaled(aInt, aFrac) + scaled(bInt, bFrac)).toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  const whole = digits.slice(0, -scale);
  return fraction ? `${whole}.${fraction}` : whole;
}
