'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Loans', 'repaymentMethod', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'flat' // can be 'flat' or 'reducing'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Loans', 'repaymentMethod');
  }
};
