// backend/src/controllers/settings/paymentSettingsController.js
"use strict";

const db = require("../../models");
const Setting = db.Setting;

const KEY = "paymentSettings";

const DEFAULTS = {
  acceptedMethods: ["cash"], // ['cash','mobile','bank','card']
  mobileMoney: { enabled: false, provider: "manual" },
  bankTransfer: { enabled: false, accounts: [] }, // [{name, number, bank, branch}]
  cardGateway: { enabled: false, provider: "manual", publicKey: "", secretKey: "" },
};

exports.getPaymentSettings = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const value = await Setting.get(KEY, DEFAULTS, { tenantId });
    res.status(200).json(value || DEFAULTS);
  } catch (error) {
    console.error("❌ Error fetching payment settings:", error);
    res.status(500).json({ message: "Failed to fetch payment settings" });
  }
};

exports.updatePaymentSettings = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const curr = await Setting.get(KEY, DEFAULTS, { tenantId });
    const next = { ...DEFAULTS, ...curr, ...(req.body || {}) };

    await Setting.set(KEY, next, { tenantId, updatedBy: req.user?.id || null });
    res.status(200).json({ message: "Payment settings updated successfully", settings: next });
  } catch (error) {
    console.error("❌ Error updating payment settings:", error);
    res.status(500).json({ message: "Failed to update payment settings" });
  }
};
