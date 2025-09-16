// migrations/XXXXXXXXXXXX-create-branches.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('branches', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false },
      // keep string so "001" is valid and we avoid integer casting issues
      code: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING, allowNull: true },
      address: { type: Sequelize.TEXT, allowNull: true },
      // keep your historical fields
      location: { type: Sequelize.STRING, allowNull: true },
      manager: { type: Sequelize.STRING, allowNull: true },

      // optional multi-tenant col (nullable, so it won’t break single-tenant)
      tenant_id: { type: Sequelize.UUID, allowNull: true },

      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },

      // support paranoid model without breaking if unused
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    // Helpful indexes (not required)
    await queryInterface.addIndex('branches', ['tenant_id']);
    await queryInterface.addIndex('branches', ['code']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('branches');
  },
};
