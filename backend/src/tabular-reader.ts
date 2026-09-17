/**
 * Pure tabular reader (Spec #86, Ticket #88).
 *
 * Separates generic tabular decoding (XLSX and CSV UTF-8) from domain schemas.
 * Reusable for Report Source imports and future Beneficiary imports (Ticket #92).
 *
 * It lives here rather than in `shared/` because it decodes workbooks with `xlsx`,
 * and `shared/` is the code both sides compile without third-party dependencies.
 * Both readers of this module are server-side; the browser never decodes a workbook.
 *
 * Security & Integrity Rules:
 * 1. Formulas and external references are NEVER executed. Cells containing formulas
 *    are detected and rejected with sheet, row, and column coordinates.
 * 2. Macros (.xlsm, VBA projects) and encrypted/password-protected workbooks are rejected.
 * 3. File size (5 MiB), row counts (5,000), and column counts (50) have strict bounds
 *    to prevent expansion / zip bomb attacks.
 * 4. Text identifiers preserve leading zeros (e.g. "0123" does not become 123).
 * 5. Large rupiah numbers maintain exact decimal integer strings without floating point loss.
 *    A numeric cell whose exact value JavaScript cannot hold (beyond 2^53) is refused as
 *    ambiguous rather than rounded: a silently rounded rupiah is worse than a rejected one.
 * 6. Exported text sanitizes active formula prefixes (=, +, -, @).
 *
 * XLSX and CSV must describe the same table. A cell's text therefore comes from the
 * cell's own value, never from the workbook's display formatting (`cell.w`): the
 * displayed text is locale-dependent, so stripping its separators turns 1500000.5 into
 * 15000005 in XLSX while CSV rejects the same value. Decoding reads `cell.v` and leaves
 * every domain judgement - what is an amount, what is a date - to the schema layer.
 */

import * as XLSX from "xlsx";

export const MAX_TABULAR_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MAX_TABULAR_ROWS = 5000;
export const MAX_TABULAR_COLS = 50;

export type TabularRow = {
  /** 1-based row number as seen in spreadsheet / CSV (including header offset) */
  rowNumber: number;
  /** Normalized cell values keyed by normalized column header */
  cells: Record<string, string>;
  /** Raw cell values keyed by normalized column header */
  rawValues: Record<string, unknown>;
};

export type TabularTable = {
  sheetName: string;
  headers: string[];
  normalizedHeaders: string[];
  rows: TabularRow[];
};

export type TabularIssue = {
  scope: "file" | "sheet" | "row" | "cell";
  sheetName?: string;
  rowNumber: number | null;
  column: string | null;
  field?: string;
  message: string;
  code:
    | "FILE_TOO_LARGE"
    | "UNSUPPORTED_FORMAT"
    | "MACRO_DETECTED"
    | "ENCRYPTED_WORKBOOK"
    | "FORMULA_FORBIDDEN"
    | "LIMIT_EXCEEDED"
    | "EMPTY_TABLE"
    | "INVALID_ROW"
    | "AMBIGUOUS_VALUE";
};

export type TabularFormat = "xlsx" | "csv";

export type TabularDecodeResult = {
  success: boolean;
  format: TabularFormat;
  table: TabularTable | null;
  issues: TabularIssue[];
};

/** Normalizes a column header string for case-insensitive and whitespace-tolerant matching */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");
}

/** Check if binary data contains PK Zip header */
function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Check if binary data contains OLE2 Compound File header */
function isOle2(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  );
}

/** Detect if binary contains VBA macro indicator */
function containsVbaMacro(bytes: Uint8Array, fileName?: string): boolean {
  if (fileName && /\.xlsm$/i.test(fileName)) return true;
  // Look for VBA project signatures in binary
  const binaryString = new TextDecoder("latin1").decode(bytes.slice(0, 100000));
  return (
    binaryString.includes("vbaProject.bin") ||
    binaryString.includes("_VBA_PROJECT") ||
    binaryString.includes("VBA/dir")
  );
}

/**
 * Whether a numeric cell is really a date.
 *
 * A workbook stores 2024-03-04 as the number 45355 plus a date format. Read as a
 * number it becomes a plausible rupiah figure, so the format is what tells them
 * apart - and a cell that means a date is refused rather than read as an amount.
 */
function isDateFormatted(cell: XLSX.CellObject): boolean {
  const format = cell.z;
  if (typeof format === "number") return XLSX.SSF.is_date(XLSX.SSF.get_table()[format] ?? "");
  return typeof format === "string" && XLSX.SSF.is_date(format);
}

/** One cell this reader will not guess at, located precisely enough to fix. */
const ambiguous = (
  sheetName: string,
  rowNumber: number,
  column: string,
  reason: string
): TabularIssue => ({
  scope: "cell",
  sheetName,
  rowNumber,
  column,
  code: "AMBIGUOUS_VALUE",
  message: `Baris ${rowNumber} kolom "${column}": ${reason}`,
});

/**
 * Sanitizes cell text for CSV export to prevent spreadsheet formula injection.
 * Prepends a single quote if the cell begins with =, +, -, @, tab, or carriage return.
 */
export function sanitizeForExport(text: string): string {
  if (/^[=+\-@\t\r]/.test(text)) {
    return `'${text}`;
  }
  return text;
}

/**
 * Parses a CSV string respecting RFC 4180 rules.
 * Supports comma and semicolon delimiters, quoted fields with commas and newlines.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // Strip UTF-8 BOM if present
  let cleanText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  // Auto-detect comma vs semicolon based on first non-empty line
  const firstLine = cleanText.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ";" : ",";

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentCell += '"';
          i++; // Skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if (char === "\r") {
        if (nextChar === "\n") i++; // Consume CRLF
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== "")) rows.push(currentRow);
        currentRow = [];
        currentCell = "";
      } else if (char === "\n") {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== "")) rows.push(currentRow);
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += char;
      }
    }
  }

  // Push trailing cell & row if non-empty
  if (currentCell !== "" || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== "")) rows.push(currentRow);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  return { headers, rows: dataRows };
}

/**
 * Decodes tabular data from raw bytes or string into a structured TabularTable.
 */
export function decodeTabular(data: Uint8Array | string, fileName = ""): TabularDecodeResult {
  const issues: TabularIssue[] = [];
  const isBytes = typeof data !== "string";
  const bytes = isBytes ? data : new TextEncoder().encode(data);

  const isXlsxFile = /\.xlsx$/i.test(fileName) || /\.xlsm$/i.test(fileName) || isZip(bytes);
  const isCsvFile = /\.csv$/i.test(fileName) || (!isXlsxFile && !isOle2(bytes));
  // Every refusal names the format it was reading, so a caller never has to guess
  // which decoder produced the message.
  const format: "xlsx" | "csv" = isXlsxFile ? "xlsx" : "csv";

  if (bytes.byteLength > MAX_TABULAR_FILE_BYTES) {
    return {
      success: false,
      format,
      table: null,
      issues: [
        {
          scope: "file",
          rowNumber: null,
          column: null,
          code: "FILE_TOO_LARGE",
          message: `Ukuran berkas (${bytes.byteLength} byte) melampaui batas maksimal ${MAX_TABULAR_FILE_BYTES} byte (5 MiB).`,
        },
      ],
    };
  }

  if (!isXlsxFile && !isCsvFile) {
    if (isOle2(bytes)) {
      return {
        success: false,
        format,
        table: null,
        issues: [
          {
            scope: "file",
            rowNumber: null,
            column: null,
            code: "ENCRYPTED_WORKBOOK",
            message:
              "Format workbook OLE2 / XLS lawas atau terenkripsi tidak didukung. Simpan sebagai XLSX standar atau CSV UTF-8.",
          },
        ],
      };
    }
    return {
      success: false,
      format,
      table: null,
      issues: [
        {
          scope: "file",
          rowNumber: null,
          column: null,
          code: "UNSUPPORTED_FORMAT",
          message:
            "Format berkas tidak didukung. Gunakan berkas spreadsheet XLSX utama atau CSV UTF-8 alternatif.",
        },
      ],
    };
  }

  // --- XLSX PROCESSING ---
  if (isXlsxFile) {
    if (containsVbaMacro(bytes, fileName)) {
      return {
        success: false,
        format,
        table: null,
        issues: [
          {
            scope: "file",
            rowNumber: null,
            column: null,
            code: "MACRO_DETECTED",
            message:
              "Berkas memuat makro (VBA / .xlsm) dan ditolak demi keamanan. Simpan berkas sebagai XLSX tanpa makro.",
          },
        ],
      };
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(bytes, {
        type: "buffer",
        cellFormula: true,
        cellHTML: false,
        // The number format is read - not to display the cell, but to tell a date
        // serial apart from a plain number. A workbook writes 2024-03-04 as 45355.
        cellNF: true,
        cellText: true,
      });
    } catch (err: any) {
      return {
        success: false,
        format,
        table: null,
        issues: [
          {
            scope: "file",
            rowNumber: null,
            column: null,
            code: "ENCRYPTED_WORKBOOK",
            message:
              "Berkas spreadsheet gagal dibuka atau terenkripsi kata sandi. Unggah berkas XLSX tanpa enkripsi.",
          },
        ],
      };
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        success: false,
        format,
        table: null,
        issues: [
          {
            scope: "file",
            rowNumber: null,
            column: null,
            code: "EMPTY_TABLE",
            message: "Workbook spreadsheet tidak memuat lembar kerja yang dapat dibaca.",
          },
        ],
      };
    }

    // Pick appropriate sheet: prefer 'Sumber_Laporan' or first non-info sheet
    let targetSheetName = workbook.SheetNames.find(
      (name) => name.toLowerCase() === "sumber_laporan" || name.toLowerCase() === "sumber"
    );
    if (!targetSheetName) {
      targetSheetName = workbook.SheetNames.find((name) => name.toLowerCase() !== "petunjuk");
    }
    if (!targetSheetName) {
      targetSheetName = workbook.SheetNames[0];
    }

    const worksheet = workbook.Sheets[targetSheetName];
    if (!worksheet) {
      return {
        success: false,
        format,
        table: null,
        issues: [
          {
            scope: "sheet",
            sheetName: targetSheetName,
            rowNumber: null,
            column: null,
            code: "EMPTY_TABLE",
            message: `Lembar kerja "${targetSheetName}" kosong atau tidak dapat dibaca.`,
          },
        ],
      };
    }

    // Inspect cells for formulas and dimensions
    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
    const totalSheetRows = range.e.r - range.s.r + 1;
    const totalSheetCols = range.e.c - range.s.c + 1;

    if (totalSheetRows > MAX_TABULAR_ROWS || totalSheetCols > MAX_TABULAR_COLS) {
      return {
        success: false,
        format,
        table: null,
        issues: [
          {
            scope: "sheet",
            sheetName: targetSheetName,
            rowNumber: null,
            column: null,
            code: "LIMIT_EXCEEDED",
            message: `Lembar kerja memiliki ${totalSheetRows} baris dan ${totalSheetCols} kolom, melampaui batas maksimal (${MAX_TABULAR_ROWS} baris, ${MAX_TABULAR_COLS} kolom).`,
          },
        ],
      };
    }

    // Check for formulas in cells without executing them
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellAddress];
        if (!cell) continue;

        if (cell.f || (typeof cell.v === "string" && cell.v.startsWith("="))) {
          issues.push({
            scope: "cell",
            sheetName: targetSheetName,
            rowNumber: r + 1,
            column: XLSX.utils.encode_col(c),
            code: "FORMULA_FORBIDDEN",
            message: `Formula atau referensi eksternal tidak dieksekusi. Ditemukan formula pada sel ${cellAddress}: "${cell.f || cell.v}". Masukkan nilai pasti.`,
          });
        }
      }
    }

    if (issues.length > 0) {
      return { success: false, format, table: null, issues };
    }

    // Convert sheet to row array with raw preserving
    const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    if (rawRows.length === 0) {
      return {
        success: false,
        format,
        table: null,
        issues: [
          {
            scope: "sheet",
            sheetName: targetSheetName,
            rowNumber: null,
            column: null,
            code: "EMPTY_TABLE",
            message: `Lembar kerja "${targetSheetName}" tidak memiliki baris data.`,
          },
        ],
      };
    }

    const headerRow = (rawRows[0] as any[]) || [];
    const headers: string[] = [];
    const normalizedHeaders: string[] = [];

    for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
      const h = String(headerRow[colIdx] || "").trim();
      if (h) {
        headers.push(h);
        normalizedHeaders.push(normalizeHeader(h));
      }
    }

    if (headers.length === 0) {
      return {
        success: false,
        format,
        table: null,
        issues: [
          {
            scope: "sheet",
            sheetName: targetSheetName,
            rowNumber: 1,
            column: null,
            code: "EMPTY_TABLE",
            message: "Baris judul kolom (header) tidak ditemukan.",
          },
        ],
      };
    }

    const parsedRows: TabularRow[] = [];
    for (let rIdx = 1; rIdx < rawRows.length; rIdx++) {
      const rowData = (rawRows[rIdx] as any[]) || [];
      // Skip completely empty rows
      const isEmpty = rowData.every((val) => val === undefined || val === null || String(val).trim() === "");
      if (isEmpty) continue;

      const cells: Record<string, string> = {};
      const rawValues: Record<string, unknown> = {};

      for (let cIdx = 0; cIdx < headers.length; cIdx++) {
        const normKey = normalizedHeaders[cIdx];
        const cellAddress = XLSX.utils.encode_cell({ r: rIdx, c: cIdx });
        const cell = worksheet[cellAddress];

        let cellStr = "";
        let cellRaw = rowData[cIdx];

        if (cell) {
          cellRaw = cell.v;
          if (cell.t === "s") {
            // Text cell: preserve exact string including leading zeros
            cellStr = String(cell.v);
          } else if (cell.t === "n" && isDateFormatted(cell)) {
            issues.push(ambiguous(targetSheetName, rIdx + 1, headers[cIdx],
              `sel bertipe tanggal tidak dapat dibaca tanpa ambiguitas hari/bulan. Ubah sel ` +
                `menjadi teks dengan format YYYY-MM-DD sebelum mengunggah ulang.`));
          } else if (cell.t === "n") {
            const value = cell.v as number;
            if (Number.isSafeInteger(value)) {
              cellStr = String(BigInt(value));
            } else if (Number.isFinite(value) && !Number.isInteger(value)) {
              // A fraction, written exactly as the workbook holds it. The schema layer
              // refuses it for the same reason it refuses "1500000,5" from a CSV.
              cellStr = String(value);
            } else {
              // Beyond 2^53 the workbook's own value is already rounded; there is no
              // exact figure left to read, so the cell is refused rather than guessed.
              issues.push(ambiguous(targetSheetName, rIdx + 1, headers[cIdx],
                `angka ${String(value)} melampaui presisi bilangan bulat yang dapat dibaca ` +
                  `secara pasti. Tulis nilai tersebut sebagai teks agar angkanya tidak dibulatkan.`));
            }
          } else if (cell.t === "d") {
            issues.push(ambiguous(targetSheetName, rIdx + 1, headers[cIdx],
              `sel bertipe tanggal tidak dapat dibaca tanpa ambiguitas hari/bulan. Ubah sel ` +
                `menjadi teks dengan format YYYY-MM-DD sebelum mengunggah ulang.`));
          } else if (cell.t === "e") {
            issues.push(ambiguous(targetSheetName, rIdx + 1, headers[cIdx],
              `sel memuat nilai kesalahan spreadsheet. Masukkan nilai pasti sebelum mengunggah ulang.`));
          } else {
            cellStr = String(cell.v ?? "");
          }
        } else if (cellRaw !== undefined && cellRaw !== null) {
          cellStr = String(cellRaw).trim();
        }

        cells[normKey] = cellStr.trim();
        rawValues[normKey] = cellRaw;
      }

      parsedRows.push({
        rowNumber: rIdx + 1, // 1-indexed (row 2 in spreadsheet)
        cells,
        rawValues,
      });
    }

    if (issues.length > 0) {
      return { success: false, format, table: null, issues };
    }

    return {
      success: true,
      format,
      table: {
        sheetName: targetSheetName,
        headers,
        normalizedHeaders,
        rows: parsedRows,
      },
      issues: [],
    };
  }

  // --- CSV PROCESSING ---
  const csvText = isBytes ? new TextDecoder("utf-8").decode(bytes) : data;
  const { headers: csvHeaders, rows: csvDataRows } = parseCsv(csvText);

  if (csvHeaders.length === 0) {
    return {
      success: false,
      format,
      table: null,
      issues: [
        {
          scope: "file",
          rowNumber: null,
          column: null,
          code: "EMPTY_TABLE",
          message: "Berkas CSV kosong atau tidak memiliki baris header.",
        },
      ],
    };
  }

  if (csvDataRows.length > MAX_TABULAR_ROWS || csvHeaders.length > MAX_TABULAR_COLS) {
    return {
      success: false,
      format,
      table: null,
      issues: [
        {
          scope: "file",
          rowNumber: null,
          column: null,
          code: "LIMIT_EXCEEDED",
          message: `Berkas CSV memiliki ${csvDataRows.length} baris dan ${csvHeaders.length} kolom, melampaui batas maksimal (${MAX_TABULAR_ROWS} baris, ${MAX_TABULAR_COLS} kolom).`,
        },
      ],
    };
  }

  const normalizedHeaders = csvHeaders.map(normalizeHeader);
  const parsedRows: TabularRow[] = [];

  for (let rIdx = 0; rIdx < csvDataRows.length; rIdx++) {
    const rowValues = csvDataRows[rIdx];
    const rowNumber = rIdx + 2; // 1-based, row 1 is header

    const cells: Record<string, string> = {};
    const rawValues: Record<string, unknown> = {};

    for (let cIdx = 0; cIdx < csvHeaders.length; cIdx++) {
      const normKey = normalizedHeaders[cIdx];
      const val = rowValues[cIdx] !== undefined ? String(rowValues[cIdx]) : "";

      // Formula injection in CSV cells. A plain number may legitimately open with a
      // sign, so "-500" passes while "-1+cmd|'/c calc'!A0" does not.
      if (/^[=+\-@\t\r]/.test(val) && !/^[+-]?\d+([.,]\d+)?$/.test(val)) {
        issues.push({
          scope: "cell",
          rowNumber,
          column: csvHeaders[cIdx],
          code: "FORMULA_FORBIDDEN",
          message: `Formula tidak dieksekusi pada baris ${rowNumber} kolom "${csvHeaders[cIdx]}": "${val}". Masukkan nilai langsung.`,
        });
      }

      cells[normKey] = val.trim();
      rawValues[normKey] = val;
    }

    parsedRows.push({
      rowNumber,
      cells,
      rawValues,
    });
  }

  if (issues.length > 0) {
    return { success: false, format, table: null, issues };
  }

  return {
    success: true,
    format,
    table: {
      sheetName: "CSV",
      headers: csvHeaders,
      normalizedHeaders,
      rows: parsedRows,
    },
    issues: [],
  };
}
