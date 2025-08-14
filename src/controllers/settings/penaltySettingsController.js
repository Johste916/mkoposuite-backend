const db = require('../../models');
const Setting = db.Setting;

const KEY = 'penaltySettings';

const DEFAULTS = {
  type: 'fixed',          // 'fixed' | 'percentage'
  amount: 0,              // number
  graceDays: 0,           // apply after N days late
  maxCap: null,           // optional max penalty
  applyMode: 'perInstallment', // 'perInstallment' | 'totalOutstanding'
};

exports.getPenaltySettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json({ ...DEFAULTS, ...(row?.value || {}) });
  } catch (error) {
    console.error('❌ Error fetching penalty settings:', error);
    res.status(500).json({ message: 'Failed to retrieve penalty settings.' });
  }
};

exports.updatePenaltySettings = async (req, res) => {
  try {
    // Backward-compat mapping (old keys → new shape)
    const legacy = {
      type: req.body.penalty_type,
      amount: req.body.penalty_amount,
      graceDays: req.body.penalty_grace_days,
      maxCap: req.body.penalty_max_cap,
    };

    const existing = await Setting.findOne({ where: { key: KEY } });
    const curr = existing?.value || {};

    const next = {
      ...DEFAULTS,
      ...curr,
      ...req.body,
      ...Object.fromEntries(
        Object.entries(legacy).filter(([, v]) => typeof v !== 'undefined')
      ),
    };

    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Penalty settings updated successfully.', settings: next });
  } catch (error) {
    console.error('❌ Error updating penalty settings:', error);
    res.status(500).json({ message: 'Failed to update penalty settings.' });
  }
};
