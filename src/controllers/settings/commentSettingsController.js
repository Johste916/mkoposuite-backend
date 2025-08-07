const db = require('../../models');
const Setting = db.Setting;

const COMMENT_SETTINGS_KEY = 'commentSettings';

/**
 * @desc    Get Comment Settings
 * @route   GET /api/settings/comment-settings
 * @access  Private
 */
const getCommentSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: COMMENT_SETTINGS_KEY } });

    res.status(200).json(setting?.value || {});
  } catch (error) {
    console.error('❌ Error fetching comment settings:', error);
    res.status(500).json({ message: 'Failed to fetch comment settings' });
  }
};

/**
 * @desc    Update Comment Settings
 * @route   PUT /api/settings/comment-settings
 * @access  Private
 */
const updateCommentSettings = async (req, res) => {
  try {
    const [updated] = await Setting.upsert({
      key: COMMENT_SETTINGS_KEY,
      value: req.body
    });

    res.status(200).json({
      message: 'Comment settings updated successfully',
      settings: updated?.value || req.body
    });
  } catch (error) {
    console.error('❌ Error updating comment settings:', error);
    res.status(500).json({ message: 'Failed to update comment settings' });
  }
};

module.exports = {
  getCommentSettings,
  updateCommentSettings
};
