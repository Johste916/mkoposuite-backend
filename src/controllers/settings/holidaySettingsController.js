const db = require('../../models');
const Setting = db.Setting;

const KEY = 'holidaySettings';

/**
 * @desc GET /api/settings/holiday-settings
 */
const getHolidaySettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json(Array.isArray(row?.value) ? row.value : []);
  } catch (error) {
    console.error('❌ Error fetching holiday settings:', error);
    res.status(500).json({ message: 'Failed to fetch holiday settings' });
  }
};

/**
 * @desc PUT /api/settings/holiday-settings
 * body: { holidays: [{ date: '2025-12-25', name: 'Christmas', branchId: null }] }
 */
const updateHolidaySettings = async (req, res) => {
  try {
    const { holidays } = req.body;
    if (!Array.isArray(holidays)) {
      return res.status(400).json({ message: 'Invalid format: holidays should be an array' });
    }

    const clean = holidays.map((h) => ({
      date: String(h.date || '').trim(), // ISO date string suggested
      name: String(h.name || '').trim(),
      branchId: h.branchId ?? null,
      recurring: !!h.recurring,
    }));

    await Setting.upsert({ key: KEY, value: clean, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Holiday settings updated successfully', settings: clean });
  } catch (error) {
    console.error('❌ Error updating holiday settings:', error);
    res.status(500).json({ message: 'Failed to update holiday settings' });
  }
};

module.exports = { getHolidaySettings, updateHolidaySettings };
