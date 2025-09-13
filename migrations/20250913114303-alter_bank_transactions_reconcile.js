'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn({ tableName: 'bank_transactions', schema: 'public' }, 'bankRef',     { type: Sequelize.STRING(120), allowNull: true });
    await queryInterface.addColumn({ tableName: 'bank_transactions', schema: 'public' }, 'note',        { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn({ tableName: 'bank_transactions', schema: 'public' }, 'reconciled',  { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await queryInterface.addColumn({ tableName: 'bank_transactions', schema: 'public' }, 'reconciledAt',{ type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn({ tableName: 'bank_transactions', schema: 'public' }, 'reconciledBy',{ type: Sequelize.UUID, allowNull: true });

    await queryInterface.addIndex({ tableName: 'bank_transactions', schema: 'public' }, ['reconciled']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex({ tableName: 'bank_transactions', schema: 'public' }, ['reconciled']);
    await queryInterface.removeColumn({ tableName: 'bank_transactions', schema: 'public' }, 'reconciledBy');
    await queryInterface.removeColumn({ tableName: 'bank_transactions', schema: 'public' }, 'reconciledAt');
    await queryInterface.removeColumn({ tableName: 'bank_transactions', schema: 'public' }, 'reconciled');
    await queryInterface.removeColumn({ tableName: 'bank_transactions', schema: 'public' }, 'note');
    await queryInterface.removeColumn({ tableName: 'bank_transactions', schema: 'public' }, 'bankRef');
  }
};
