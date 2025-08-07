const db = require('../../models');
const Setting = db.Setting;

// Prefix used for all user management related keys
const USER_KEY_PREFIX = 'userManagement';

const USER_KEYS = [
  'defaultRole',
  'roleApprovalRequired',
  'allowMultipleBranchAccess',
  'accountLockThreshold'
];

/**
 * @desc    Get user management settings
 * @route   GET /api/settings/user-management
 * @access  Private
 */
const getUsers = async (req, res) => {
  try {
    const keys = USER_KEYS.map(k => `${USER_KEY_PREFIX}_${k}`);

    const settings = await Setting.findAll({
      where: { key: keys }
    });

    const response = {};
    USER_KEYS.forEach(k => {
      const fullKey = `${USER_KEY_PREFIX}_${k}`;
      const found = settings.find(s => s.key === fullKey);
      response[k] = found ? found.value : null;
    });

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Error fetching user management settings:', error);
    res.status(500).json({ message: 'Failed to fetch user management settings', error: error.message });
  }
};

/**
 * @desc    Update user management settings
 * @route   PUT /api/settings/user-management
 * @access  Private
 */
const updateUser = async (req, res) => {
  try {
    const updates = req.body;

    const operations = USER_KEYS
      .filter(key => Object.prototype.hasOwnProperty.call(updates, key))
      .map(key => {
        const fullKey = `${USER_KEY_PREFIX}_${key}`;
        return Setting.upsert({
          key: fullKey,
          value: updates[key]
        });
      });

    await Promise.all(operations);

    res.status(200).json({ message: 'User management settings updated successfully' });
  } catch (error) {
    console.error('❌ Error updating user management settings:', error);
    res.status(500).json({ message: 'Failed to update user management settings', error: error.message });
  }
};

module.exports = {
  getUsers,
  updateUser
};
