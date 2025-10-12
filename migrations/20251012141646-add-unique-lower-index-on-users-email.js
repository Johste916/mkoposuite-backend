'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      await queryInterface.addIndex('Users', [Sequelize.literal('LOWER("email")')], {
        unique: true,
        name: 'users_email_lower_unique_idx',
      });
    } catch (e) {
      if (!/already exists/i.test(String(e && e.message))) throw e;
    }
  },
  async down(queryInterface) {
    try {
      await queryInterface.removeIndex('Users', 'users_email_lower_unique_idx');
    } catch {}
  },
};
