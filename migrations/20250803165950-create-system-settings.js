'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('SystemSettings', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      companyName: { type: Sequelize.STRING, allowNull: false },
      systemEmail: { type: Sequelize.STRING },
      supportPhone: { type: Sequelize.STRING },
      currency: { type: Sequelize.STRING, defaultValue: 'TZS' },
      logoUrl: { type: Sequelize.STRING },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('SystemSettings');
  },
};
