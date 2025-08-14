const db = require('../../models');
const Setting = db.Setting;

const KEY = 'bulkSmsSettings';

/**
 * @desc GET /api/settings/bulk-sms-settings
 */
const getBulkSmsSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    const val = row?.value || {};
    res.status(200).json(val);
  } catch (err) {
    console.error('❌ Error fetching Bulk SMS settings:', err);
    res.status(500).json({ message: 'Failed to fetch Bulk SMS settings', error: err.message });
  }
};

/**
 * @desc PUT /api/settings/bulk-sms-settings
 */
const updateBulkSmsSettings = async (req, res) => {
  try {
    const existing = await Setting.findOne({ where: { key: KEY } });
    const curr = existing?.value || {};

    const next = {
      gatewayUrl: req.body.gatewayUrl ?? curr.gatewayUrl ?? '',
      senderId: req.body.senderId ?? curr.senderId ?? '',
      apiKey: req.body.apiKey ?? curr.apiKey ?? '',
      enableSmsNotifications: !!(req.body.enableSmsNotifications ?? curr.enableSmsNotifications ?? false),
      messageTemplate: req.body.messageTemplate ?? curr.messageTemplate ?? '',
    };

    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Bulk SMS settings updated successfully', settings: next });
  } catch (err) {
    console.error('❌ Error updating Bulk SMS settings:', err);
    res.status(500).json({ message: 'Failed to update Bulk SMS settings', error: err.message });
  }
};

module.exports = { getBulkSmsSettings, updateBulkSmsSettings };
