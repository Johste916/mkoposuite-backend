// backend/src/controllers/settings/apiSettingsController.js
const db = require('../../models');
const Setting = db.Setting;

const KEY = 'apiSettings';

const DEFAULTS = {
  keys: [], // [{label:'Backoffice', key:'****'}]
  whitelist: [], // array of CIDR/IP strings
  rateLimits: {
    windowSec: 60,
    maxRequests: 600
  }
};

const getApiSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.json(row?.value || DEFAULTS);
  } catch (e) {
    console.error('getApiSettings error:', e);
    res.status(500).json({ message: 'Failed to fetch API settings' });
  }
};

const updateApiSettings = async (req, res) => {
  try {
    const merged = { ...DEFAULTS, ...(req.body || {}) };
    const [row] = await Setting.upsert({ key: KEY, value: merged });
    res.json({ message: 'API settings updated', settings: row?.value || merged });
  } catch (e) {
    console.error('updateApiSettings error:', e);
    res.status(500).json({ message: 'Failed to update API settings' });
  }
};

module.exports = { getApiSettings, updateApiSettings };
