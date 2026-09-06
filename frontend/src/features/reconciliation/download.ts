/**
 * Handing a generated file to the browser. Kept apart from `reconciliationTools`
 * so that module stays pure and testable without a DOM.
 */

/** Prefixed with a byte order mark so spreadsheets read the accents correctly. */
export function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
