"use strict";

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    const permissionsData = [
      { action: "approveLoan", roles: ["Admin", "BranchManager", "Director"] },
      { action: "rejectLoan", roles: ["Admin", "BranchManager", "Director"] },
      { action: "disburseLoan", roles: ["Admin", "Accountant", "BranchManager"] },
      { action: "closeLoan", roles: ["Admin", "BranchManager", "Director"] },
      { action: "rescheduleLoan", roles: ["Admin", "BranchManager"] },
      { action: "createRepayment", roles: ["Admin", "LoanOfficer", "Accountant", "BranchManager"] },
      { action: "reverseRepayment", roles: ["Admin", "Accountant"] },
      { action: "createLoan", roles: ["Admin", "LoanOfficer", "BranchManager"] },
      { action: "editLoan", roles: ["Admin", "LoanOfficer", "BranchManager"] },
      { action: "viewReports", roles: ["Admin", "Accountant", "BranchManager", "HR"] },
      { action: "createDisbursementBatch", roles: ["Admin", "Accountant", "BranchManager"] },
      { action: "exportDisbursementBatch", roles: ["Admin", "Accountant"] },
      { action: "createBorrower", roles: ["Admin", "CustomerService", "LoanOfficer", "BranchManager"] },
      { action: "editBorrower", roles: ["Admin", "CustomerService", "LoanOfficer", "BranchManager"] },
      { action: "manageEmployees", roles: ["Admin", "HR"] },
      { action: "manageSettings", roles: ["Admin"] },
      { action: "bulkImport", roles: ["Admin", "Accountant", "BranchManager"] },
      { action: "addComment", roles: ["Admin", "LoanOfficer", "CustomerService", "BranchManager"] },
      { action: "viewAuditLog", roles: ["Admin", "Accountant", "BranchManager", "HR"] }
    ];

    for (const perm of permissionsData) {
      const existing = await queryInterface.sequelize.query(
        `SELECT id FROM permissions WHERE action = :action`,
        { replacements: { action: perm.action }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );

      if (existing.length > 0) {
        // Update existing row
        await queryInterface.bulkUpdate(
          "permissions",
          { roles: JSON.stringify(perm.roles), updatedAt: now },
          { action: perm.action }
        );
      } else {
        // Insert new row
        await queryInterface.bulkInsert("permissions", [
          { action: perm.action, roles: JSON.stringify(perm.roles), createdAt: now, updatedAt: now }
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("permissions", null, {});
  }
};
