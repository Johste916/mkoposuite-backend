// backend/src/controllers/settings/generalSettingsController.js
"use strict";

const db = require("../../models");
const Setting = db.Setting;

const KEY = "general";

const DEFAULTS = {
  company: {
    name: "MkopoSuite",
    email: "info@example.com",
    phone: "+255700000000",
    website: "https://example.com",
    address1: "",
    address2: "",
    city: "",
    country: "Tanzania",
    logoUrl: "",          // uploaded via /api/uploads/image
    profileImageUrl: "",  // optional secondary image
  },
  branding: {
    primaryColor: "#1d4ed8",
    secondaryColor: "#0ea5e9",
  },
  locale: {
    currency: "TZS",
    timezone: "Africa/Dar_es_Salaam",
    language: "en",
    currencyInWords: "Shillings",
    dateFormat: "dd/mm/yyyy",
  },
  numberFormats: {
    thousandSeparator: ",",
    decimalSeparator: ".",
    currencyPosition: "prefix", // or 'suffix'
  },
  dashboard: {
    landingWidgets: ["kpis", "recent-activity", "collections"],
    showTicker: true,

    // These two are displayed by dashboardController (top/middle bars):
    importantNotice: "REMINDER: Submit weekly branch PAR review by Friday 4:00 PM.",
    companyMessage: "Welcome to MkopoSuite LMS — Q3 focus: Risk reduction & collections discipline.",

    // Optional curated card block for future use:
    curatedMessage: {
      title: "",
      text: "",
      attachments: [] // [{fileName, fileUrl}]
    }
  },
};

const deepMerge = (base, patch) => {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
  if (typeof base !== "object" || typeof patch !== "object" || !base || !patch) return patch ?? base;
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] = deepMerge(base[k], patch[k]);
  }
  return out;
};

exports.getGeneral = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const current = await Setting.get(KEY, DEFAULTS, { tenantId });
    const merged = deepMerge(DEFAULTS, current || {}); // make sure new default keys appear
    res.json(merged);
  } catch (e) {
    console.error("general:get error:", e);
    res.status(500).json({ message: "Failed to fetch general settings" });
  }
};

exports.updateGeneral = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const current = await Setting.get(KEY, DEFAULTS, { tenantId });
    const next = deepMerge(current || {}, req.body || {});
    await Setting.set(KEY, next, { tenantId, updatedBy: req.user?.id || null, createdBy: req.user?.id || null });
    res.json(next);
  } catch (e) {
    console.error("general:update error:", e);
    res.status(500).json({ message: "Failed to update general settings" });
  }
};
