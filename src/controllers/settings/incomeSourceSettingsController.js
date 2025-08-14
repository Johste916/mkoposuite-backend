const db = require('../../models');
const Setting = db.Setting;

const KEY = 'incomeSourceSettings';

/**
 * @desc GET /api/settings/income-source-settings
 */
const getIncomeSourceSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    const value = Array.isArray(row?.value) ? row.value : [];
    res.status(200).json(value);
  } catch (error) {
    console.error('❌ Error fetching income source settings:', error);
    res.status(500).json({ message: 'Failed to fetch income source settings' });
  }
};

/**
 * @desc PUT /api/settings/income-source-settings
 * body: { sources: [{code:'EMP', label:'Employment'}, ...] }
 */
const updateIncomeSourceSettings = async (req, res) => {
  try {
    const { sources } = req.body;
    if (!Array.isArray(sources)) {
      return res.status(400).json({ message: 'Invalid format. Expected an array of sources.' });
    }

    // Normalize items
    const clean = sources.map((s, idx) => ({
      code: String(s.code || `SRC_${idx + 1}`).trim(),
      label: String(s.label || '').trim(),
      active: typeof s.active === 'boolean' ? s.active : true,
    }));

    await Setting.upsert({ key: KEY, value: clean, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Income source settings updated successfully', settings: clean });
  } catch (error) {
    console.error('❌ Error updating income source settings:', error);
    res.status(500).json({ message: 'Failed to update income source settings' });
  }
};

module.exports = { getIncomeSourceSettings, updateIncomeSourceSettings };
