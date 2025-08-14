const db = require('../../models');
const Setting = db.Setting;

const KEY = 'dashboardSettings';

// allow-listed keys the FE can control
const ALLOWED = new Set([
  'widgetsOrder',
  'showParWidget',
  'showDisbursementWidget',
  'showCollectionsWidget',
  'recentActivityLimit',
]);

/**
 * @desc GET /api/settings/dashboard-settings
 */
const getDashboardSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json(row?.value || {});
  } catch (error) {
    console.error('❌ Error fetching dashboard settings:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard settings' });
  }
};

/**
 * @desc PUT /api/settings/dashboard-settings
 */
const updateDashboardSettings = async (req, res) => {
  try {
    // merge + filter keys
    const existing = await Setting.findOne({ where: { key: KEY } });
    const curr = existing?.value || {};
    const next = { ...curr };
    for (const [k, v] of Object.entries(req.body || {})) {
      if (ALLOWED.has(k)) next[k] = v;
    }

    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Dashboard settings updated successfully', settings: next });
  } catch (error) {
    console.error('❌ Error updating dashboard settings:', error);
    res.status(500).json({ message: 'Failed to update dashboard settings' });
  }
};

module.exports = { getDashboardSettings, updateDashboardSettings };
