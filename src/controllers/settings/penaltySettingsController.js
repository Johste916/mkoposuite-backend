const db = require('../../models');
const Setting = db.Setting;

// Penalty setting keys
const PENALTY_KEYS = {
  TYPE: 'penalty_type',             // "fixed" or "percentage"
  AMOUNT: 'penalty_amount',         // number
  APPLY_AFTER_DAYS: 'penalty_grace_days', // grace period
  MAX_CAP: 'penalty_max_cap',       // optional max penalty
};

/**
 * @desc    Get Penalty Settings
 * @route   GET /api/settings/penalty-settings
 * @access  Private
 */
exports.getPenaltySettings = async (req, res) => {
  try {
    const settings = await Setting.findAll({
      where: {
        key: Object.values(PENALTY_KEYS)
      }
    });

    const data = {};
    settings.forEach(({ key, value }) => {
      data[key] = value;
    });

    res.status(200).json(data);
  } catch (error) {
    console.error('❌ Error fetching penalty settings:', error);
    res.status(500).json({ message: 'Failed to retrieve penalty settings.' });
  }
};

/**
 * @desc    Update Penalty Settings
 * @route   PUT /api/settings/penalty-settings
 * @access  Private
 */
exports.updatePenaltySettings = async (req, res) => {
  try {
    const payload = req.body;
    const updatedSettings = [];

    for (const key of Object.values(PENALTY_KEYS)) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        const [updated] = await Setting.upsert({
          key,
          value: payload[key]
        });

        updatedSettings.push({
          key,
          value: payload[key]
        });
      }
    }

    res.status(200).json({
      message: 'Penalty settings updated successfully.',
      data: updatedSettings,
    });
  } catch (error) {
    console.error('❌ Error updating penalty settings:', error);
    res.status(500).json({ message: 'Failed to update penalty settings.' });
  }
};
