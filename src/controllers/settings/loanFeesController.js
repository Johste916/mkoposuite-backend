const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loanFees';
const DEFAULTS = {
  fees: [
    // { id:'uuid', name:'Processing', mode:'fixed'|'percent', amount:1000, productIds:[1,2], active:true }
  ]
};

const getLoanFees = async (_req, res) => {
  try {
    const cur = await Setting.get(KEY, DEFAULTS);
    res.json(cur);
  } catch (e) {
    console.error('loanFees:get', e);
    res.status(500).json({ message: 'Failed to fetch loan fees' });
  }
};

const updateLoanFees = async (req, res) => {
  try {
    const next = { ...DEFAULTS, ...(req.body || {}) };
    const saved = await Setting.set(KEY, next, req.user?.id, req.user?.id);
    res.json({ message: 'Loan fees updated', settings: saved });
  } catch (e) {
    console.error('loanFees:update', e);
    res.status(500).json({ message: 'Failed to update loan fees' });
  }
};

module.exports = { getLoanFees, updateLoanFees };
