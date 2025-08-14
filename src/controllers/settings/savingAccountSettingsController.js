const db = require('../../models');
const Setting = db.Setting;

const KEY = 'savingAccountSettings';

const DEFAULTS = {
  minOpeningBalance: 0,
  interestRate: 0,
  allowOverdraft: false,
  overdraftLimit: 0,
};

exports.getSavingAccountSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json({ ...DEFAULTS, ...(row?.value || {}) });
  } catch (error) {
    console.error('❌ Error fetching saving account settings:', error);
    res.status(500).json({ message: 'Failed to retrieve saving account settings', error: error.message });
  }
};

exports.updateSavingAccountSettings = async (req, res) => {
  try {
    const existing = await Setting.findOne({ where: { key: KEY } });
    const curr = existing?.value || {};
    const next = {
      ...DEFAULTS,
      ...curr,
      ...req.body,
    };

    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Saving account settings updated successfully', settings: next });
  } catch (error) {
    console.error('❌ Error updating saving account settings:', error);
    res.status(500).json({ message: 'Failed to update saving account settings', error: error.message });
  }
};
