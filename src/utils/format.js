// src/utils/format.js

export const fmtCurrency = (v, currency = "TZS") => {
  if (v == null || v === "" || isNaN(Number(v))) return "—";
  return `\u200e${currency} ${Number(v || 0).toLocaleString()}`;
};

export const fmtNum = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString());

export const fmtPct = (v) => (v == null || v === "" ? "—" : `${Number(v)}%`);

export const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "—";
  }
};

// Backward-friendly alias used in a few places
export const fmtTZS = (v, currency = "TZS") => fmtCurrency(v, currency);
