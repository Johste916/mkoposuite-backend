const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loanSettings';

const DEFAULTS = {
  defaultInterestRate: 0,
  interestMethod: 'flat',          // 'flat' | 'reducing'
  allowMultipleLoans: false,
  requireGuarantors: true,
  maxTenorMonths: 24,
  repaymentCycles: ['weekly','biweekly','monthly'],
};

exports.getLoanSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json({ ...DEFAULTS, ...(row?.value || {}) });
  } catch (error) {
    console.error('❌ Error fetching loan settings:', error);
    res.status(500).json({ message: 'Server error retrieving loan settings' });
  }
};

exports.updateLoanSettings = async (req, res) => {
  try {
    const existing = await Setting.findOne({ where: { key: KEY } });
    const curr = existing?.value || {};
    const next = { ...DEFAULTS, ...curr, ...(req.body || {}) };

    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Loan settings updated successfully', settings: next });
  } catch (error) {
    console.error('❌ Error updating loan settings:', error);
    res.status(500).json({ message: 'Server error updating loan settings' });
  }
};
