'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await Promise.all([
      queryInterface.addColumn('loans', 'currency', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'TZS',
      }),
      queryInterface.addColumn('loans', 'approvalComments', {
        type: Sequelize.TEXT,
        allowNull: true,
      }),
      queryInterface.addColumn('loans', 'rejectedBy', {
        type: Sequelize.INTEGER,
        allowNull: true,
      }),
      queryInterface.addColumn('loans', 'rejectionDate', {
        type: Sequelize.DATE,
        allowNull: true,
      }),
      queryInterface.addColumn('loans', 'rejectionComments', {
        type: Sequelize.TEXT,
        allowNull: true,
      }),
      queryInterface.addColumn('loans', 'branchId', {
        type: Sequelize.INTEGER,
        allowNull: true,
      }),
      queryInterface.addColumn('loans', 'initiatedBy', {
        type: Sequelize.INTEGER,
        allowNull: true,
      }),
    ]);
  },

  async down(queryInterface, Sequelize) {
    await Promise.all([
      queryInterface.removeColumn('loans', 'currency'),
      queryInterface.removeColumn('loans', 'approvalComments'),
      queryInterface.removeColumn('loans', 'rejectedBy'),
      queryInterface.removeColumn('loans', 'rejectionDate'),
      queryInterface.removeColumn('loans', 'rejectionComments'),
      queryInterface.removeColumn('loans', 'branchId'),
      queryInterface.removeColumn('loans', 'initiatedBy'),
    ]);
  },
};
