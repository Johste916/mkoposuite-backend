// backend/src/controllers/settings/smsSettingsController.js
const db = require('../../models');
const Setting = db.Setting;

const KEY = 'smsSettings';

const DEFAULTS = {
  gateway: {
    provider: 'custom', // 'custom' | 'twilio' | 'africastalking' | etc.
    baseUrl: '',
    apiKey: '',
    username: '',
    password: ''
  },
  senderId: '',
  templates: {
    dueReminder: 'Hello {{name}}, your installment of {{amount}} is due on {{dueDate}}.',
    arrears: 'Hello {{name}}, your account is in arrears: {{amount}}. Please pay to avoid penalties.',
    disbursement: 'Dear {{name}}, your loan of {{amount}} has been disbursed.'
  },
  autoRules: {
    enabled: false,
    daysBeforeDue: 2,
    daysAfterMissed: [1, 3, 7]
  }
};

const getSmsSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.json(row?.value || DEFAULTS);
  } catch (e) {
    console.error('getSmsSettings error:', e);
    res.status(500).json({ message: 'Failed to fetch SMS settings' });
  }
};

const updateSmsSettings = async (req, res) => {
  try {
    const merged = { ...DEFAULTS, ...(req.body || {}) };
    const [row] = await Setting.upsert({ key: KEY, value: merged });
    res.json({ message: 'SMS settings updated', settings: row?.value || merged });
  } catch (e) {
    console.error('updateSmsSettings error:', e);
    res.status(500).json({ message: 'Failed to update SMS settings' });
  }
};

module.exports = { getSmsSettings, updateSmsSettings };
