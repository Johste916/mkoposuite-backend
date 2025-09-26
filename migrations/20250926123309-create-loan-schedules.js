'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'loan_schedules';
    const exist = await queryInterface.sequelize.query(
      "SELECT to_regclass('public.loan_schedules') as reg;"
    );
    const reg = exist?.[0]?.[0]?.reg;
    if (reg) return; // already exists

    await queryInterface.createTable(table, {
      id:         { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      loanId:     { type: Sequelize.INTEGER, allowNull: false },
      period:     { type: Sequelize.INTEGER, allowNull: false },
      dueDate:    { type: Sequelize.DATEONLY, allowNull: false },
      principal:  { type: Sequelize.DECIMAL(14,2), allowNull: false, defaultValue: 0 },
      interest:   { type: Sequelize.DECIMAL(14,2), allowNull: false, defaultValue: 0 },
      fees:       { type: Sequelize.DECIMAL(14,2), allowNull: false, defaultValue: 0 },
      penalties:  { type: Sequelize.DECIMAL(14,2), allowNull: false, defaultValue: 0 },
      total:      { type: Sequelize.DECIMAL(14,2), allowNull: false, defaultValue: 0 },
      createdAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt:  { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    await queryInterface.addIndex(table, ['loanId']);
    await queryInterface.addIndex(table, ['loanId', 'period'], { unique: true, name: 'loan_schedules_loan_period_uniq' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('loan_schedules');
  },
};
