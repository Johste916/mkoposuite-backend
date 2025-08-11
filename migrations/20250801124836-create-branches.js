'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('branches', { // ✅ lowercase matches model
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING, allowNull: false, unique: true }, // matches your model
      location: { type: Sequelize.STRING },
      manager: { type: Sequelize.STRING }, // matches your model
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('branches');
  },
};
