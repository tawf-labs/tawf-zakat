/**
 * Handing a generated file to the browser.
 *
 * Kept apart from the modules that build the files so those stay pure and
 * testable without a DOM.
 */

function saveBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Prefixed with a byte order mark so spreadsheets read the accents correctly. */
export function downloadCsv(fileName: string, csv: string) {
  saveBlob(fileName, new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
}

export function downloadText(fileName: string, text: string) {
  saveBlob(fileName, new Blob([text], { type: "text/plain;charset=utf-8" }));
}
