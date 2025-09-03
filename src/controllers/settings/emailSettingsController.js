// backend/src/controllers/settings/emailSettingsController.js
"use strict";

const db = require("../../models");
const Setting = db.Setting;

const KEY = "emailSettings";

const DEFAULTS = {
  accounts: [
    // { id:'default', fromName:'MkopoSuite', fromEmail:'noreply@yourdomain.com', host:'smtp.mailgun.org', port:587, secure:false, user:'', pass:'' }
  ],
  templates: {
    dueReminder: {
      subject: "Installment Due: {{dueDate}}",
      html: "<p>Hello {{name}},</p><p>Your installment of <b>{{amount}}</b> is due on <b>{{dueDate}}</b>.</p>"
    },
    arrears: {
      subject: "Arrears Notice",
      html: "<p>Hello {{name}},</p><p>Your account is in arrears: <b>{{amount}}</b>. Please make a payment.</p>"
    }
  },
  autoRules: {
    enabled: false,
    accountId: "default",
    daysBeforeDue: 2
  }
};

exports.getEmailSettings = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const v = await Setting.get(KEY, DEFAULTS, { tenantId });
    res.json(v || DEFAULTS);
  } catch (e) {
    console.error("getEmailSettings error:", e);
    res.status(500).json({ message: "Failed to fetch Email settings" });
  }
};

exports.updateEmailSettings = async (req, res) => {
  try {
    const tenantId = req.headers["x-tenant-id"] || req.context?.tenantId || null;
    const merged = { ...DEFAULTS, ...(req.body || {}) };
    await Setting.set(KEY, merged, { tenantId, updatedBy: req.user?.id || null });
    res.json({ message: "Email settings updated", settings: merged });
  } catch (e) {
    console.error("updateEmailSettings error:", e);
    res.status(500).json({ message: "Failed to update Email settings" });
  }
};
