'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); // for gen_random_uuid

    await queryInterface.createTable('collaterals', {
      id:          { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },

      borrowerId:  { type: Sequelize.UUID, allowNull: true }, // no FK to avoid cross-env type mismatch
      loanId:      { type: Sequelize.UUID, allowNull: true },

      itemName:     { type: Sequelize.STRING,  allowNull: false },
      category:     { type: Sequelize.STRING,  allowNull: true  },
      model:        { type: Sequelize.STRING,  allowNull: true  },
      serialNumber: { type: Sequelize.STRING,  allowNull: true  },
      estValue:     { type: Sequelize.DECIMAL(18,2), allowNull: true },

      status: { type: Sequelize.ENUM('ACTIVE', 'RELEASED', 'DISPOSED'), allowNull: false, defaultValue: 'ACTIVE' },

      location: { type: Sequelize.STRING, allowNull: true },
      notes:    { type: Sequelize.TEXT,   allowNull: true },

      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },

      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('collaterals');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_collaterals_status";');
  }
};
