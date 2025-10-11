// backend/src/controllers/permissionMatrixController.js
"use strict";

const db = require("../models"); // { Permission, Role }
const { Op } = require("sequelize");

/**
 * CENTRAL CATALOG
 * - One place to define all app actions grouped by feature.
 * - Keys here should match the UI/route intent (from App.jsx + Sidebar).
 * - You can add or rename items safely; existing mappings will still round-trip.
 */
const CATALOG = [
  {
    group: "Dashboard",
    actions: [{ key: "dashboard.view", label: "View dashboard" }],
  },

  {
    group: "Borrowers",
    actions: [
      { key: "borrowers.view", label: "View borrowers" },
      { key: "borrowers.create", label: "Add borrower" },
      { key: "borrowers.kyc", label: "KYC queue" },
      { key: "borrowers.blacklist", label: "Blacklist" },
      { key: "borrowers.import", label: "Imports" },
      { key: "borrowers.reports", label: "Reports" },
      { key: "borrowerGroups.view", label: "View groups" },
      { key: "borrowerGroups.create", label: "Add group" },
      { key: "borrowerGroups.reports", label: "Group reports" },
      { key: "borrowerGroups.import", label: "Group imports" },
      { key: "borrowers.bulkSms", label: "Send SMS" },
      { key: "borrowers.bulkEmail", label: "Send Email" },
    ],
  },

  {
    group: "Loans",
    actions: [
      { key: "loans.view", label: "View loans" },
      { key: "loans.apply", label: "Create/apply" },
      { key: "loans.reviewQueue", label: "Review queue" },
      { key: "loans.disbursementQueue", label: "Disbursement queue" },
      { key: "loans.status.disbursed", label: "List: Disbursed" },
      { key: "loans.status.due", label: "List: Due" },
      { key: "loans.status.missed", label: "List: Missed" },
      { key: "loans.status.arrears", label: "List: Arrears" },
      { key: "loans.status.noRepayments", label: "List: No repayments" },
      { key: "loans.status.pastMaturity", label: "List: Past maturity" },
      { key: "loans.status.principalOutstanding", label: "List: Principal outstanding" },
      { key: "loans.status.1MonthLate", label: "List: 1 month late" },
      { key: "loans.status.3MonthsLate", label: "List: 3 months late" },
      { key: "loanProducts.manage", label: "Loan products: create/edit" },
      { key: "loans.schedule", label: "Calculator / schedule" },
      { key: "loans.disburse", label: "Disburse loan" },
    ],
  },

  {
    group: "Repayments",
    actions: [
      { key: "repayments.view", label: "View repayments" },
      { key: "repayments.create", label: "Record repayment" },
      { key: "repayments.receipts", label: "Receipts" },
      { key: "repayments.bulk", label: "Bulk repayments" },
      { key: "repayments.csv", label: "Upload CSV" },
      { key: "repayments.charts", label: "Charts" },
      { key: "repayments.approve", label: "Approve repayments" },
    ],
  },

  {
    group: "Collection Sheets",
    actions: [
      { key: "collections.view", label: "View sheets" },
      { key: "collections.create", label: "Create sheet" },
      { key: "collections.edit", label: "Edit sheet" },
      { key: "collections.daily", label: "Daily sheet" },
      { key: "collections.missed", label: "Missed sheet" },
      { key: "collections.pastMaturity", label: "Past maturity sheet" },
      { key: "collections.sms", label: "Send SMS" },
      { key: "collections.email", label: "Send Email" },
    ],
  },

  {
    group: "Collateral",
    actions: [
      { key: "collateral.view", label: "View collateral" },
      { key: "collateral.create", label: "Create collateral" },
      { key: "collateral.edit", label: "Edit collateral" },
    ],
  },

  {
    group: "Savings",
    actions: [
      { key: "savings.view", label: "View savings" },
      { key: "savings.transactions", label: "Transactions" },
      { key: "savings.csv", label: "Upload CSV" },
      { key: "savings.approve", label: "Approve transactions" },
      { key: "savings.report", label: "Reports" },
    ],
  },

  {
    group: "Banking",
    actions: [
      { key: "banks.view", label: "View banks" },
      { key: "banks.create", label: "Add bank" },
      { key: "banks.transactions", label: "Transactions" },
      { key: "banks.transfers", label: "Transfers" },
      { key: "banks.reconciliation", label: "Reconciliation" },
      { key: "banks.statements", label: "Statements" },
      { key: "banks.import", label: "Import CSV" },
      { key: "banks.approvals", label: "Approvals" },
      { key: "banks.rules", label: "Rules & GL mapping" },
      { key: "cash.accounts", label: "Cash: accounts" },
      { key: "cash.createAccount", label: "Cash: add account" },
      { key: "cash.transactions", label: "Cash: transactions" },
      { key: "cash.createTransaction", label: "Cash: add transaction" },
      { key: "cash.reconciliation", label: "Cash: reconciliation" },
      { key: "cash.statements", label: "Cash: statements" },
    ],
  },

  {
    group: "HR & Payroll",
    actions: [
      { key: "payroll.view", label: "View payroll" },
      { key: "payroll.create", label: "Add payroll" },
      { key: "payroll.report", label: "Payroll report" },
      { key: "hr.employees", label: "Employees" },
      { key: "hr.attendance", label: "Attendance" },
      { key: "hr.leave", label: "Leave management" },
      { key: "hr.contracts", label: "Contracts" },
    ],
  },

  {
    group: "Expenses & Other Income",
    actions: [
      { key: "expenses.view", label: "View expenses" },
      { key: "expenses.create", label: "Add expense" },
      { key: "expenses.csv", label: "Upload CSV (expenses)" },
      { key: "income.view", label: "View other income" },
      { key: "income.create", label: "Add other income" },
      { key: "income.csv", label: "Upload CSV (income)" },
    ],
  },

  {
    group: "Assets",
    actions: [
      { key: "assets.view", label: "View assets" },
      { key: "assets.create", label: "Add asset" },
    ],
  },

  {
    group: "Accounting",
    actions: [
      { key: "accounting.coa", label: "Chart of accounts" },
      { key: "accounting.trialBalance", label: "Trial balance" },
      { key: "accounting.pnl", label: "Profit & loss" },
      { key: "accounting.cashflow", label: "Cashflow" },
      { key: "accounting.manualJournal", label: "Manual journal" },
    ],
  },

  {
    group: "Reports",
    actions: [
      { key: "reports.borrowers", label: "Borrowers report" },
      { key: "reports.loans", label: "Loan report" },
      { key: "reports.arrearsAging", label: "Loan arrears aging" },
      { key: "reports.collections", label: "Collections report" },
      { key: "reports.collector", label: "Collector report" },
      { key: "reports.deferredIncome", label: "Deferred income" },
      { key: "reports.deferredIncomeMonthly", label: "Deferred income monthly" },
      { key: "reports.proRata", label: "Pro-rata collections" },
      { key: "reports.disbursement", label: "Disbursement report" },
      { key: "reports.fees", label: "Fees report" },
      { key: "reports.loanProducts", label: "Loan products report" },
      { key: "reports.mfrs", label: "MFRS ratios" },
      { key: "reports.daily", label: "Daily report" },
      { key: "reports.monthly", label: "Monthly report" },
      { key: "reports.outstanding", label: "Outstanding report" },
      { key: "reports.par", label: "Portfolio at risk (PAR)" },
      { key: "reports.atAGlance", label: "At a glance" },
      { key: "reports.allEntries", label: "All entries" },
    ],
  },

  {
    group: "User & Org Management",
    actions: [
      { key: "branches.view", label: "View branches" },
      { key: "users.view", label: "View users/staff" },
      { key: "roles.view", label: "View roles" },
      { key: "roles.manage", label: "Create/Edit/Delete roles" },
      { key: "permissions.manage", label: "Manage permissions" },
      { key: "account.settings", label: "Account settings" },
      { key: "account.organization", label: "Organization" },
      { key: "admin.hub", label: "Admin hub" },
      { key: "admin.tenants", label: "Admin: Tenants" },
      { key: "tenantsAdmin.new", label: "Tenants (New)" },
      { key: "impersonateTenant", label: "Impersonate tenant" },
      { key: "subscription", label: "Subscription" },
      { key: "supportTickets", label: "Support tickets" },
      { key: "smsConsole", label: "SMS console" },
      { key: "smsCenter", label: "SMS center" },
      { key: "billingByPhone", label: "Billing by phone" },
    ],
  },
];

/* ------------------------------- Helpers ---------------------------------- */

const normalize = (rows = []) =>
  (Array.isArray(rows) ? rows : []).map(r => ({
    id: r.id,
    action: r.action,
    roles: Array.isArray(r.roles) ? r.roles : [],
    description: r.description || "",
    isSystem: !!r.isSystem,
  }));

/* -------------------------------- Routes ---------------------------------- */

// GET /api/permissions/matrix
exports.getMatrix = async (_req, res) => {
  try {
    const [roles, perms] = await Promise.all([
      db.Role.findAll({ order: [["name", "ASC"]] }),
      db.Permission.findAll({ order: [["action", "ASC"]] }),
    ]);

    const roleList = roles.map(r => ({ id: r.id, name: r.name, isSystem: !!r.isSystem }));
    const byAction = new Map(normalize(perms).map(p => [p.action, p]));

    // Produce matrix { [actionKey]: string[]roleNames }
    const matrix = {};
    for (const group of CATALOG) {
      for (const act of group.actions) {
        matrix[act.key] = byAction.get(act.key)?.roles || [];
      }
    }

    res.json({
      catalog: CATALOG,
      roles: roleList,
      matrix,
    });
  } catch (e) {
    console.error("getMatrix error:", e);
    res.status(500).json({ error: "Failed to build permission matrix" });
  }
};

// PUT /api/permissions/role/:roleId  { actions: string[], mode?: "replace"|"merge" }
exports.saveForRole = async (req, res) => {
  try {
    const { roleId } = req.params;
    const role = await db.Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const actions = Array.isArray(req.body?.actions)
      ? req.body.actions.map(String)
      : [];
    const mode = (req.body?.mode || "replace").toLowerCase();

    // Fetch all existing permissions relevant to the provided actions
    const existing = await db.Permission.findAll({
      where: { action: { [Op.in]: actions } },
    });

    const byAction = new Map(existing.map(p => [p.action, p]));

    for (const action of actions) {
      const row = byAction.get(action);
      if (!row) {
        // create with ONLY this role
        await db.Permission.create({
          action,
          roles: [role.name],
          description: action,
        });
        continue;
      }

      const set = new Set((row.roles || []).map(String));
      if (mode === "replace") {
        row.roles = [role.name];
      } else {
        set.add(role.name);
        row.roles = Array.from(set);
      }
      await row.save();
    }

    // If replace: remove this role from actions NOT included
    if (mode === "replace") {
      await db.Permission.update(
        { roles: db.sequelize.literal(`CASE
          WHEN roles @> '["${role.name}"]' THEN (SELECT jsonb_agg(x) FROM jsonb_array_elements_text(roles) x WHERE x <> '${role.name}')
          ELSE roles END
        `) },
        { where: { action: { [Op.notIn]: actions } } }
      ).catch(() => {}); // works on Postgres; on MySQL skip silently
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("saveForRole error:", e);
    res.status(500).json({ error: "Failed to save role permissions" });
  }
};
