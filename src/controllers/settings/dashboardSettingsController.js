// backend/src/controllers/settings/dashboardSettingsController.js
"use strict";

const db = require("../../models");
const Setting = db.Setting;

const KEY = "dashboardSettings";

const DEFAULTS = {
  widgetsOrder: ["kpis", "recent-activity", "collections"],
  showParWidget: true,
  showDisbursementWidget: true,
  showCollectionsWidget: true,
  recentActivityLimit: 10,
  showTicker: true, // compatibility with FE
};

// allow-listed keys the FE can control
const ALLOWED = new Set(Object.keys(DEFAULTS));

exports.getDashboardSettings = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const v = await Setting.get(KEY, DEFAULTS, { tenantId });
    res.status(200).json(v || DEFAULTS);
  } catch (error) {
    console.error("❌ Error fetching dashboard settings:", error);
    res.status(500).json({ message: "Failed to fetch dashboard settings" });
  }
};

exports.updateDashboardSettings = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const curr = await Setting.get(KEY, DEFAULTS, { tenantId });
    const next = { ...curr };
    for (const [k, v] of Object.entries(req.body || {})) {
      if (ALLOWED.has(k)) next[k] = v;
    }
    await Setting.set(KEY, next, { tenantId, updatedBy: req.user?.id || null });
    res.status(200).json({ message: "Dashboard settings updated successfully", settings: next });
  } catch (error) {
    console.error("❌ Error updating dashboard settings:", error);
    res.status(500).json({ message: "Failed to update dashboard settings" });
  }
};
