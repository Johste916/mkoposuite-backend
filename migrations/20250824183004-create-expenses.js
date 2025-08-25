'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, DATEONLY, STRING, TEXT, DECIMAL, ENUM } = Sequelize;

    await queryInterface.createTable(
      { tableName: 'expenses', schema: 'public' },
      {
        id:         { type: UUID, primaryKey: true, defaultValue: UUIDV4 },
        tenantId:   { type: UUID, allowNull: false },
        branchId:   { type: UUID, allowNull: true },

        date:       { type: DATEONLY, allowNull: false },
        type:       { type: STRING, allowNull: true },
        vendor:     { type: STRING, allowNull: true },
        reference:  { type: STRING, allowNull: true },
        amount:     { type: DECIMAL(18,2), allowNull: false },
        note:       { type: TEXT, allowNull: true },

        status:     { type: ENUM('POSTED', 'VOID'), allowNull: false, defaultValue: 'POSTED' },

        createdBy:  { type: UUID, allowNull: true },
        updatedBy:  { type: UUID, allowNull: true },

        createdAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updatedAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      }
    );

    await queryInterface.addIndex({ tableName: 'expenses', schema: 'public' }, ['tenantId']);
    await queryInterface.addIndex({ tableName: 'expenses', schema: 'public' }, ['tenantId', 'date']);
    await queryInterface.addIndex({ tableName: 'expenses', schema: 'public' }, ['tenantId', 'branchId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable({ tableName: 'expenses', schema: 'public' });
  }
};
