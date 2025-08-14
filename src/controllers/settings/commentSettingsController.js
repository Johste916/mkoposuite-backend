const db = require('../../models');
const Setting = db.Setting;

const KEY = 'commentSettings';

/**
 * @desc GET /api/settings/comment-settings
 */
const getCommentSettings = async (_req, res) => {
  try {
    const row = await Setting.findOne({ where: { key: KEY } });
    res.status(200).json(row?.value || {});
  } catch (error) {
    console.error('❌ Error fetching comment settings:', error);
    res.status(500).json({ message: 'Failed to fetch comment settings' });
  }
};

/**
 * @desc PUT /api/settings/comment-settings
 * body: arbitrary fields for UI toggles/length limits/moderation flags
 */
const updateCommentSettings = async (req, res) => {
  try {
    const existing = await Setting.findOne({ where: { key: KEY } });
    const next = { ...(existing?.value || {}), ...(req.body || {}) };

    await Setting.upsert({ key: KEY, value: next, updatedBy: req.user?.id || null });
    res.status(200).json({ message: 'Comment settings updated successfully', settings: next });
  } catch (error) {
    console.error('❌ Error updating comment settings:', error);
    res.status(500).json({ message: 'Failed to update comment settings' });
  }
};

module.exports = { getCommentSettings, updateCommentSettings };
