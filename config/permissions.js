// src/config/permissions.js

module.exports = {
  // Loan lifecycle
  approveLoan:       ["Admin", "BranchManager", "Director"],
  rejectLoan:        ["Admin", "BranchManager", "Director"],
  disburseLoan:      ["Admin", "Accountant", "BranchManager"],
  closeLoan:         ["Admin", "BranchManager", "Director"],
  rescheduleLoan:    ["Admin", "BranchManager"],

  // Repayments
  createRepayment:   ["Admin", "LoanOfficer", "Accountant", "BranchManager"],
  reverseRepayment:  ["Admin", "Accountant"],

  // Loan creation & editing
  createLoan:        ["Admin", "LoanOfficer", "BranchManager"],
  editLoan:          ["Admin", "LoanOfficer", "BranchManager"],

  // Reports
  viewReports:       ["Admin", "Accountant", "BranchManager", "HR"],

  // Disbursement batches
  createDisbursementBatch: ["Admin", "Accountant", "BranchManager"],
  exportDisbursementBatch: ["Admin", "Accountant"],

  // Borrower management
  createBorrower:    ["Admin", "CustomerService", "LoanOfficer", "BranchManager"],
  editBorrower:      ["Admin", "CustomerService", "LoanOfficer", "BranchManager"],

  // HR-specific
  manageEmployees:   ["Admin", "HR"],

  // Settings
  manageSettings:    ["Admin"],

  // Import/Export data
  bulkImport:        ["Admin", "Accountant", "BranchManager"],

  // Comments & Audit
  addComment:        ["Admin", "LoanOfficer", "CustomerService", "BranchManager"],
  viewAuditLog:      ["Admin", "Accountant", "BranchManager", "HR"]
};
