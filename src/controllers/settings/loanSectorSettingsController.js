const db = require('../../models');
const Setting = db.Setting;

const KEY = 'loanSectorSettings';

exports.getLoanSectorSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json(Array.isArray(row?.value) ? row.value : []);
  } catch (error) {
    console.error('❌ Error fetching loan sector settings:', error);
    res.status(500).json({ message: 'Failed to fetch loan sector settings' });
  }
};

exports.updateLoanSectorSettings = async (req, res) => {
  try {
    const { sectors } = req.body;
    if (!Array.isArray(sectors)) {
      return res.status(400).json({ message: 'Invalid format. Expected "sectors" to be an array.' });
    }

    const clean = sectors.map((s, idx) => ({
      code: String(s.code || `SEC_${idx + 1}`).trim(),
      label: String(s.label || '').trim(),
      active: typeof s.active === 'boolean' ? s.active : true,
    }));

    await Setting.upsert({ key: KEY, value: clean, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Loan sector settings updated successfully', settings: clean });
  } catch (error) {
    console.error('❌ Error updating loan sector settings:', error);
    res.status(500).json({ message: 'Failed to update loan sector settings' });
  }
};
