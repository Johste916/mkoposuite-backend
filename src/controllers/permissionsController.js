"use strict";

const { Op } = require("sequelize");
const { Permission, Role, User } = require("../models");

/**
 * 🔐 Permission Catalog (granular, production-ready)
 * Pattern: area.resource.action
 * Only `key` and `label` matter for the UI; you can add/remove freely.
 */
const PERMISSION_CATALOG = [
  /* --------------------------- Global & Dashboard --------------------------- */
  {
    group: "Dashboard & Global",
    actions: [
      { key: "dashboard.view", label: "Access Dashboard" },
      { key: "dashboard.refresh", label: "Manual Refresh" },
      { key: "dashboard.auto_refresh", label: "Enable Auto-Refresh" },
      { key: "dashboard.filters.branch.use", label: "Use Branch Filter" },
      { key: "dashboard.filters.officer.use", label: "Use Officer Filter" },
      { key: "dashboard.filters.time_range.use", label: "Use Time Range Filter" },

      // Widgets
      { key: "dashboard.widget.total_borrowers.view", label: "Widget: Total Borrowers" },
      { key: "dashboard.widget.total_loans.view", label: "Widget: Total Loans" },
      { key: "dashboard.widget.total_disbursed.view", label: "Widget: Total Disbursed" },
      { key: "dashboard.widget.total_paid.view", label: "Widget: Total Paid" },
      { key: "dashboard.widget.total_repaid.view", label: "Widget: Total Repaid" },
      { key: "dashboard.widget.expected_repayments.view", label: "Widget: Expected Repayments" },
      { key: "dashboard.widget.total_deposits.view", label: "Widget: Total Deposits" },
      { key: "dashboard.widget.total_withdrawals.view", label: "Widget: Total Withdrawals" },
      { key: "dashboard.widget.net_savings.view", label: "Widget: Net Savings" },
      { key: "dashboard.widget.defaulted_loan.view", label: "Widget: Defaulted Loan" },
      { key: "dashboard.widget.defaulted_interest.view", label: "Widget: Defaulted Interest" },
      { key: "dashboard.widget.outstanding_loan.view", label: "Widget: Outstanding Loan" },
      { key: "dashboard.widget.outstanding_interest.view", label: "Widget: Outstanding Interest" },
      { key: "dashboard.widget.written_off.view", label: "Widget: Written Off" },
      { key: "dashboard.widget.par.view", label: "Widget: PAR" },
      { key: "dashboard.widget.trends.view", label: "Widget: Monthly Trends" },
      { key: "dashboard.widget.branch_performance.view", label: "Widget: Branch Performance" },
      { key: "dashboard.widget.officer_performance.view", label: "Widget: Officer Performance" },
      { key: "dashboard.widget.communications.view", label: "Widget: Communications" },

      // Global utilities
      { key: "global.search.use", label: "Global Search" },
      { key: "communications.ticker.view", label: "Announcements Ticker" },
      { key: "communications.attachments.download", label: "Download Comms Attachments" },
      { key: "branches.switch", label: "Switch Active Branch" },
    ],
  },

  /* -------------------------------- Borrowers -------------------------------- */
  {
    group: "Borrowers",
    actions: [
      { key: "borrowers.view", label: "View Borrowers" },
      { key: "borrowers.create", label: "Create Borrower" },
      { key: "borrowers.update", label: "Update Borrower" },
      { key: "borrowers.delete", label: "Delete Borrower" },
      { key: "borrowers.disable", label: "Disable Borrower" },
      { key: "borrowers.import", label: "Import Borrowers" },
      { key: "borrowers.reports.view", label: "Borrower Reports" },

      // Groups
      { key: "borrowers.groups.view", label: "View Borrower Groups" },
      { key: "borrowers.groups.create", label: "Create Borrower Group" },
      { key: "borrowers.groups.update", label: "Update Borrower Group" },
      { key: "borrowers.groups.delete", label: "Delete Borrower Group" },
      { key: "borrowers.groups.import", label: "Import Groups" },
      { key: "borrowers.groups.reports.view", label: "Group Reports" },

      // KYC / Blacklist / Messaging
      { key: "borrowers.kyc.review", label: "KYC Review" },
      { key: "borrowers.blacklist.manage", label: "Manage Blacklist" },
      { key: "borrowers.message.sms.send", label: "Send SMS to Borrowers" },
      { key: "borrowers.message.email.send", label: "Send Email to Borrowers" },
      { key: "borrowers.invite.send", label: "Invite Borrowers" },
    ],
  },

  /* ---------------------------------- Loans ---------------------------------- */
  {
    group: "Loans",
    actions: [
      { key: "loans.view", label: "View Loans" },
      { key: "loans.update", label: "Update Loans" },
      { key: "loans.delete", label: "Delete Loans" },

      // Applications / approvals / disbursement
      { key: "loans.applications.create", label: "Create Loan Application" },
      { key: "loans.review", label: "Review Loans" },
      { key: "loans.approve", label: "Approve Loans" },
      { key: "loans.disburse", label: "Disburse Loans" },

      // Products & calculator/schedule
      { key: "loans.products.view", label: "View Loan Products" },
      { key: "loans.products.manage", label: "Manage Loan Products" },
      { key: "loans.schedule.calculate", label: "Calculate Schedule" },

      // Status lists
      { key: "loans.status.disbursed.view", label: "Status: Disbursed" },
      { key: "loans.status.due.view", label: "Status: Due" },
      { key: "loans.status.missed.view", label: "Status: Missed" },
      { key: "loans.status.arrears.view", label: "Status: Arrears" },
      { key: "loans.status.no_repayments.view", label: "Status: No Repayments" },
      { key: "loans.status.past_maturity.view", label: "Status: Past Maturity" },
      { key: "loans.status.principal_outstanding.view", label: "Status: Principal Outstanding" },
      { key: "loans.status.1_month_late.view", label: "Status: 1 Month Late" },
      { key: "loans.status.3_months_late.view", label: "Status: 3 Months Late" },
    ],
  },

  /* -------------------------------- Repayments ------------------------------- */
  {
    group: "Repayments",
    actions: [
      { key: "repayments.view", label: "View Repayments" },
      { key: "repayments.create", label: "Record Repayment" },
      { key: "repayments.receipts.view", label: "View Receipts" },
      { key: "repayments.bulk_upload", label: "Bulk Repayments" },
      { key: "repayments.csv_upload", label: "Upload CSV" },
      { key: "repayments.charts.view", label: "Charts" },
      { key: "repayments.approve", label: "Approve Repayments" },
    ],
  },

  /* -------------------------------- Collateral ------------------------------- */
  {
    group: "Collateral",
    actions: [
      { key: "collateral.view", label: "View Collateral" },
      { key: "collateral.create", label: "Create Collateral" },
      { key: "collateral.update", label: "Update Collateral" },
      { key: "collateral.delete", label: "Delete Collateral" },
      { key: "collateral.disable", label: "Disable Collateral" },
    ],
  },

  /* ------------------------------ Collection Sheets -------------------------- */
  {
    group: "Collections",
    actions: [
      { key: "collections.daily.view", label: "Daily Collection Sheet" },
      { key: "collections.missed.view", label: "Missed Repayment Sheet" },
      { key: "collections.past_maturity.view", label: "Past Maturity Sheet" },
      { key: "collections.sms.send", label: "Send SMS" },
      { key: "collections.email.send", label: "Send Email" },
    ],
  },

  /* ---------------------------------- Savings -------------------------------- */
  {
    group: "Savings",
    actions: [
      { key: "savings.view", label: "View Savings" },
      { key: "savings.tx.view", label: "View Transactions" },
      { key: "savings.tx.csv_upload", label: "Upload CSV" },
      { key: "savings.tx.approve", label: "Approve Transactions" },
      { key: "savings.report.view", label: "Reports" },
    ],
  },

  /* --------------------------------- Banking --------------------------------- */
  {
    group: "Banking",
    actions: [
      { key: "banks.view", label: "View Banks" },
      { key: "banks.create", label: "Add Bank" },
      { key: "banks.update", label: "Update Bank" },
      { key: "banks.delete", label: "Delete Bank" },
      { key: "banks.tx.view", label: "View Bank Transactions" },
      { key: "banks.transfers.create", label: "Transfers" },
      { key: "banks.reconciliation.manage", label: "Reconciliation" },
      { key: "banks.statements.view", label: "Statements" },
      { key: "banks.tx.csv_import", label: "Import Bank CSV" },
      { key: "banks.approvals.manage", label: "Approvals" },
      { key: "banks.rules.manage", label: "Rules & GL Mapping" },
    ],
  },

  /* ----------------------------------- Cash ---------------------------------- */
  {
    group: "Cash",
    actions: [
      { key: "cash.accounts.view", label: "View Cash Accounts" },
      { key: "cash.accounts.create", label: "Add Cash Account" },
      { key: "cash.tx.view", label: "View Cash Transactions" },
      { key: "cash.tx.create", label: "Add Cash Transaction" },
      { key: "cash.reconciliation.manage", label: "Cash Reconciliation" },
      { key: "cash.statements.view", label: "Cash Statements" },
    ],
  },

  /* -------------------------------- Investors -------------------------------- */
  {
    group: "Investors",
    actions: [
      { key: "investors.view", label: "View Investors" },
      { key: "investors.create", label: "Create Investor" },
      { key: "investors.update", label: "Update Investor" },
      { key: "investors.delete", label: "Delete Investor" },
    ],
  },

  /* ------------------------------ HR & Payroll ------------------------------- */
  {
    group: "HR & Payroll",
    actions: [
      { key: "payroll.view", label: "View Payroll" },
      { key: "payroll.create", label: "Create Payroll" },
      { key: "payroll.report.view", label: "Payroll Report" },
      { key: "hr.employees.view", label: "Employees" },
      { key: "hr.attendance.view", label: "Attendance" },
      { key: "hr.leave.view", label: "Leave (View)" },
      { key: "hr.leave.manage", label: "Leave (Manage)" },
      { key: "hr.contracts.view", label: "Contracts (View)" },
      { key: "hr.contracts.manage", label: "Contracts (Manage)" },
    ],
  },

  /* --------------------------------- Expenses -------------------------------- */
  {
    group: "Expenses",
    actions: [
      { key: "expenses.view", label: "View Expenses" },
      { key: "expenses.create", label: "Create Expense" },
      { key: "expenses.update", label: "Update Expense" },
      { key: "expenses.delete", label: "Delete Expense" },
      { key: "expenses.csv_upload", label: "Upload CSV" },
      { key: "expenses.export", label: "Export" },
    ],
  },

  /* ------------------------------- Other Income ------------------------------ */
  {
    group: "Other Income",
    actions: [
      { key: "other_income.view", label: "View Other Income" },
      { key: "other_income.create", label: "Create Income" },
      { key: "other_income.update", label: "Update Income" },
      { key: "other_income.delete", label: "Delete Income" },
      { key: "other_income.csv_upload", label: "Upload CSV" },
      { key: "other_income.export", label: "Export" },
    ],
  },

  /* ---------------------------------- Assets --------------------------------- */
  {
    group: "Assets",
    actions: [
      { key: "assets.view", label: "View Assets" },
      { key: "assets.create", label: "Create Asset" },
      { key: "assets.update", label: "Update Asset" },
      { key: "assets.delete", label: "Delete Asset" },
      { key: "assets.disable", label: "Disable Asset" },
    ],
  },

  /* -------------------------------- Accounting ------------------------------- */
  {
    group: "Accounting",
    actions: [
      { key: "accounting.coa.view", label: "Chart of Accounts (View)" },
      { key: "accounting.coa.manage", label: "Chart of Accounts (Manage)" },
      { key: "accounting.trial_balance.view", label: "Trial Balance" },
      { key: "accounting.pnl.view", label: "Profit & Loss" },
      { key: "accounting.cashflow.view", label: "Cashflow" },
      { key: "accounting.journal.post", label: "Manual Journal (Post)" },
      { key: "accounting.view", label: "Accounting (General View)" },
    ],
  },

  /* ---------------------------------- Reports -------------------------------- */
  {
    group: "Reports",
    actions: [
      { key: "reports.view", label: "Reports (General Access)" },
      { key: "reports.borrowers.view", label: "Borrowers Report" },
      { key: "reports.loans.view", label: "Loan Report" },
      { key: "reports.arrears_aging.view", label: "Arrears Aging" },
      { key: "reports.collections.view", label: "Collections Report" },
      { key: "reports.collector.view", label: "Collector Report" },
      { key: "reports.deferred_income.view", label: "Deferred Income" },
      { key: "reports.deferred_income_monthly.view", label: "Deferred Income Monthly" },
      { key: "reports.pro_rata.view", label: "Pro-Rata Collections" },
      { key: "reports.disbursement.view", label: "Disbursement Report" },
      { key: "reports.fees.view", label: "Fees Report" },
      { key: "reports.loan_officer.view", label: "Loan Officer Report" },
      { key: "reports.mfrs.view", label: "MFRS Ratios" },
      { key: "reports.daily.view", label: "Daily Report" },
      { key: "reports.monthly.view", label: "Monthly Report" },
      { key: "reports.outstanding.view", label: "Outstanding Report" },
      { key: "reports.par.view", label: "PAR Report" },
      { key: "reports.at_a_glance.view", label: "At a Glance" },
      { key: "reports.all_entries.view", label: "All Entries" },
    ],
  },

  /* --------------------------------- Branches -------------------------------- */
  {
    group: "Branches",
    actions: [
      { key: "branches.view", label: "View Branches" },
      { key: "branches.create", label: "Create Branch" },
      { key: "branches.update", label: "Update Branch" },
      { key: "branches.delete", label: "Delete Branch" },
      { key: "branches.holidays.manage", label: "Manage Branch Holidays" },
    ],
  },

  /* ----------------------------------- Admin --------------------------------- */
  {
    group: "Admin",
    actions: [
      { key: "admin.view", label: "Access Admin Hub" },
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
      { key: "admin.loans.settings.manage", label: "Loan Settings" },
      { key: "admin.loans.penalties.manage", label: "Penalty Settings" },
      { key: "admin.loans.fees.manage", label: "Loan Fees" },
      { key: "admin.loans.repayment_cycles.manage", label: "Repayment Cycles" },
      { key: "admin.loans.reminders.manage", label: "Loan Reminder Settings" },
      { key: "admin.loans.templates.manage", label: "Loan Templates (Apps/Agreements)" },
      { key: "admin.loans.status_approvals.manage", label: "Status & Approvals" },
      { key: "admin.loans.categories.manage", label: "Loan Categories" },
      { key: "admin.loans.sectors.manage", label: "Loan Sectors" },

      { key: "admin.borrowers.settings.manage", label: "Borrower Settings" },
      { key: "admin.branches.manage", label: "Manage Branches (Admin)" },
      { key: "admin.branches.holidays.manage", label: "Branch Holidays (Admin)" },
      { key: "admin.savings.settings.manage", label: "Saving Settings" },
      { key: "admin.payroll.settings.manage", label: "Payroll Settings" },
      { key: "admin.audit_logs.view", label: "Activity / Audit Logs" },

      { key: "admin.impersonate", label: "Impersonate Tenant" },
      { key: "tenants.admin.manage", label: "Tenants (New Admin)" },
      { key: "tenants.system.manage", label: "Tenants (System Admin)" },
    ],
  },

  /* ------------------------------- Account/Tools ------------------------------ */
  {
    group: "Account & Tools",
    actions: [
      { key: "account.settings.view", label: "Account Settings" },
      { key: "account.profile.view", label: "Profile" },
      { key: "account.organization.manage", label: "Organization" },
      { key: "account.security.manage", label: "Security (Change Password / 2FA)" },
      { key: "billing.view", label: "Billing (View)" },
      { key: "billing.manage", label: "Billing (Manage)" },
      { key: "subscription.manage", label: "Subscription" },
      { key: "support_tickets.view", label: "Support Tickets (View)" },
      { key: "support_tickets.manage", label: "Support Tickets (Manage)" },
      { key: "sms_console.use", label: "SMS Console" },
      { key: "sms_center.use", label: "SMS Center" },
      { key: "billing.by_phone.use", label: "Billing by Phone" },
    ],
  },
];

/* ------------------------------ helpers ------------------------------ */
const safeString = (v) => (typeof v === "string" ? v : v == null ? "" : String(v).trim());
const asLower = (a) => (Array.isArray(a) ? a.map((x) => String(x).toLowerCase()) : []);

async function ensurePermissionRow(action, description = "") {
  const [row] = await Permission.findOrCreate({
    where: { action },
    defaults: { action, description, roles: [] },
  });
  // Update description if empty and we have one
  if (!row.description && description) {
    row.description = description;
    await row.save();
  }
  return row;
}

/* ------------------------------ API ------------------------------ */

/** List raw Permission rows */
exports.getPermissions = async (_req, res) => {
  try {
    const rows = await Permission.findAll({ order: [["action", "ASC"]] });
    res.json(rows);
  } catch (err) {
    console.error("getPermissions error:", err);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
};

/**
 * Permission Matrix for UI
 * Response shape:
 * {
 *   roles: [{id, name}],
 *   catalog: [{ group, actions: [{key, label}] }],
 *   matrix: { [actionKey]: string[] /* role names (lowercase) */ /* }
 * }
 */
exports.getMatrix = async (_req, res) => {
  try {
    // Ensure all catalog actions exist in DB
    for (const group of PERMISSION_CATALOG) {
      for (const a of group.actions) {
        await ensurePermissionRow(a.key, a.label);
      }
    }

    const roles = await Role.findAll({
      attributes: ["id", "name"],
      order: [["name", "ASC"]],
    });

    const perms = await Permission.findAll({
      attributes: ["action", "roles"],
    });

    const matrix = {};
    for (const p of perms) {
      const rolesArr = Array.isArray(p.roles) ? p.roles : [];
      matrix[p.action] = rolesArr.map((r) => String(r).toLowerCase());
    }

    const catalog = PERMISSION_CATALOG.map((g) => ({
      group: g.group,
      actions: g.actions.map((a) => ({ key: a.key, label: a.label })),
    }));

    res.json({ roles, catalog, matrix });
  } catch (e) {
    console.error("getMatrix error:", e);
    res.status(500).json({ error: "Failed to load permission matrix" });
  }
};

/** Upsert one permission row by action */
exports.updatePermission = async (req, res) => {
  try {
    const action = safeString(req.params.action);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles.map(String) : null;
    const description = safeString(req.body?.description);

    if (!action) return res.status(400).json({ error: "Invalid action" });
    if (!roles) return res.status(400).json({ error: "roles must be an array" });

    const row = await ensurePermissionRow(action, description);
    row.roles = roles;
    if (description) row.description = description;
    await row.save();

    res.json({ message: `Saved "${action}"`, permission: row });
  } catch (err) {
    console.error("updatePermission error:", err);
    res.status(500).json({ error: "Failed to update permission" });
  }
};

/** Create by name */
exports.createPermission = async (req, res) => {
  try {
    const name = safeString(req.body?.name);
    if (!name) return res.status(400).json({ error: "name required" });
    const [row, created] = await Permission.findOrCreate({
      where: { action: name },
      defaults: { action: name, roles: [], description: name },
    });
    if (!created) return res.status(409).json({ error: "Permission already exists" });
    res.status(201).json(row);
  } catch (e) {
    console.error("createPermission error:", e);
    res.status(500).json({ error: "Failed to create permission" });
  }
};

/** Delete by id */
exports.deletePermission = async (req, res) => {
  try {
    await Permission.destroy({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error("deletePermission error:", e);
    res.status(500).json({ error: "Failed to delete permission" });
  }
};

/**
 * Replace / add / remove permissions for a role
 * Body: { actions: string[], mode: "replace" | "add" | "remove" }
 */
exports.setRolePermissions = async (req, res) => {
  try {
    const roleId = safeString(req.params.roleId);
    const role = await Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const actions = Array.isArray(req.body?.actions) ? req.body.actions.map(safeString) : null;
    const mode = safeString(req.body?.mode || "replace"); // replace | add | remove
    if (!actions) return res.status(400).json({ error: "actions must be an array of action strings" });

    // Ensure all specified actions exist
    for (const a of actions) await ensurePermissionRow(a);

    const allPerms = await Permission.findAll({
      where: { action: { [Op.in]: actions } },
    });

    const roleNameLc = role.name.toLowerCase();

    if (mode === "replace") {
      // Remove role from ALL permission rows
      const everyPerm = await Permission.findAll();
      await Promise.all(
        everyPerm.map(async (p) => {
          const set = new Set(asLower(p.roles));
          set.delete(roleNameLc);
          p.roles = Array.from(set);
          await p.save();
        })
      );
      // Add role to provided actions
      for (const p of allPerms) {
        const set = new Set(asLower(p.roles));
        set.add(roleNameLc);
        p.roles = Array.from(set);
        await p.save();
      }
    } else if (mode === "add") {
      for (const p of allPerms) {
        const set = new Set(asLower(p.roles));
        set.add(roleNameLc);
        p.roles = Array.from(set);
        await p.save();
      }
    } else if (mode === "remove") {
      for (const p of allPerms) {
        const set = new Set(asLower(p.roles));
        set.delete(roleNameLc);
        p.roles = Array.from(set);
        await p.save();
      }
    } else {
      return res.status(400).json({ error: "Invalid mode" });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("setRolePermissions error:", e);
    res.status(500).json({ error: "Failed to save role permissions" });
  }
};

/** Get actions for a single role */
exports.getRolePermissions = async (req, res) => {
  try {
    const roleId = safeString(req.params.roleId);
    const role = await Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const rows = await Permission.findAll();
    const a = rows
      .filter((p) => asLower(p.roles).includes(role.name.toLowerCase()))
      .map((p) => p.action);

    res.json({ role: { id: role.id, name: role.name }, actions: a });
  } catch (e) {
    console.error("getRolePermissions error:", e);
    res.status(500).json({ error: "Failed to fetch role permissions" });
  }
};
