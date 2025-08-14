const db = require('../../models');
const Setting = db.Setting;

const KEY = 'paymentSettings';

const DEFAULTS = {
  acceptedMethods: ['cash'], // ['cash','mobile','bank','card']
  mobileMoney: { enabled: false, provider: 'manual' },
  bankTransfer: { enabled: false, accounts: [] },
  cardGateway: { enabled: false, provider: 'manual', publicKey: '', secretKey: '' },
};

exports.getPaymentSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json({ ...DEFAULTS, ...(row?.value || {}) });
  } catch (error) {
    console.error('❌ Error fetching payment settings:', error);
    res.status(500).json({ message: 'Failed to fetch payment settings' });
  }
};

exports.updatePaymentSettings = async (req, res) => {
  try {
    const existing = await Setting.findOne({ where: { key: KEY } });
    const curr = existing?.value || {};
    const next = { ...DEFAULTS, ...curr, ...(req.body || {}) };

    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Payment settings updated successfully', settings: next });
  } catch (error) {
    console.error('❌ Error updating payment settings:', error);
    res.status(500).json({ message: 'Failed to update payment settings' });
  }
};
