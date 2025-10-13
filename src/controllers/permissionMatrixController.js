// backend/src/controllers/permissionMatrixController.js
"use strict";

const { Op } = require("sequelize");
const db = require("../models"); // { Permission, Role }

/**
 * CENTRAL CATALOG
 * (Keys must match your UI routes/guards)
 */
const CATALOG = [
  { group: "Dashboard", actions: [{ key: "dashboard.view", label: "View dashboard" }] },

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

  { group: "Assets", actions: [
    { key: "assets.view", label: "View assets" },
    { key: "assets.create", label: "Add asset" },
  ]},

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

/* ------------------------------- helpers ---------------------------------- */

const safeString = (v) => (typeof v === "string" ? v : v == null ? "" : String(v)).trim();

const asLower = (a) =>
  (Array.isArray(a) ? a : [])
    .map((x) => String(x || "").toLowerCase())
    .filter(Boolean);

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

/* ----------------------------------- GET ---------------------------------- */
// GET /api/permissions/matrix
// Returns: { roles, catalog, matrix }
exports.getMatrix = async (_req, res) => {
  try {
    // 1) Build flattened action list + label map
    const keys = [];
    const labelByKey = new Map();
    for (const g of CATALOG) {
      for (const a of g.actions) {
        keys.push(a.key);
        labelByKey.set(a.key, a.label || a.key);
      }
    }

    // 2) Fetch existing rows for those actions
    let existing = await db.Permission.findAll({
      where: { action: { [Op.in]: keys } },
      attributes: ["action", "roles"],
    });

    // 3) Bulk-create any missing (single round-trip)
    const present = new Set(existing.map((p) => p.action));
    const toCreate = keys
      .filter((k) => !present.has(k))
      .map((k) => ({ action: k, roles: [], description: labelByKey.get(k) || k }));

    if (toCreate.length) {
      await db.Permission.bulkCreate(toCreate, { ignoreDuplicates: true });
      // Re-read after insert to have a complete in-memory list
      existing = await db.Permission.findAll({
        where: { action: { [Op.in]: keys } },
        attributes: ["action", "roles"],
      });
    }

    // 4) Roles + matrix (translate names -> IDs)
    const roles = await db.Role.findAll({ order: [["name", "ASC"]] });
    const rolesList = roles.map((r) => ({ id: r.id, name: r.name, isSystem: !!r.isSystem }));
    const rolesByName = new Map(
      rolesList.map((r) => [String(r.name || "").toLowerCase(), r.id])
    );

    const byAction = new Map(existing.map((p) => [p.action, p]));
    const matrix = {};
    for (const key of keys) {
      const row = byAction.get(key);
      matrix[key] = toRoleIds(row?.roles || [], rolesByName);
    }

    return res.json({ roles: rolesList, catalog: CATALOG, matrix });
  } catch (e) {
    console.error("getMatrix error:", e);
    return res.status(500).json({ error: "Failed to build permission matrix" });
  }
};

/* ----------------------------------- PUT ---------------------------------- */
// PUT /api/permissions/role/:roleId  Body: { actions: string[], mode?: "replace"|"add"|"remove"|"merge" }
exports.saveForRole = async (req, res) => {
  try {
    const roleId = safeString(req.params.roleId);
    const role = await db.Role.findByPk(roleId);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const actions = Array.isArray(req.body?.actions)
      ? req.body.actions.map(safeString).filter(Boolean)
      : null;
    if (!actions) return res.status(400).json({ error: "actions must be an array of action strings" });

    let mode = safeString(req.body?.mode || "replace").toLowerCase();
    if (mode === "merge") mode = "add";
    if (!["replace", "add", "remove"].includes(mode))
      return res.status(400).json({ error: "Invalid mode" });

    const roleNameLc = String(role.name || "").toLowerCase();

    // Ensure requested actions exist (small N)
    for (const a of actions) await ensurePermissionRow(a, a);

    // Load all permissions once (safe for small table sizes)
    const allPerms = await db.Permission.findAll();

    if (mode === "replace") {
      // Remove from all
      await Promise.all(
        allPerms.map(async (p) => {
          const set = new Set(asLower(p.roles));
          set.delete(roleNameLc);
          p.roles = Array.from(set);
          await p.save();
        })
      );
      // Add to specified
      await Promise.all(
        allPerms
          .filter((p) => actions.includes(p.action))
          .map(async (p) => {
            const set = new Set(asLower(p.roles));
            set.add(roleNameLc);
            p.roles = Array.from(set);
            await p.save();
          })
      );
    } else if (mode === "add") {
      await Promise.all(
        allPerms
          .filter((p) => actions.includes(p.action))
          .map(async (p) => {
            const set = new Set(asLower(p.roles));
            set.add(roleNameLc);
            p.roles = Array.from(set);
            await p.save();
          })
      );
    } else if (mode === "remove") {
      await Promise.all(
        allPerms
          .filter((p) => actions.includes(p.action))
          .map(async (p) => {
            const set = new Set(asLower(p.roles));
            set.delete(roleNameLc);
            p.roles = Array.from(set);
            await p.save();
          })
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("saveForRole error:", e);
    return res.status(500).json({ error: "Failed to save role permissions" });
  }
};
