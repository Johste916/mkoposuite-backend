// backend/src/controllers/settings/borrowerSettingsController.js
const db = require('../../models');
const Setting = db.Setting;

const KEY = 'borrowerSettings';

/** ---------------- Defaults & schema ---------------- */
const DEFAULTS = {
  minAge: 18,
  maxAge: 65,
  allowMultipleLoans: false,
  requireGuarantors: true,
  requireIDVerification: true,
  defaultEmploymentStatus: 'unemployed', // 'unemployed' | 'employed' | 'self-employed' | 'student' | 'retired'
};

// Allowed values for a few fields (light validation)
const EMPLOYMENT_OPTIONS = new Set([
  'unemployed',
  'employed',
  'self-employed',
  'student',
  'retired',
]);

const ALLOWED_KEYS = Object.keys(DEFAULTS);

/** Pick only allowed keys from payload (and coerce types carefully) */
function sanitizePayload(body = {}) {
  const x = {};
  if ('minAge' in body) x.minAge = Number(body.minAge);
  if ('maxAge' in body) x.maxAge = Number(body.maxAge);
  if ('allowMultipleLoans' in body) x.allowMultipleLoans = !!body.allowMultipleLoans;
  if ('requireGuarantors' in body) x.requireGuarantors = !!body.requireGuarantors;
  if ('requireIDVerification' in body) x.requireIDVerification = !!body.requireIDVerification;
  if ('defaultEmploymentStatus' in body) {
    const v = String(body.defaultEmploymentStatus || '').toLowerCase();
    if (EMPLOYMENT_OPTIONS.has(v)) x.defaultEmploymentStatus = v;
  }
  return x;
}

/** Merge (defaults <- current <- incoming) so partial updates are safe */
function merge(current = {}, incoming = {}) {
  return { ...DEFAULTS, ...(current || {}), ...(incoming || {}) };
}

/** Basic validation rules */
function validate(value) {
  const errors = [];

  const minAge = Number(value.minAge);
  const maxAge = Number(value.maxAge);

  if (!Number.isFinite(minAge) || minAge < 0 || minAge > 120) {
    errors.push('minAge must be a number between 0 and 120');
  }
  if (!Number.isFinite(maxAge) || maxAge < 0 || maxAge > 120) {
    errors.push('maxAge must be a number between 0 and 120');
  }
  if (Number.isFinite(minAge) && Number.isFinite(maxAge) && minAge > maxAge) {
    errors.push('minAge cannot be greater than maxAge');
  }

  if (value.defaultEmploymentStatus && !EMPLOYMENT_OPTIONS.has(value.defaultEmploymentStatus)) {
    errors.push('defaultEmploymentStatus is not valid');
  }

  return errors;
}

/**
 * @desc   GET /api/settings/borrower-settings
 * @access Private
 */
const getBorrowerSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    const merged = merge(row?.value || {}, {}); // apply defaults
    res.status(200).json(merged);
  } catch (error) {
    console.error('❌ Error fetching borrower settings:', error);
    res.status(500).json({ message: 'Failed to fetch borrower settings' });
  }
};

/**
 * @desc   PUT /api/settings/borrower-settings
 * @access Private (recommend admin/director)
 */
const updateBorrowerSettings = async (req, res) => {
  try {
    // 1) sanitize + merge
    const incoming = sanitizePayload(req.body);
    const existing = await Setting.findOne({ where: { key: KEY } });
    const value = merge(existing?.value || {}, incoming);

    // 2) validate
    const errors = validate(value);
    if (errors.length) {
      return res.status(400).json({ message: 'Validation failed', errors });
    }

    // 3) persist (avoid dialect differences in upsert returning)
    if (existing) {
      await existing.update({
        value,
        updatedBy: req?.user?.id || null,
        description: 'Borrower module behavior',
      });
    } else {
      await Setting.create({
        key: KEY,
        value,
        updatedBy: req?.user?.id || null,
        description: 'Borrower module behavior',
      });
    }

    return res.status(200).json({
      message: 'Borrower settings updated successfully',
      settings: value,
    });
  } catch (error) {
    console.error('❌ Error updating borrower settings:', error);
    res.status(500).json({ message: 'Failed to update borrower settings' });
  }
};

module.exports = {
  getBorrowerSettings,
  updateBorrowerSettings,
};
