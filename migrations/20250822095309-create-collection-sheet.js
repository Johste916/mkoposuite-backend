'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('collection_sheets', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        // No DB default to avoid requiring uuid extensions.
        // Model-level default (UUIDV4) will handle app inserts.
      },

      date: { type: Sequelize.DATEONLY, allowNull: false },

      type: { type: Sequelize.STRING(32), allowNull: false }, // FIELD | OFFICE | AGENCY

      collector: { type: Sequelize.STRING(128), allowNull: true },
      loanOfficer: { type: Sequelize.STRING(128), allowNull: true },

      status: {
        type: Sequelize.ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },

      branchId: { type: Sequelize.UUID, allowNull: true },
      collectorId: { type: Sequelize.UUID, allowNull: true },
      loanOfficerId: { type: Sequelize.UUID, allowNull: true },

      createdBy: { type: Sequelize.STRING(64), allowNull: true },
      updatedBy: { type: Sequelize.STRING(64), allowNull: true },

      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    // Helpful indexes
    await queryInterface.addIndex('collection_sheets', ['date']);
    await queryInterface.addIndex('collection_sheets', ['status']);
    await queryInterface.addIndex('collection_sheets', ['type']);
    await queryInterface.addIndex('collection_sheets', ['collector']);
    await queryInterface.addIndex('collection_sheets', ['loanOfficer']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('collection_sheets');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_collection_sheets_status";');
  },
};
