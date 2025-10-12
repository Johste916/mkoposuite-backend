'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable('Users');
    if (!desc.status) {
      await queryInterface.addColumn('Users', 'status', {
        type: Sequelize.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      });
    }
  },
  async down(queryInterface) {
    const desc = await queryInterface.describeTable('Users');
    if (desc.status) {
      await queryInterface.removeColumn('Users', 'status');
      if (queryInterface.sequelize.getDialect() === 'postgres') {
        await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Users_status";');
      }
    }
  },
};
