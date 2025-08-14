const db = require('../../models');
const Setting = db.Setting;

const KEY = 'integrationSettings';

// Default shape so FE always receives a stable object
const DEFAULTS = {
  quickbooks_credentials: { clientId: '', clientSecret: '', realmId: '', refreshToken: '' },
  sms_gateway_config: { provider: 'custom', gatewayUrl: '', senderId: '', apiKey: '' },
  payment_gateway_config: { provider: 'manual', publicKey: '', secretKey: '', webhookSecret: '' },
  nida_gateway_config: { baseUrl: '', apiKey: '', enabled: false },
  developer_api_keys: { restApiKey: '', webhookSigningSecret: '' },
};

/**
 * @desc GET /api/settings/integration-settings
 */
const getIntegrationSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    const value = row?.value || {};
    res.status(200).json({ ...DEFAULTS, ...value });
  } catch (error) {
    console.error('❌ Error fetching integration settings:', error);
    res.status(500).json({ message: 'Failed to fetch integration settings' });
  }
};

/**
 * @desc PUT /api/settings/integration-settings
 * Accepts partial updates and merges into existing JSON.
 */
const updateIntegrationSettings = async (req, res) => {
  try {
    const existing = await Setting.findOne({ where: { key: KEY } });
    const currentValue = existing?.value || {};

    const next = {
      ...DEFAULTS,
      ...currentValue,
      ...req.body, // allow updating nested objects by key: { sms_gateway_config: { senderId: 'XYZ' } }
    };

    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Integration settings updated successfully', settings: next });
  } catch (error) {
    console.error('❌ Error updating integration settings:', error);
    res.status(500).json({ message: 'Failed to update integration settings' });
  }
};

module.exports = { getIntegrationSettings, updateIntegrationSettings };
