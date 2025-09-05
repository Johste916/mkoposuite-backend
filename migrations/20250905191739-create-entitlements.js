'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('entitlements', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()')
      },
      key: {
        type: Sequelize.STRING(120),
        allowNull: false,
        unique: true
      },
      label: {
        type: Sequelize.STRING(160),
        allowNull: true
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });
    await queryInterface.addIndex('entitlements', ['key'], { unique: true, name: 'entitlements_key_uindex' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('entitlements');
  }
};
