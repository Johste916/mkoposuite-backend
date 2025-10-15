// migrations/20251015-add-loan-officer-id-to-borrowers.js
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const desc = await queryInterface.describeTable('Borrowers');

    if (!desc.loan_officer_id && !desc.loanOfficerId) {
      await queryInterface.addColumn('Borrowers', 'loan_officer_id', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    // If you previously had camelCase and want to standardize:
    if (desc.loanOfficerId && !desc.loan_officer_id) {
      await queryInterface.renameColumn('Borrowers', 'loanOfficerId', 'loan_officer_id');
    }

    // (Optional) foreign key to Users
    // await queryInterface.addConstraint('Borrowers', {
    //   fields: ['loan_officer_id'],
    //   type: 'foreign key',
    //   name: 'fk_borrowers_loan_officer',
    //   references: { table: 'Users', field: 'id' },
    //   onUpdate: 'CASCADE',
    //   onDelete: 'SET NULL',
    // });
  },

  down: async (queryInterface) => {
    // drop FK first if you added it
    // await queryInterface.removeConstraint('Borrowers', 'fk_borrowers_loan_officer');
    await queryInterface.removeColumn('Borrowers', 'loan_officer_id').catch(() => {});
  },
};
