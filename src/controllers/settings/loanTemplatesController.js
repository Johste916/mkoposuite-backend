const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loanTemplates';
const DEFAULTS = {
  templates: [
    // { id:'uuid', name:'Loan Application v1', type:'application'|'agreement'|'collateral', fileUrl:'/uploads/..', active:true }
  ]
};

const getLoanTemplates = async (_req, res) => {
  try {
    const cur = await Setting.get(KEY, DEFAULTS);
    res.json(cur);
  } catch (e) {
    console.error('loanTemplates:get', e);
    res.status(500).json({ message: 'Failed to fetch loan templates' });
  }
};

const updateLoanTemplates = async (req, res) => {
  try {
    const next = { ...DEFAULTS, ...(req.body || {}) };
    const saved = await Setting.set(KEY, next, req.user?.id, req.user?.id);
    res.json({ message: 'Loan templates updated', settings: saved });
  } catch (e) {
    console.error('loanTemplates:update', e);
    res.status(500).json({ message: 'Failed to update loan templates' });
  }
};

module.exports = { getLoanTemplates, updateLoanTemplates };
