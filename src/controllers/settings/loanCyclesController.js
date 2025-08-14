const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loanRepaymentCycles';
const DEFAULTS = {
  cycles: [
    // { id:'uuid', name:'Monthly', frequency:'monthly', interval:1, graceDays:0, active:true }
  ]
};

const getLoanCycles = async (_req, res) => {
  try {
    const cur = await Setting.get(KEY, DEFAULTS);
    res.json(cur);
  } catch (e) {
    console.error('loanCycles:get', e);
    res.status(500).json({ message: 'Failed to fetch repayment cycles' });
  }
};

const updateLoanCycles = async (req, res) => {
  try {
    const next = { ...DEFAULTS, ...(req.body || {}) };
    const saved = await Setting.set(KEY, next, req.user?.id, req.user?.id);
    res.json({ message: 'Repayment cycles updated', settings: saved });
  } catch (e) {
    console.error('loanCycles:update', e);
    res.status(500).json({ message: 'Failed to update repayment cycles' });
  }
};

module.exports = { getLoanCycles, updateLoanCycles };
