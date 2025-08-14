// backend/src/controllers/settings/generalSettingsController.js
const db = require('../../models');
const Setting = db.Setting;

const KEY = 'generalSettings';

const DEFAULTS = {
  company: {
    name: 'MkopoSuite',
    email: 'info@example.com',
    phone: '+255700000000',
    website: 'https://example.com',
    address1: '',
    address2: '',
    city: '',
    country: 'Tanzania',
    logoUrl: '',          // uploaded via /api/uploads/image
    profileImageUrl: '',  // optional secondary image
  },
  branding: {
    primaryColor: '#1d4ed8',
    secondaryColor: '#0ea5e9',
  },
  locale: {
    currency: 'TZS',
    timezone: 'Africa/Dar_es_Salaam',
    language: 'en',
    currencyInWords: 'Shillings',
    dateFormat: 'dd/mm/yyyy',
  },
  numberFormats: {
    thousandSeparator: ',',
    decimalSeparator: '.',
    currencyPosition: 'prefix', // or 'suffix'
  },
  dashboard: {
    landingWidgets: ['kpis', 'recent-activity', 'collections'],
    showTicker: true,
  },
};

const deepMerge = (base, patch) => {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
  if (typeof base !== 'object' || typeof patch !== 'object' || !base || !patch) return patch ?? base;
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] = deepMerge(base[k], patch[k]);
  }
  return out;
};

const getGeneral = async (_req, res) => {
  try {
    const current = await Setting.get(KEY, DEFAULTS);
    // Ensure any new DEFAULTS keys appear if missing
    const merged = deepMerge(DEFAULTS, current || {});
    return res.json(merged);
  } catch (e) {
    console.error('general:get error:', e);
    res.status(500).json({ message: 'Failed to fetch general settings' });
  }
};

const updateGeneral = async (req, res) => {
  try {
    const current = await Setting.get(KEY, DEFAULTS);
    const next = deepMerge(current || {}, req.body || {});
    const saved = await Setting.set(KEY, next, req.user?.id || null, req.user?.id || null);
    res.json({ message: 'General settings updated', settings: saved });
  } catch (e) {
    console.error('general:update error:', e);
    res.status(500).json({ message: 'Failed to update general settings' });
  }
};

module.exports = { getGeneral, updateGeneral };
