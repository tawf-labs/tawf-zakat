/**
 * The LPZN Akhir Tahun 2024 case, as text an Amil could have pasted in.
 *
 * Two tables printed two pages apart in the same official BAZNAS publication,
 * each internally consistent, differing by Rp668.020.210.274 on balance sheet.
 * Source: https://baznas.go.id/assets/images/szn/LPZ%20Nasional%20Akhir%20Tahun%202024.pdf
 * (Tabel 2.2 hal. 18, Tabel 2.3 hal. 19, kolom Tahun 2024, data per 11 Feb 2025).
 */

export const LPZN_2024_CLAIM_LABEL = "LPZN 2024 Tabel 2.2 (per jenis dana)";
export const LPZN_2024_SOURCE_LABEL = "LPZN 2024 Tabel 2.3 (per jenis Pengelola Zakat)";

export const LPZN_2024_CLAIM_TEXT = [
  "NASIONAL;Zakat Mal;Zakat Mal;on;4.350.099.606.318",
  "NASIONAL;Zakat Fitrah;Zakat Fitrah;on;618.668.807.899",
  "NASIONAL;Infak/Sedekah;Infak/Sedekah;on;3.759.094.821.080",
  "NASIONAL;Kurban;Kurban;on;2.695.928.225.424",
  "NASIONAL;Dana Sosial Keagamaan Lainnya;DSKL;on;198.336.062.526",
  "GRAND TOTAL;Total on balance sheet (tercetak);-;on;11.622.127.523.247",
].join("\n");

export const LPZN_2024_SOURCE_TEXT = [
  "NASIONAL;BAZNAS;BAZNAS;on;1.129.733.837.481",
  "NASIONAL;BAZNAS Provinsi;BAZNAS Provinsi;on;925.076.124.372",
  "NASIONAL;BAZNAS Kabupaten/Kota;BAZNAS Kabupaten Kota;on;2.176.987.785.735",
  "NASIONAL;LAZ Nasional;LAZ Nasional;on;6.142.328.062.482",
  "NASIONAL;LAZ Provinsi;LAZ Provinsi;on;363.010.435.724",
  "NASIONAL;LAZ Kabupaten/Kota;LAZ Kabupaten Kota;on;216.971.067.179",
  "GRAND TOTAL;Total on balance sheet (tercetak);-;on;10.954.107.312.973",
].join("\n");

/** Tabel 2.2 minus Tabel 2.3, on balance sheet. */
export const LPZN_2024_EXPECTED_GAP = "668020210274";
