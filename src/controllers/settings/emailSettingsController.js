// backend/src/controllers/settings/emailSettingsController.js
const db = require('../../models');
const Setting = db.Setting;

const KEY = 'emailSettings';

const DEFAULTS = {
  accounts: [
    // { id:'default', fromName:'MkopoSuite', fromEmail:'noreply@yourdomain.com', host:'smtp.mailgun.org', port:587, secure:false, user:'', pass:'' }
  ],
  templates: {
    dueReminder: {
      subject: 'Installment Due: {{dueDate}}',
      html: '<p>Hello {{name}},</p><p>Your installment of <b>{{amount}}</b> is due on <b>{{dueDate}}</b>.</p>'
    },
    arrears: {
      subject: 'Arrears Notice',
      html: '<p>Hello {{name}},</p><p>Your account is in arrears: <b>{{amount}}</b>. Please make a payment.</p>'
    }
  },
  autoRules: {
    enabled: false,
    accountId: 'default',
    daysBeforeDue: 2
  }
};

const getEmailSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.json(row?.value || DEFAULTS);
  } catch (e) {
    console.error('getEmailSettings error:', e);
    res.status(500).json({ message: 'Failed to fetch Email settings' });
  }
};

const updateEmailSettings = async (req, res) => {
  try {
    const merged = { ...DEFAULTS, ...(req.body || {}) };
    const [row] = await Setting.upsert({ key: KEY, value: merged });
    res.json({ message: 'Email settings updated', settings: row?.value || merged });
  } catch (e) {
    console.error('updateEmailSettings error:', e);
    res.status(500).json({ message: 'Failed to update Email settings' });
  }
};

module.exports = { getEmailSettings, updateEmailSettings };
