const db = require('../../models');
const Setting = db.Setting;

const INTEGRATION_KEYS = [
  'quickbooks_credentials',
  'sms_gateway_config',
  'payment_gateway_config',
  'nida_gateway_config',
  'developer_api_keys'
];

/**
 * @desc    Get all integration settings
 * @route   GET /api/settings/integration-settings
 * @access  Private
 */
const getIntegrationSettings = async (req, res) => {
  try {
    const settings = await Setting.findAll({
      where: {
        key: INTEGRATION_KEYS
      }
    });

    const response = INTEGRATION_KEYS.reduce((acc, key) => {
      const found = settings.find(setting => setting.key === key);
      acc[key] = found?.value || null;
      return acc;
    }, {});

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Error fetching integration settings:', error);
    res.status(500).json({ message: 'Failed to fetch integration settings' });
  }
};

/**
 * @desc    Update integration settings
 * @route   PUT /api/settings/integration-settings
 * @access  Private
 */
const updateIntegrationSettings = async (req, res) => {
  try {
    const updates = req.body;

    const operations = INTEGRATION_KEYS
      .filter(key => updates.hasOwnProperty(key))
      .map(key =>
        Setting.upsert({
          key,
          value: updates[key]
        })
      );

    await Promise.all(operations);

    res.status(200).json({ message: 'Integration settings updated successfully' });
  } catch (error) {
    console.error('❌ Error updating integration settings:', error);
    res.status(500).json({ message: 'Failed to update integration settings' });
  }
};

module.exports = {
  getIntegrationSettings,
  updateIntegrationSettings
};
