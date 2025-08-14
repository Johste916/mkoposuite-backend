const db = require('../../models');
const Setting = db.Setting;

const KEY = 'payrollSettings';

const DEFAULTS = {
  basicSalaryStructure: [], // [{code,label,amount}]
  deductions: [],           // [{code,label,percent|amount}]
  taxConfig: {},            // { brackets:[], reliefs:[] }
};

exports.getPayrollSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json({ ...DEFAULTS, ...(row?.value || {}) });
  } catch (error) {
    console.error('❌ Error fetching payroll settings:', error);
    res.status(500).json({ message: 'Failed to fetch payroll settings' });
  }
};

exports.updatePayrollSettings = async (req, res) => {
  try {
    const existing = await Setting.findOne({ where: { key: KEY } });
    const curr = existing?.value || {};
    const next = {
      ...DEFAULTS,
      ...curr,
      ...req.body,
    };
    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Payroll settings updated successfully', settings: next });
  } catch (error) {
    console.error('❌ Error updating payroll settings:', error);
    res.status(500).json({ message: 'Failed to update payroll settings' });
  }
};
