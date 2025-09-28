'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    const table = 'loans';
    // Rename columns that exist in camelCase
    const renames = [
      ['totalPaid', 'total_paid'],
      ['totalInterest', 'total_interest'],
      ['approvalDate', 'approval_date'],
      ['rejectionDate', 'rejection_date'],
      ['disbursementDate', 'disbursement_date'],
      ['closedBy', 'closed_by'],
      ['closedDate', 'closed_date'],
      ['initiatedBy', 'initiated_by'],
      ['approvedBy', 'approved_by'],
      ['rejectedBy', 'rejected_by'],
      ['disbursedBy', 'disbursed_by'],
      ['termMonths', 'term_months'],
      ['productId', 'product_id'],
    ];

    for (const [from, to] of renames) {
      // rename only if source exists and target does not
      // (Postgres doesn't support IF EXISTS on rename, so try/catch)
      try {
        await queryInterface.renameColumn(table, from, to);
      } catch (e) { /* ignore if already renamed */ }
    }
  },

  async down (queryInterface, Sequelize) {
    const table = 'loans';
    const renames = [
      ['total_paid', 'totalPaid'],
      ['total_interest', 'totalInterest'],
      ['approval_date', 'approvalDate'],
      ['rejection_date', 'rejectionDate'],
      ['disbursement_date', 'disbursementDate'],
      ['closed_by', 'closedBy'],
      ['closed_date', 'closedDate'],
      ['initiated_by', 'initiatedBy'],
      ['approved_by', 'approvedBy'],
      ['rejected_by', 'rejectedBy'],
      ['disbursed_by', 'disbursedBy'],
      ['term_months', 'termMonths'],
      ['product_id', 'productId'],
    ];

    for (const [from, to] of renames) {
      try {
        await queryInterface.renameColumn(table, from, to);
      } catch (e) { /* ignore if already reverted */ }
    }
  }
};
