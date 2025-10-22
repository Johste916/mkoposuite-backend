// migrations/XXXXXXXXXXXX-create-branches.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create the CamelCase "Branches" table used by your live DB
    const table = 'Branches';

    // If it already exists, do nothing (helps on environments where table is present)
    const [existing] = await queryInterface.sequelize.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='${table}'
      LIMIT 1
    `).catch(() => [null]);
    if (existing && existing.length) return;

    await queryInterface.createTable(table, {
      id:        { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name:      { type: Sequelize.STRING, allowNull: false },

      // Optional extras for new installs; harmless if you keep model minimal
      // code:      { type: Sequelize.STRING, allowNull: true },
      // phone:     { type: Sequelize.STRING, allowNull: true },
      // address:   { type: Sequelize.TEXT,   allowNull: true },

      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('Branches');
  },
};
