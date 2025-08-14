const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loanApprovalWorkflows';
const DEFAULTS = {
  workflows: [
    // {
    //   id:'uuid', name:'Default flow', mode:'straight'|'approval',
    //   productIds:[], branchIds:[], approverRoles:['manager','director'], minAmount:null, maxAmount:null, active:true
    // }
  ]
};

const getLoanApprovals = async (_req, res) => {
  try {
    const cur = await Setting.get(KEY, DEFAULTS);
    res.json(cur);
  } catch (e) {
    console.error('loanApprovals:get', e);
    res.status(500).json({ message: 'Failed to fetch approval workflows' });
  }
};

const updateLoanApprovals = async (req, res) => {
  try {
    const next = { ...DEFAULTS, ...(req.body || {}) };
    const saved = await Setting.set(KEY, next, req.user?.id, req.user?.id);
    res.json({ message: 'Approval workflows updated', settings: saved });
  } catch (e) {
    console.error('loanApprovals:update', e);
    res.status(500).json({ message: 'Failed to update approval workflows' });
  }
};

module.exports = { getLoanApprovals, updateLoanApprovals };
