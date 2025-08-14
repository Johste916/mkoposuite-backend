const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loanReminders';
const DEFAULTS = {
  rules: [
    // { id:'uuid', name:'Due in 3 days', offsetDays:-3, channels:['sms','email'], productIds:[], active:true }
  ]
};

const getLoanReminders = async (_req, res) => {
  try {
    const cur = await Setting.get(KEY, DEFAULTS);
    res.json(cur);
  } catch (e) {
    console.error('loanReminders:get', e);
    res.status(500).json({ message: 'Failed to fetch loan reminders' });
  }
};

const updateLoanReminders = async (req, res) => {
  try {
    const next = { ...DEFAULTS, ...(req.body || {}) };
    const saved = await Setting.set(KEY, next, req.user?.id, req.user?.id);
    res.json({ message: 'Loan reminders updated', settings: saved });
  } catch (e) {
    console.error('loanReminders:update', e);
    res.status(500).json({ message: 'Failed to update loan reminders' });
  }
};

module.exports = { getLoanReminders, updateLoanReminders };
