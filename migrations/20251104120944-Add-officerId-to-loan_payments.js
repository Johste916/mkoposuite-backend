// migrations/20251104-Add-officerId-to-loan_payments.js
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      { tableName: 'loan_payments', schema: 'public' },
      'officerId',
      { type: Sequelize.UUID, allowNull: true }
    );

    // Optional FK if your users.id is UUID and in the same schema/table
    // (uncomment if you want the constraint)
    // await queryInterface.addConstraint(
    //   { tableName: 'loan_payments', schema: 'public' },
    //   {
    //     fields: ['officerId'],
    //     type: 'foreign key',
    //     name: 'fk_loan_payments_officerId_users_id',
    //     references: { table: { tableName: 'users', schema: 'public' }, field: 'id' },
    //     onUpdate: 'CASCADE',
    //     onDelete: 'SET NULL',
    //   }
    // );

    await queryInterface.addIndex(
      { tableName: 'loan_payments', schema: 'public' },
      ['officerId'],
      { name: 'loan_payments_officerId_idx' }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      { tableName: 'loan_payments', schema: 'public' },
      'loan_payments_officerId_idx'
    );

    // If you added the FK constraint above, remove it here first
    // await queryInterface.removeConstraint(
    //   { tableName: 'loan_payments', schema: 'public' },
    //   'fk_loan_payments_officerId_users_id'
    // );

    await queryInterface.removeColumn(
      { tableName: 'loan_payments', schema: 'public' },
      'officerId'
    );
  },
};
