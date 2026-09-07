/**
 * What happened when a source was read (Spec #68, ticket #70).
 *
 * Three outcomes, deliberately not two:
 *
 * - **READ** - the source answered. It may have answered with nothing, and an
 *   empty period is a real, reportable fact.
 * - **MISSING** - there is no such source on this deployment. Nothing was
 *   attempted, so nothing is known about the period.
 * - **FAILED** - the read was attempted and did not succeed. Nothing is known
 *   about the period here either, but for a different reason, and the reason
 *   is what a person needs in order to fix it.
 *
 * The distinction is the point. Reading a database and getting `[]` because the
 * query threw looks exactly like reading it and finding no rows, and the report
 * built on top says `total: 0` and `balanced: true` in both cases. One of those
 * is a finding; the other is a false zero wearing a finding's clothes.
 *
 * Pure on purpose: no database, no clock, no network. The adapters at the edges
 * decide which outcome applies; this module only gives them the words for it.
 */

export type SourceStatus = "READ" | "MISSING" | "FAILED";

export type SourceRead<T> =
  | { status: "READ"; rows: T[] }
  | { status: "MISSING"; detail: string }
  | { status: "FAILED"; detail: string };

export const sourceRead = <T>(rows: T[]): SourceRead<T> => ({ status: "READ", rows });

export const sourceMissing = <T>(detail: string): SourceRead<T> => ({ status: "MISSING", detail });

export const sourceFailed = <T>(detail: string): SourceRead<T> => ({ status: "FAILED", detail });

/**
 * The rows, or `null` when there are none to be had.
 *
 * Returning `null` rather than `[]` for the two unread outcomes is the whole
 * discipline: a caller that wants a list has to say, in code, what it intends
 * to do about not having one.
 */
export const rowsOf = <T>(read: SourceRead<T>): T[] | null =>
  read.status === "READ" ? read.rows : null;

/** One named source and how it answered, in the shape a response carries. */
export type SourceCoverage = {
  name: string;
  status: SourceStatus;
  /** Why it was not read. `null` when it was. */
  detail: string | null;
  /** How many rows came back. `null` when nothing was read, never `0`. */
  rowCount: number | null;
};

export const coverageOf = <T>(name: string, read: SourceRead<T>): SourceCoverage =>
  read.status === "READ"
    ? { name, status: "READ", detail: null, rowCount: read.rows.length }
    : { name, status: read.status, detail: read.detail, rowCount: null };

/** Complete means every source answered. A source that answered with nothing counts. */
export const coverageIsComplete = (coverage: readonly SourceCoverage[]): boolean =>
  coverage.every((entry) => entry.status === "READ");

export const unreadSources = (coverage: readonly SourceCoverage[]): SourceCoverage[] =>
  coverage.filter((entry) => entry.status !== "READ");

/**
 * Runs a read, turning a thrown error into `FAILED` with its message.
 *
 * `MISSING` is never produced here: whether a source exists at all is knowledge
 * the adapter has before it tries, and inferring it from an exception would be
 * guessing.
 */
export async function attemptRead<T>(load: () => Promise<T[]>): Promise<SourceRead<T>> {
  try {
    return sourceRead(await load());
  } catch (error: any) {
    return sourceFailed(String(error?.message ?? error));
  }
}

/** One line naming what could not be read, for a response or a log. */
export const describeUnread = (coverage: readonly SourceCoverage[]): string | null => {
  const unread = unreadSources(coverage);
  if (unread.length === 0) return null;
  const listed = unread
    .map((entry) => `${entry.name} (${entry.status === "MISSING" ? "belum tersedia" : "gagal dibaca"}: ${entry.detail})`)
    .join("; ");
  return (
    `Sumber berikut tidak terbaca sehingga cakupannya belum terperiksa: ${listed}. ` +
    `Angka nol pada cakupan tersebut bukan hasil pembacaan yang berhasil.`
  );
};
