// backend/src/controllers/settings/smsSettingsController.js
"use strict";

const db = require("../../models");
const Setting = db.Setting;

const KEY = "smsSettings";

const DEFAULTS = {
  gateway: {
    provider: "custom", // 'custom' | 'twilio' | 'africastalking' | 'nexmo' | etc.
    baseUrl: "",
    apiKey: "",
    username: "",
    password: ""
  },
  senderId: "",
  templates: {
    dueReminder: "Hello {{name}}, your installment of {{amount}} is due on {{dueDate}}.",
    arrears: "Hello {{name}}, your account is in arrears: {{amount}}. Please pay to avoid penalties.",
    disbursement: "Dear {{name}}, your loan of {{amount}} has been disbursed."
  },
  autoRules: {
    enabled: false,
    daysBeforeDue: 2,
    daysAfterMissed: [1, 3, 7]
  }
};

exports.getSmsSettings = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const v = await Setting.get(KEY, DEFAULTS, { tenantId });
    res.json(v || DEFAULTS);
  } catch (e) {
    console.error("getSmsSettings error:", e);
    res.status(500).json({ message: "Failed to fetch SMS settings" });
  }
};

exports.updateSmsSettings = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const merged = { ...DEFAULTS, ...(req.body || {}) };
    await Setting.set(KEY, merged, { tenantId, updatedBy: req.user?.id || null });
    res.json({ message: "SMS settings updated", settings: merged });
  } catch (e) {
    console.error("updateSmsSettings error:", e);
    res.status(500).json({ message: "Failed to update SMS settings" });
  }
};
