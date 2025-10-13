// backend/src/controllers/permissionMatrixController.js
"use strict";

const { Op } = require("sequelize");
const db = require("../models"); // { Permission, Role }

/**
 * CENTRAL CATALOG
 * - Keys should match your UI routes/guards (Sidebar/App).
 * - Safe to expand/rename: the controller will ensure DB rows exist.
 */
const CATALOG = [
  { group: "Dashboard", actions: [{ key: "dashboard.view", label: "View dashboard", verbs: ["view"] }] },

  {
    group: "Borrowers",
    actions: [
      { key: "borrowers.view", label: "View borrowers", verbs: ["view"] },
      { key: "borrowers.create", label: "Add borrower", verbs: ["create"] },
      { key: "borrowers.kyc", label: "KYC queue", verbs: ["view","update"] },
      { key: "borrowers.blacklist", label: "Blacklist", verbs: ["view","update"] },
      { key: "borrowers.import", label: "Imports", verbs: ["create"] },
      { key: "borrowers.reports", label: "Reports", verbs: ["view"] },
      { key: "borrowerGroups.view", label: "View groups", verbs: ["view"] },
      { key: "borrowerGroups.create", label: "Add group", verbs: ["create"] },
      { key: "borrowerGroups.reports", label: "Group reports", verbs: ["view"] },
      { key: "borrowerGroups.import", label: "Group imports", verbs: ["create"] },
      { key: "borrowers.bulkSms", label: "Send SMS", verbs: ["create"] },
      { key: "borrowers.bulkEmail", label: "Send Email", verbs: ["create"] },
    ],
  },

  {
    group: "Loans",
    actions: [
      { key: "loans.view", label: "View loans", verbs: ["view"] },
      { key: "loans.apply", label: "Create/apply", verbs: ["create"] },
      { key: "loans.reviewQueue", label: "Review queue", verbs: ["view","update"] },
      { key: "loans.disbursementQueue", label: "Disbursement queue", verbs: ["view","update"] },
      { key: "loans.status.disbursed", label: "List: Disbursed", verbs: ["view"] },
      { key: "loans.status.due", label: "List: Due", verbs: ["view"] },
      { key: "loans.status.missed", label: "List: Missed", verbs: ["view"] },
      { key: "loans.status.arrears", label: "List: Arrears", verbs: ["view"] },
      { key: "loans.status.noRepayments", label: "List: No repayments", verbs: ["view"] },
      { key: "loans.status.pastMaturity", label: "List: Past maturity", verbs: ["view"] },
      { key: "loans.status.principalOutstanding", label: "List: Principal outstanding", verbs: ["view"] },
      { key: "loans.status.1MonthLate", label: "List: 1 month late", verbs: ["view"] },
      { key: "loans.status.3MonthsLate", label: "List: 3 months late", verbs: ["view"] },
      { key: "loanProducts.manage", label: "Loan products: create/edit", verbs: ["create","update","delete"] },
      { key: "loans.schedule", label: "Calculator / schedule", verbs: ["view"] },
      { key: "loans.disburse", label: "Disburse loan", verbs: ["update","approve"] },
    ],
  },

  {
    group: "Repayments",
    actions: [
      { key: "repayments.view", label: "View repayments", verbs: ["view"] },
      { key: "repayments.create", label: "Record repayment", verbs: ["create"] },
      { key: "repayments.receipts", label: "Receipts", verbs: ["view","create"] },
      { key: "repayments.bulk", label: "Bulk repayments", verbs: ["create"] },
      { key: "repayments.csv", label: "Upload CSV", verbs: ["create"] },
      { key: "repayments.charts", label: "Charts", verbs: ["view"] },
      { key: "repayments.approve", label: "Approve repayments", verbs: ["approve"] },
    ],
  },

  {
    group: "Collection Sheets",
    actions: [
      { key: "collections.view", label: "View sheets", verbs: ["view"] },
      { key: "collections.create", label: "Create sheet", verbs: ["create"] },
      { key: "collections.edit", label: "Edit sheet", verbs: ["update"] },
      { key: "collections.daily", label: "Daily sheet", verbs: ["view"] },
      { key: "collections.missed", label: "Missed sheet", verbs: ["view"] },
      { key: "collections.pastMaturity", label: "Past maturity sheet", verbs: ["view"] },
      { key: "collections.sms", label: "Send SMS", verbs: ["create"] },
      { key: "collections.email", label: "Send Email", verbs: ["create"] },
    ],
  },

  {
    group: "Collateral",
    actions: [
      { key: "collateral.view", label: "View collateral", verbs: ["view"] },
      { key: "collateral.create", label: "Create collateral", verbs: ["create"] },
      { key: "collateral.edit", label: "Edit collateral", verbs: ["update"] },
    ],
  },

  {
    group: "Savings",
    actions: [
      { key: "savings.view", label: "View savings", verbs: ["view"] },
      { key: "savings.transactions", label: "Transactions", verbs: ["view","create"] },
      { key: "savings.csv", label: "Upload CSV", verbs: ["create"] },
      { key: "savings.approve", label: "Approve transactions", verbs: ["approve"] },
      { key: "savings.report", label: "Reports", verbs: ["view"] },
    ],
  },

  {
    group: "Banking",
    actions: [
      { key: "banks.view", label: "View banks", verbs: ["view"] },
      { key: "banks.create", label: "Add bank", verbs: ["create"] },
      { key: "banks.transactions", label: "Transactions", verbs: ["view","create"] },
      { key: "banks.transfers", label: "Transfers", verbs: ["create"] },
      { key: "banks.reconciliation", label: "Reconciliation", verbs: ["view","update"] },
      { key: "banks.statements", label: "Statements", verbs: ["view","create"] },
      { key: "banks.import", label: "Import CSV", verbs: ["create"] },
      { key: "banks.approvals", label: "Approvals", verbs: ["approve"] },
      { key: "banks.rules", label: "Rules & GL mapping", verbs: ["update"] },
      { key: "cash.accounts", label: "Cash: accounts", verbs: ["view"] },
      { key: "cash.createAccount", label: "Cash: add account", verbs: ["create"] },
      { key: "cash.transactions", label: "Cash: transactions", verbs: ["view","create"] },
      { key: "cash.createTransaction", label: "Cash: add transaction", verbs: ["create"] },
      { key: "cash.reconciliation", label: "Cash: reconciliation", verbs: ["view","update"] },
      { key: "cash.statements", label: "Cash: statements", verbs: ["view","create"] },
    ],
  },

  {
    group: "HR & Payroll",
    actions: [
      { key: "payroll.view", label: "View payroll", verbs: ["view"] },
      { key: "payroll.create", label: "Add payroll", verbs: ["create"] },
      { key: "payroll.report", label: "Payroll report", verbs: ["view"] },
      { key: "hr.employees", label: "Employees", verbs: ["view","update"] },
      { key: "hr.attendance", label: "Attendance", verbs: ["view","update"] },
      { key: "hr.leave", label: "Leave management", verbs: ["view","update"] },
      { key: "hr.contracts", label: "Contracts", verbs: ["view","update"] },
    ],
  },

  {
    group: "Expenses & Other Income",
    actions: [
      { key: "expenses.view", label: "View expenses", verbs: ["view"] },
      { key: "expenses.create", label: "Add expense", verbs: ["create"] },
      { key: "expenses.csv", label: "Upload CSV (expenses)", verbs: ["create"] },
      { key: "income.view", label: "View other income", verbs: ["view"] },
      { key: "income.create", label: "Add other income", verbs: ["create"] },
      { key: "income.csv", label: "Upload CSV (income)", verbs: ["create"] },
    ],
  },

  { group: "Assets", actions: [
      { key: "assets.view", label: "View assets", verbs: ["view"] },
      { key: "assets.create", label: "Add asset", verbs: ["create"] },
  ]},

  {
    group: "Accounting",
    actions: [
      { key: "accounting.coa", label: "Chart of accounts", verbs: ["view","update"] },
      { key: "accounting.trialBalance", label: "Trial balance", verbs: ["view"] },
      { key: "accounting.pnl", label: "Profit & loss", verbs: ["view"] },
      { key: "accounting.cashflow", label: "Cashflow", verbs: ["view"] },
      { key: "accounting.manualJournal", label: "Manual journal", verbs: ["create"] },
    ],
  },

  {
    group: "Reports",
    actions: [
      { key: "reports.borrowers", label: "Borrowers report", verbs: ["view"] },
      { key: "reports.loans", label: "Loan report", verbs: ["view"] },
      { key: "reports.arrearsAging", label: "Loan arrears aging", verbs: ["view"] },
      { key: "reports.collections", label: "Collections report", verbs: ["view"] },
      { key: "reports.collector", label: "Collector report", verbs: ["view"] },
      { key: "reports.deferredIncome", label: "Deferred income", verbs: ["view"] },
      { key: "reports.deferredIncomeMonthly", label: "Deferred income monthly", verbs: ["view"] },
      { key: "reports.proRata", label: "Pro-rata collections", verbs: ["view"] },
      { key: "reports.disbursement", label: "Disbursement report", verbs: ["view"] },
      { key: "reports.fees", label: "Fees report", verbs: ["view"] },
      { key: "reports.loanProducts", label: "Loan products report", verbs: ["view"] },
      { key: "reports.mfrs", label: "MFRS ratios", verbs: ["view"] },
      { key: "reports.daily", label: "Daily report", verbs: ["view"] },
      { key: "reports.monthly", label: "Monthly report", verbs: ["view"] },
      { key: "reports.outstanding", label: "Outstanding report", verbs: ["view"] },
      { key: "reports.par", label: "Portfolio at risk (PAR)", verbs: ["view"] },
      { key: "reports.atAGlance", label: "At a glance", verbs: ["view"] },
      { key: "reports.allEntries", label: "All entries", verbs: ["view"] },
    ],
  },

  {
    group: "User & Org Management",
    actions: [
      { key: "branches.view", label: "View branches", verbs: ["view"] },
      { key: "users.view", label: "View users/staff", verbs: ["view"] },
      { key: "roles.view", label: "View roles", verbs: ["view"] },
      { key: "roles.manage", label: "Create/Edit/Delete roles", verbs: ["create","update","delete"] },
      { key: "permissions.manage", label: "Manage permissions", verbs: ["update"] },
      { key: "account.settings", label: "Account settings", verbs: ["update"] },
      { key: "account.organization", label: "Organization", verbs: ["view","update"] },
      { key: "admin.hub", label: "Admin hub", verbs: ["view"] },
      { key: "admin.tenants", label: "Admin: Tenants", verbs: ["view","update"] },
      { key: "tenantsAdmin.new", label: "Tenants (New)", verbs: ["view","update"] },
      { key: "impersonateTenant", label: "Impersonate tenant", verbs: ["update"] },
      { key: "subscription", label: "Subscription", verbs: ["view","update"] },
      { key: "supportTickets", label: "Support tickets", verbs: ["view","update"] },
      { key: "smsConsole", label: "SMS console", verbs: ["view","create"] },
      { key: "smsCenter", label: "SMS center", verbs: ["view","create"] },
      { key: "billingByPhone", label: "Billing by phone", verbs: ["view"] },
    ],
  },
];

/* ------------------------------- helpers ---------------------------------- */

const safeString = (v) =>
  (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

const asLower = (a) =>
  (Array.isArray(a) ? a : []).map((x) => String(x || "").toLowerCase()).filter(Boolean);

async function ensurePermissionRow(action, description = "") {
  const [row] = await db.Permission.findOrCreate({
    where: { action },
    defaults: { action, description, roles: [] },
  });
  return row;
}

/** Convert stored role names (or "*") to roleId[] for the UI */
function toRoleIds(rolesField, rolesByName) {
  const names = asLower(rolesField);
  if (names.includes("*")) return Array.from(rolesByName.values());
  const ids = [];
  for (const n of names) {
    const id = rolesByName.get(n);
    if (id) ids.push(id);
  }
  return ids;
}

/* --------------------------------- GET /matrix ----------------------------- */
/**
 * Response:
 * {
 *   roles:   [{id,name,isSystem?}],
 *   catalog: [{ group, actions:[{ key,label,verbs[] }] }],
 *   matrix:  { [actionKey]: roleId[] }
 * }
 */
exports.getMatrix = async (_req, res) => {
  try {
    // Ensure catalog rows exist so empty system still shows all actions
    for (const g of CATALOG) {
      for (const a of g.actions) {
        await ensurePermissionRow(a.key, a.label);
      }
    }

    const [roles, perms] = await Promise.all([
      db.Role.findAll({ order: [["name", "ASC"]] }),
      db.Permission.findAll({ attributes: ["action", "roles", "description"] }),
    ]);

    const rolesList = roles.map((r) => ({ id: r.id, name: r.name, isSystem: !!r.isSystem }));
    const rolesByName = new Map(rolesList.map((r) => [String(r.name || "").toLowerCase(), r.id]));
    const byAction = new Map(perms.map((p) => [p.action, p]));

    const catalog = CATALOG.map((g) => ({
      group: g.group,
      actions: g.actions.map((a) => ({
        key: a.key,
        label: a.label,
        verbs: a.verbs || [],
      })),
    }));

    const matrix = {};
    for (const g of CATALOG) {
      for (const a of g.actions) {
        const row = byAction.get(a.key);
        matrix[a.key] = toRoleIds(row?.roles || [], rolesByName);
      }
    }

    return res.json({ roles: rolesList, catalog, matrix });
  } catch (e) {
    console.error("getMatrix error:", e);
    return res.status(500).json({ error: "Failed to build permission matrix" });
  }
};

/* --------------------------- PUT /role/:roleId ----------------------------- */
/**
 * Body: { actions: string[], mode?: "replace" | "add" | "remove" | "merge" }
 * We store **role names (lowercased)** in Permission.roles for compatibility
 * with your `allow()` middleware, but we **serve role IDs** to the UI.
 */
exports.saveForRole = async (req, res) => {
  try {
    const roleId = safeString(req.params.roleId);
    const role = await db.Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const actions = Array.isArray(req.body?.actions)
      ? req.body.actions.map(safeString).filter(Boolean)
      : null;
    if (!actions) return res.status(400).json({ error: "actions must be an array of action strings" });

    // "merge" behaves like "add"
    const modeIn = safeString(req.body?.mode || "replace").toLowerCase();
    const mode = modeIn === "merge" ? "add" : modeIn;
    const roleNameLc = String(role.name || "").toLowerCase();

    // Ensure all requested actions exist
    for (const a of actions) await ensurePermissionRow(a, a);

    // Load all permissions once
    const allPerms = await db.Permission.findAll();

    if (mode === "replace") {
      // 1) Remove this role from ALL actions
      for (const p of allPerms) {
        const set = new Set(asLower(p.roles));
        set.delete(roleNameLc);
        p.roles = Array.from(set);
        await p.save();
      }
      // 2) Add this role to the specified actions
      for (const p of allPerms.filter((p) => actions.includes(p.action))) {
        const set = new Set(asLower(p.roles));
        set.add(roleNameLc);
        p.roles = Array.from(set);
        await p.save();
      }
    } else if (mode === "add") {
      for (const p of allPerms.filter((p) => actions.includes(p.action))) {
        const set = new Set(asLower(p.roles));
        set.add(roleNameLc);
        p.roles = Array.from(set);
        await p.save();
      }
    } else if (mode === "remove") {
      for (const p of allPerms.filter((p) => actions.includes(p.action))) {
        const set = new Set(asLower(p.roles));
        set.delete(roleNameLc);
        p.roles = Array.from(set);
        await p.save();
      }
    } else {
      return res.status(400).json({ error: "Invalid mode" });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("saveForRole error:", e);
    return res.status(500).json({ error: "Failed to save role permissions" });
  }
};
