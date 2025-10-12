'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create unique index on LOWER(email) to enforce case-insensitive uniqueness
    try {
      await queryInterface.addIndex('Users', [Sequelize.literal('LOWER("email")')], {
        unique: true,
        name: 'users_email_lower_unique_idx',
      });
    } catch (e) {
      // If it already exists, ignore
      if (!/already exists/i.test(String(e && e.message))) throw e;
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeIndex('Users', 'users_email_lower_unique_idx');
    } catch (e) {
      // ignore if missing
    }
  },
};
