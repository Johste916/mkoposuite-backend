// backend/migrations/20250912000000-create-banks.js
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('banks', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      tenantId: { type: Sequelize.UUID, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING },
      branch: { type: Sequelize.STRING },
      accountName: { type: Sequelize.STRING },
      accountNumber: { type: Sequelize.STRING },
      swift: { type: Sequelize.STRING },
      phone: { type: Sequelize.STRING },
      address: { type: Sequelize.TEXT },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex('banks', ['tenantId']);
    await queryInterface.addIndex('banks', ['tenantId', 'name']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('banks');
  }
};
