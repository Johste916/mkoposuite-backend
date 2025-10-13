"use strict";

/**
 * Master catalog of all app permissions.
 * Keep this as the single source of truth.
 *
 * NOTE: We use simple (group) + (actions[{key,label}]) so the existing UI works.
 * To make sections, we prefix the group with "Dashboard · Widgets", etc.
 */
module.exports = [
  /* ------------------------------- Dashboard ------------------------------ */
  { group: "Dashboard · Page", actions: [
    { key: "dashboard.view", label: "Visit Dashboard" },
  ]},
  { group: "Dashboard · Filters & Controls", actions: [
    { key: "dashboard.filters.branch.use", label: "Use Branch Filter" },
    { key: "dashboard.filters.officer.use", label: "Use Officer Filter" },
    { key: "dashboard.filters.time_range.use", label: "Use Time Range Filter" },
    { key: "dashboard.refresh", label: "Manual Refresh" },
    { key: "dashboard.auto_refresh", label: "Allow Auto Refresh" },
  ]},
  { group: "Dashboard · Quick Actions", actions: [
    { key: "loans.applications.create", label: "Add Loan" },
    { key: "borrowers.create", label: "Add Borrower" },
    { key: "repayments.create", label: "Record Repayment" },
  ]},
  { group: "Dashboard · Widgets", actions: [
    { key: "dashboard.widget.total_borrowers.view", label: "Total Borrowers" },
    { key: "dashboard.widget.total_loans.view", label: "Total Loans" },
    { key: "dashboard.widget.total_disbursed.view", label: "Total Disbursed" },
    { key: "dashboard.widget.total_paid.view", label: "Total Paid" },
    { key: "dashboard.widget.total_repaid.view", label: "Total Repaid" },
    { key: "dashboard.widget.expected_repayments.view", label: "Expected Repayments" },
    { key: "dashboard.widget.total_deposits.view", label: "Total Deposits" },
    { key: "dashboard.widget.total_withdrawals.view", label: "Total Withdrawals" },
    { key: "dashboard.widget.net_savings.view", label: "Net Savings" },
    { key: "dashboard.widget.defaulted_loan.view", label: "Defaulted Loan" },
    { key: "dashboard.widget.defaulted_interest.view", label: "Defaulted Interest" },
    { key: "dashboard.widget.outstanding_loan.view", label: "Outstanding Loan" },
    { key: "dashboard.widget.outstanding_interest.view", label: "Outstanding Interest" },
    { key: "dashboard.widget.written_off.view", label: "Written Off" },
    { key: "dashboard.widget.par.view", label: "PAR" },
    { key: "dashboard.widget.trends.view", label: "Monthly Trends Chart" },
    { key: "dashboard.widget.branch_performance.view", label: "Branch Performance" },
    { key: "dashboard.widget.officer_performance.view", label: "Officer Performance" },
    { key: "dashboard.widget.communications.view", label: "Comms Ribbon" },
  ]},

  /* ------------------------------ Sidebar: Borrowers --------------------- */
  { group: "Sidebar · Borrowers", actions: [
    { key: "borrowers.view", label: "View Borrowers" },
    { key: "borrowers.create", label: "Add Borrower" },
    { key: "borrowers.kyc.review", label: "KYC Queue" },
    { key: "borrowers.blacklist.manage", label: "Blacklist" },
    { key: "borrowers.import", label: "Imports" },
    { key: "borrowers.reports.view", label: "Reports" },
    { key: "borrowers.groups.view", label: "View Borrower Groups" },
    { key: "borrowers.groups.create", label: "Add Borrower Group" },
    { key: "borrowers.groups.reports.view", label: "Group Reports" },
    { key: "borrowers.groups.import", label: "Group Imports" },
    { key: "borrowers.message.sms.send", label: "Send SMS to All" },
    { key: "borrowers.message.email.send", label: "Send Email to All" },
    { key: "borrowers.invite.send", label: "Invite Borrowers" },
  ]},

  /* -------------------------------- Sidebar: Loans ----------------------- */
  { group: "Sidebar · Loans", actions: [
    { key: "loans.products.view", label: "Loan Products (View)" },
    { key: "loans.products.manage", label: "Loan Products (Create/Edit)" },
    { key: "loans.view", label: "View All Loans" },
    { key: "loans.applications.create", label: "Add Loan (Applications)" },
    { key: "loans.review", label: "Review Queue" },
    { key: "loans.disburse", label: "Disbursement Queue / Disburse" },
    { key: "loans.status.disbursed.view", label: "Disbursed Loans" },
    { key: "loans.status.due.view", label: "Due Loans" },
    { key: "loans.status.missed.view", label: "Missed Repayments" },
    { key: "loans.status.arrears.view", label: "Loans in Arrears" },
    { key: "loans.status.no_repayments.view", label: "No Repayments" },
    { key: "loans.status.past_maturity.view", label: "Past Maturity Date" },
    { key: "loans.status.principal_outstanding.view", label: "Principal Outstanding" },
    { key: "loans.status.1_month_late.view", label: "1 Month Late" },
    { key: "loans.status.3_months_late.view", label: "3 Months Late" },
  ]},
  { group: "Loan · Detail Actions", actions: [
    { key: "loans.update", label: "Update Loan" },
    { key: "loans.delete", label: "Delete Loan" },
    { key: "loans.disable", label: "Disable Loan" },
    { key: "loans.approve", label: "Approve Loan" },
    { key: "loans.disburse", label: "Disburse Loan" },
    { key: "loans.schedule.calculate", label: "Calculate Schedule" },
    { key: "loans.fees.manage", label: "Manage Fees" },
  ]},

  /* ------------------------------- Repayments ---------------------------- */
  { group: "Sidebar · Repayments", actions: [
    { key: "repayments.view", label: "View Repayments" },
    { key: "repayments.create", label: "Record Repayment" },
    { key: "repayments.receipts.view", label: "Receipts" },
    { key: "repayments.bulk_upload", label: "Add Bulk Repayments" },
    { key: "repayments.csv_upload", label: "Add via CSV" },
    { key: "repayments.charts.view", label: "Repayment Charts" },
    { key: "repayments.approve", label: "Approve Repayments" },
  ]},

  /* -------------------------------- Collateral --------------------------- */
  { group: "Sidebar · Collateral", actions: [
    { key: "collateral.view", label: "View Collateral" },
    { key: "collateral.create", label: "Create Collateral" },
    { key: "collateral.update", label: "Update Collateral" },
    { key: "collateral.delete", label: "Delete Collateral" },
    { key: "collateral.disable", label: "Disable Collateral" },
  ]},

  /* --------------------------- Collection Sheets ------------------------- */
  { group: "Sidebar · Collection Sheets", actions: [
    { key: "collections.daily.view", label: "Daily Collection Sheet" },
    { key: "collections.missed.view", label: "Missed Repayment Sheet" },
    { key: "collections.past_maturity.view", label: "Past Maturity Loans" },
    { key: "collections.sms.send", label: "Send SMS" },
    { key: "collections.email.send", label: "Send Email" },
  ]},

  /* --------------------------------- Savings ----------------------------- */
  { group: "Sidebar · Savings", actions: [
    { key: "savings.view", label: "View Savings" },
    { key: "savings.tx.view", label: "Transactions" },
    { key: "savings.tx.csv_upload", label: "Upload CSV" },
    { key: "savings.tx.approve", label: "Approve Transactions" },
    { key: "savings.report.view", label: "Savings Report" },
  ]},

  /* ------------------------ Banking (Banks + Cash) ----------------------- */
  { group: "Sidebar · Banking · Banks", actions: [
    { key: "banks.view", label: "View Banks" },
    { key: "banks.create", label: "Add Bank" },
    { key: "banks.tx.view", label: "View Bank Transactions" },
    { key: "banks.transfers.create", label: "Transfers" },
    { key: "banks.reconciliation.manage", label: "Reconciliation" },
    { key: "banks.statements.view", label: "Statements" },
    { key: "banks.tx.csv_import", label: "Import Bank CSV" },
    { key: "banks.approvals.manage", label: "Approvals" },
    { key: "banks.rules.manage", label: "Rules & GL Mapping" },
  ]},
  { group: "Sidebar · Banking · Cash", actions: [
    { key: "cash.accounts.view", label: "Cash Accounts" },
    { key: "cash.accounts.create", label: "Add Cash Account" },
    { key: "cash.tx.view", label: "View Cash Transactions" },
    { key: "cash.tx.create", label: "Add Cash Transaction" },
    { key: "cash.reconciliation.manage", label: "Cash Reconciliation" },
    { key: "cash.statements.view", label: "Cash Statement" },
  ]},

  /* -------------------------------- Investors ---------------------------- */
  { group: "Sidebar · Investors", actions: [
    { key: "investors.view", label: "View Investors" },
    { key: "investors.create", label: "Add Investor" },
    { key: "investors.update", label: "Update Investor" },
    { key: "investors.delete", label: "Delete Investor" },
  ]},

  /* ----------------------------- HR & Payroll ---------------------------- */
  { group: "Sidebar · HR & Payroll", actions: [
    { key: "payroll.view", label: "View Payroll" },
    { key: "payroll.create", label: "Add Payroll" },
    { key: "payroll.report.view", label: "Payroll Report" },
    { key: "hr.employees.view", label: "Employees" },
    { key: "hr.attendance.view", label: "Attendance" },
    { key: "hr.leave.manage", label: "Leave Management (Manage)" },
    { key: "hr.leave.view", label: "Leave (View Only)" },
    { key: "hr.contracts.manage", label: "Contracts (Manage)" },
    { key: "hr.contracts.view", label: "Contracts (View Only)" },
  ]},

  /* -------------------------- Expenses & Other Income -------------------- */
  { group: "Sidebar · Expenses", actions: [
    { key: "expenses.view", label: "View Expenses" },
    { key: "expenses.create", label: "Add Expense" },
    { key: "expenses.csv_upload", label: "Upload CSV" },
    { key: "expenses.update", label: "Update (inside)" },
    { key: "expenses.delete", label: "Delete (inside)" },
    { key: "expenses.export", label: "Export (inside)" },
  ]},
  { group: "Sidebar · Other Income", actions: [
    { key: "other_income.view", label: "View Other Income" },
    { key: "other_income.create", label: "Add Other Income" },
    { key: "other_income.csv_upload", label: "Upload CSV" },
    { key: "other_income.update", label: "Update (inside)" },
    { key: "other_income.delete", label: "Delete (inside)" },
    { key: "other_income.export", label: "Export (inside)" },
  ]},

  /* ------------------------------- Assets -------------------------------- */
  { group: "Sidebar · Asset Management", actions: [
    { key: "assets.view", label: "View Assets" },
    { key: "assets.create", label: "Add Asset" },
    { key: "assets.update", label: "Update (inside)" },
    { key: "assets.delete", label: "Delete (inside)" },
    { key: "assets.disable", label: "Disable (inside)" },
  ]},

  /* ------------------------------ Accounting ----------------------------- */
  { group: "Sidebar · Accounting", actions: [
    { key: "accounting.coa.view", label: "Chart Of Accounts (View)" },
    { key: "accounting.coa.manage", label: "Chart Of Accounts (Manage)" },
    { key: "accounting.trial_balance.view", label: "Trial Balance" },
    { key: "accounting.pnl.view", label: "Profit & Loss" },
    { key: "accounting.cashflow.view", label: "Cashflow" },
    { key: "accounting.journal.post", label: "Manual Journal (Post)" },
    { key: "accounting.journal.manage", label: "Manual Journal (Manage)" },
  ]},

  /* --------------------------- User Management --------------------------- */
  { group: "Sidebar · User Management", actions: [
    { key: "user_mgmt.view", label: "Staff (Overview)" },
    { key: "users.view", label: "Users (View)" },
    { key: "users.create", label: "Users (Create)" },
    { key: "users.update", label: "Users (Update)" },
    { key: "users.delete", label: "Users (Delete)" },
    { key: "users.disable", label: "Users (Disable)" },
    { key: "roles.view", label: "Roles (View)" },
    { key: "roles.manage", label: "Roles (Manage)" },
    { key: "roles.assign", label: "Roles (Assign)" },
    { key: "permissions.view", label: "Permissions (View)" },
    { key: "permissions.assign", label: "Permissions (Assign)" },
  ]},

  /* -------------------------------- Branches ----------------------------- */
  { group: "Sidebar · Branches", actions: [
    { key: "branches.view", label: "View Branches" },
    { key: "branches.create", label: "Create Branch" },
    { key: "branches.update", label: "Update Branch" },
    { key: "branches.delete", label: "Delete Branch" },
    { key: "branches.disable", label: "Disable Branch" },
    { key: "branches.holidays.manage", label: "Manage Branch Holidays" },
  ]},

  /* -------------------------------- Reports ------------------------------ */
  { group: "Sidebar · Reports (General)", actions: [
    { key: "reports.view", label: "Reports (General Access)" },
  ]},
  { group: "Sidebar · Reports (Specific)", actions: [
    { key: "reports.borrowers.view", label: "Borrowers Report" },
    { key: "reports.loans.view", label: "Loans Report" },
    { key: "reports.arrears_aging.view", label: "Arrears Aging" },
    { key: "reports.collections.view", label: "Collections Report" },
    { key: "reports.collector.view", label: "Collector Report" },
    { key: "reports.deferred_income.view", label: "Deferred Income" },
    { key: "reports.deferred_income_monthly.view", label: "Deferred Income (Monthly)" },
    { key: "reports.pro_rata.view", label: "Pro-Rata" },
    { key: "reports.disbursement.view", label: "Disbursement Report" },
    { key: "reports.fees.view", label: "Fees Report" },
    { key: "reports.loan_officer.view", label: "Loan Officer Report" },
    { key: "reports.mfrs.view", label: "MFRS" },
    { key: "reports.daily.view", label: "Daily Report" },
    { key: "reports.monthly.view", label: "Monthly Report" },
    { key: "reports.outstanding.view", label: "Outstanding Report" },
    { key: "reports.par.view", label: "PAR" },
    { key: "reports.at_a_glance.view", label: "At a Glance" },
    { key: "reports.all_entries.view", label: "All Entries" },
  ]},

  /* -------------------------- Account & Tools (routes) ------------------- */
  { group: "Account & Tools", actions: [
    { key: "account.settings.view", label: "Account Settings (View)" },
    { key: "account.profile.view", label: "Profile (View)" },
    { key: "account.organization.manage", label: "Organization (Manage)" },
    { key: "billing.view", label: "Billing (View)" },
    { key: "billing.manage", label: "Billing (Manage)" },
    { key: "account.security.manage", label: "Security (Manage)" },
    { key: "subscription.manage", label: "Subscription (Manage)" },
    { key: "support_tickets.view", label: "Support Tickets (View)" },
    { key: "support_tickets.manage", label: "Support Tickets (Manage)" },
    { key: "sms_console.use", label: "SMS Console (Use)" },
    { key: "sms_center.use", label: "SMS Center (Use)" },
    { key: "billing.by_phone.use", label: "Billing by Phone (Use)" },
  ]},

  /* -------------------------------- Admin Hub ---------------------------- */
  { group: "Admin Hub", actions: [
    { key: "admin.view", label: "Admin Landing" },
    { key: "admin.settings.general.manage", label: "General Settings" },
    { key: "admin.settings.integrations.manage", label: "Integration Settings" },
    { key: "admin.settings.payment.manage", label: "Payment Settings" },
    { key: "admin.settings.dashboard.manage", label: "Dashboard Settings" },
    { key: "admin.settings.backup.manage", label: "Backup Settings" },
    { key: "admin.email.accounts.manage", label: "Email Accounts" },
    { key: "admin.email.templates.manage", label: "Email Templates" },
    { key: "admin.sms.settings.manage", label: "SMS Settings" },
    { key: "admin.sms.templates.manage", label: "SMS Templates" },
    { key: "admin.sms.bulk.manage", label: "Bulk SMS Settings" },
    { key: "admin.communications.manage", label: "Communications" },
    { key: "admin.notifications.staff.manage", label: "Staff Email Notifications" },
    { key: "admin.loans.products.manage", label: "Loan Products (Admin)" },
    { key: "admin.loans.settings.manage", label: "Loan Settings (Admin)" },
    { key: "admin.loans.penalties.manage", label: "Loan Penalty Settings" },
    { key: "admin.loans.fees.manage", label: "Loan Fees" },
    { key: "admin.loans.repayment_cycles.manage", label: "Repayment Cycles" },
    { key: "admin.loans.reminders.manage", label: "Loan Reminder Settings" },
    { key: "admin.loans.templates.manage", label: "Loan Templates" },
    { key: "admin.loans.status_approvals.manage", label: "Loan Status & Approvals" },
    { key: "admin.loans.categories.manage", label: "Loan Categories" },
    { key: "admin.loans.sectors.manage", label: "Loan Sectors" },
    { key: "admin.borrowers.settings.manage", label: "Borrower Settings" },
    { key: "admin.branches.manage", label: "Manage Branches" },
    { key: "admin.branches.holidays.manage", label: "Branch Holidays" },
    { key: "admin.savings.settings.manage", label: "Saving Settings" },
    { key: "admin.payroll.settings.manage", label: "Payroll Settings" },
    { key: "admin.audit_logs.view", label: "Activity / Audit Logs (View)" },
  ]},
];
