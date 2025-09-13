'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      { tableName: 'banks', schema: 'public' },
      {
        id: {
          type: Sequelize.UUID,
          allowNull: false,
          primaryKey: true,
          // no DB-side default; model generates UUID (no extension needed)
        },
        tenantId: {
          type: Sequelize.UUID,
          allowNull: true,
        },
        name: {
          type: Sequelize.STRING(120),
          allowNull: false,
        },
        code: {
          type: Sequelize.STRING(32),
          allowNull: true,
        },
        branch: {
          type: Sequelize.STRING(120),
          allowNull: true,
        },
        accountName: {
          type: Sequelize.STRING(180),
          allowNull: true,
        },
        accountNumber: {
          type: Sequelize.STRING(64),
          allowNull: false,
        },
        swift: {
          type: Sequelize.STRING(64),
          allowNull: true,
        },
        phone: {
          type: Sequelize.STRING(40),
          allowNull: true,
        },
        address: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        isActive: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.fn('NOW'),
        },
      },
      { logging: false }
    );

    await queryInterface.addIndex({ tableName: 'banks', schema: 'public' }, ['tenantId']);
    await queryInterface.addIndex({ tableName: 'banks', schema: 'public' }, ['code']);
    await queryInterface.addConstraint({ tableName: 'banks', schema: 'public' }, {
      type: 'unique',
      fields: ['tenantId', 'accountNumber'],
      name: 'banks_tenant_account_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'banks', schema: 'public' });
  }
};
