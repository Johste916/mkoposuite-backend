"use strict";

/**
 * Add missing columns + create compat view(s).
 * If a repayments table doesn't exist, create `loan_repayments`.
 * Works with sequelize-cli and Umzug wrappers.
 */

const ADDED = { Indexes: [], Views: [], Columns: {}, Tables: [] };

// ───────── helpers ─────────
function resolveArgs(args) {
  if (args.length === 2 && args[0]?.sequelize) {
    const [qi, Sequelize] = args;
    return { qi, sequelize: qi.sequelize, DataTypes: Sequelize?.DataTypes ?? require("sequelize").DataTypes };
  }
  if (args.length === 1 && args[0]?.context) {
    const { context: qi, Sequelize } = args[0];
    return { qi, sequelize: qi.sequelize, DataTypes: Sequelize?.DataTypes ?? require("sequelize").DataTypes };
  }
  const qi = args[0];
  return { qi, sequelize: qi?.sequelize, DataTypes: require("sequelize").DataTypes };
}

const ESC = (sequelize, s) => sequelize.escape(s);
const qpub = (name) => `"public"."${name}"`;

function camelToSnake(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function tableCandidates(base, extras = []) {
  const snake = camelToSnake(base);
  const snakeSing = snake.endsWith("s") ? snake.slice(0, -1) : snake;
  const camelSing = base.endsWith("s") ? base.slice(0, -1) : base;
  return [
    base, camelSing,
    snake, snakeSing,
    base.toLowerCase(), camelSing.toLowerCase(),
    ...extras,
  ];
}

async function pickExistingTable(sequelize, candidates) {
  for (const name of candidates) {
    const sql = `SELECT to_regclass(${ESC(sequelize, `${qpub(name)}`)}) AS reg;`;
    const [rows] = await sequelize.query(sql).catch(() => [null]);
    if (Array.isArray(rows) && rows[0]?.reg) return name;
  }
  return null;
}

async function describeSafe(qi, table) {
  try { return await qi.describeTable(table); } catch { return null; }
}

async function addColumnIfMissing(qi, table, column, spec) {
  const desc = await describeSafe(qi, table);
  if (!desc) return;
  if (!desc[column]) {
    await qi.addColumn(table, column, spec);
    (ADDED.Columns[table] ||= []).push(column);
  }
}

async function addIndexIfMissing(qi, table, fields, name, options = {}) {
  const indexes = await qi.showIndex(table).catch(() => []);
  const exists = indexes?.some((ix) => ix.name === name);
  if (!exists) {
    await qi.addIndex(table, { name, fields, ...options });
    ADDED.Indexes.push({ table, name });
  }
}

async function removeIndexIfAdded(qi, table, name) {
  const wasAdded = ADDED.Indexes.some((x) => x.table === table && x.name === name);
  if (wasAdded) {
    try { await qi.removeIndex(table, name); } catch {}
  }
}

async function removeColumnIfAdded(qi, table, column) {
  if ((ADDED.Columns[table] || []).includes(column)) {
    const desc = await describeSafe(qi, table);
    if (desc && desc[column]) {
      await qi.removeColumn(table, column);
    }
  }
}

async function dropViewIfAdded(sequelize, name) {
  const dialect = sequelize.getDialect?.() || sequelize?.dialect?.name;
  if (dialect !== "postgres") return;
  if (ADDED.Views.includes(name)) {
    await sequelize.query(`DROP VIEW IF EXISTS "${name}";`);
  }
}

// ───────── smart discovery / creation ─────────
async function ensureBorrowersTable(sequelize) {
  const name = await pickExistingTable(
    sequelize,
    tableCandidates("Borrowers", ["borrowers"])
  );
  if (!name) throw new Error(`Borrowers table not found (tried: Borrowers/borrowers).`);
  return name;
}

async function ensureLoansTable(sequelize) {
  const name = await pickExistingTable(
    sequelize,
    tableCandidates("Loans", ["loans"])
  );
  if (!name) throw new Error(`Loans table not found (tried: Loans/loans).`);
  return name;
}

async function ensureSavingsTxTable(sequelize) {
  const name = await pickExistingTable(
    sequelize,
    tableCandidates("SavingsTransactions", ["savings_transactions", "savingstransactions", "savings", "transactions"])
  );
  if (!name) throw new Error(`Savings transactions table not found.`);
  return name;
}

/**
 * Try hard to find a repayments table; if none exists, create `loan_repayments`.
 */
async function ensureRepaymentsTable(qi, sequelize, DataTypes) {
  // Broad list of plausible names seen in various codebases
  const guesses = [
    ...tableCandidates("LoanRepayments", ["loan_repayments", "loanrepayments"]),
    ...tableCandidates("Repayments", ["repayments"]),
    ...tableCandidates("LoanPayments", ["loan_payments", "loanpayments", "payments"]),
    ...tableCandidates("Installments", ["installments"]),
    ...tableCandidates("LoanInstallments", ["loan_installments", "loaninstallments"]),
    "loan_repayment_schedules", "repayment_schedules"
  ];
  const existing = await pickExistingTable(sequelize, guesses);
  if (existing) return existing;

  // Create a standard table if nothing exists
  const table = "loan_repayments";
  await qi.createTable(table, {
    id:            { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    loanId:        { type: DataTypes.BIGINT, allowNull: false },
    dueDate:       { type: DataTypes.DATEONLY, allowNull: true },
    date:          { type: DataTypes.DATEONLY, allowNull: true },
    scheduledDate: { type: DataTypes.DATEONLY, allowNull: true },
    repaymentDate: { type: DataTypes.DATE,     allowNull: true },
    amountPaid:    { type: DataTypes.DECIMAL(18,2), allowNull: true },
    amount:        { type: DataTypes.DECIMAL(18,2), allowNull: true },
    status:        { type: DataTypes.STRING(24),    allowNull: true },
    createdAt:     { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("now()") },
    updatedAt:     { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal("now()") },
  });
  ADDED.Tables.push(table);
  return table;
}

async function createLoanPaymentView(sequelize, repaymentsTable) {
  const dialect = sequelize.getDialect?.() || sequelize?.dialect?.name;
  if (dialect !== "postgres") return;

  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_views WHERE viewname = 'LoanPayment' LIMIT 1;`
  ).catch(() => [null]);

  const exists = Array.isArray(rows) && rows.length > 0;

  if (!exists) {
    await sequelize.query(`
      CREATE VIEW "LoanPayment" AS
      SELECT
        rp.id,
        rp."loanId",
        COALESCE(rp."dueDate", rp."date", rp."scheduledDate", rp."repaymentDate", rp."createdAt") AS "dueDate",
        COALESCE(rp."amountPaid", rp."amount") AS "amount",
        rp.status,
        rp."createdAt",
        rp."updatedAt"
      FROM "${repaymentsTable}" rp;
    `);
    ADDED.Views.push("LoanPayment");
  }
}

// ───────── migration ─────────
module.exports = {
  async up(...args) {
    const { qi, sequelize, DataTypes } = resolveArgs(args);

    // Discover or create required tables
    const BorrowersTable      = await ensureBorrowersTable(sequelize);
    const LoansTable          = await ensureLoansTable(sequelize);
    const LoanRepaymentsTable = await ensureRepaymentsTable(qi, sequelize, DataTypes);
    const SavingsTxTable      = await ensureSavingsTxTable(sequelize);

    // Borrowers – align with AddBorrower/BorrowerDetails forms
    await addColumnIfMissing(qi, BorrowersTable, "photoUrl",         { type: DataTypes.STRING(512), allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "gender",           { type: DataTypes.STRING(24),  allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "birthDate",        { type: DataTypes.DATEONLY,    allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "employmentStatus", { type: DataTypes.STRING(64),  allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "idType",           { type: DataTypes.STRING(32),  allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "idIssuedDate",     { type: DataTypes.DATEONLY,    allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "idExpiryDate",     { type: DataTypes.DATEONLY,    allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "nextKinName",      { type: DataTypes.STRING(120), allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "nextKinPhone",     { type: DataTypes.STRING(40),  allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "regDate",          { type: DataTypes.DATEONLY,    allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "loanOfficerId",    { type: DataTypes.INTEGER,     allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "groupId",          { type: DataTypes.INTEGER,     allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "branchId",         { type: DataTypes.INTEGER,     allowNull: true });
    await addColumnIfMissing(qi, BorrowersTable, "status",           { type: DataTypes.STRING(32),  allowNull: false, defaultValue: "active" });

    await addIndexIfMissing(qi, BorrowersTable, ["branchId"], "borrowers_branchId_idx");
    await addIndexIfMissing(qi, BorrowersTable, ["status"],   "borrowers_status_idx");

    // Loans – add common analytics & linkage columns
    await addColumnIfMissing(qi, LoansTable, "amount",            { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 });
    await addColumnIfMissing(qi, LoansTable, "interestRate",      { type: DataTypes.DECIMAL(9,4),  allowNull: true });
    await addColumnIfMissing(qi, LoansTable, "term",              { type: DataTypes.INTEGER,       allowNull: true });
    await addColumnIfMissing(qi, LoansTable, "productId",         { type: DataTypes.INTEGER,       allowNull: true });
    await addColumnIfMissing(qi, LoansTable, "branchId",          { type: DataTypes.INTEGER,       allowNull: true });
    await addColumnIfMissing(qi, LoansTable, "disbursementDate",  { type: DataTypes.DATEONLY,      allowNull: true });
    await addColumnIfMissing(qi, LoansTable, "reference",         { type: DataTypes.STRING(80),    allowNull: true });
    await addColumnIfMissing(qi, LoansTable, "status",            { type: DataTypes.STRING(32),    allowNull: false, defaultValue: "pending" });
    await addColumnIfMissing(qi, LoansTable, "nextDueDate",       { type: DataTypes.DATEONLY,      allowNull: true });
    await addColumnIfMissing(qi, LoansTable, "nextDueAmount",     { type: DataTypes.DECIMAL(18,2), allowNull: true });
    await addColumnIfMissing(qi, LoansTable, "outstandingAmount", { type: DataTypes.DECIMAL(18,2), allowNull: true });

    await addIndexIfMissing(qi, LoansTable, ["borrowerId"], "loans_borrowerId_idx");
    await addIndexIfMissing(qi, LoansTable, ["status"],     "loans_status_idx");
    await addIndexIfMissing(qi, LoansTable, ["nextDueDate"],"loans_nextDueDate_idx");

    // Loan repayments – normalize columns
    await addColumnIfMissing(qi, LoanRepaymentsTable, "dueDate",       { type: DataTypes.DATEONLY,      allowNull: true });
    await addColumnIfMissing(qi, LoanRepaymentsTable, "date",          { type: DataTypes.DATEONLY,      allowNull: true });
    await addColumnIfMissing(qi, LoanRepaymentsTable, "scheduledDate", { type: DataTypes.DATEONLY,      allowNull: true });
    await addColumnIfMissing(qi, LoanRepaymentsTable, "repaymentDate", { type: DataTypes.DATE,          allowNull: true });
    await addColumnIfMissing(qi, LoanRepaymentsTable, "amountPaid",    { type: DataTypes.DECIMAL(18,2), allowNull: true });
    await addColumnIfMissing(qi, LoanRepaymentsTable, "amount",        { type: DataTypes.DECIMAL(18,2), allowNull: true });
    await addColumnIfMissing(qi, LoanRepaymentsTable, "status",        { type: DataTypes.STRING(24),    allowNull: true });

    await addIndexIfMissing(qi, LoanRepaymentsTable, ["loanId"],  "loanrepayments_loanId_idx");
    await addIndexIfMissing(qi, LoanRepaymentsTable, ["dueDate"], "loanrepayments_dueDate_idx");

    // Savings transactions
    await addColumnIfMissing(qi, SavingsTxTable, "type",      { type: DataTypes.STRING(24),    allowNull: true });
    await addColumnIfMissing(qi, SavingsTxTable, "amount",    { type: DataTypes.DECIMAL(18,2), allowNull: false, defaultValue: 0 });
    await addColumnIfMissing(qi, SavingsTxTable, "date",      { type: DataTypes.DATEONLY,      allowNull: true });
    await addColumnIfMissing(qi, SavingsTxTable, "notes",     { type: DataTypes.STRING(512),   allowNull: true });
    await addColumnIfMissing(qi, SavingsTxTable, "reference", { type: DataTypes.STRING(120),   allowNull: true });
    await addColumnIfMissing(qi, SavingsTxTable, "status",    { type: DataTypes.STRING(24),    allowNull: true });
    await addColumnIfMissing(qi, SavingsTxTable, "reversed",  { type: DataTypes.BOOLEAN,       allowNull: false, defaultValue: false });

    await addIndexIfMissing(qi, SavingsTxTable, ["borrowerId"], "savingstx_borrowerId_idx");
    await addIndexIfMissing(qi, SavingsTxTable, ["date"],       "savingstx_date_idx");

    // Compat view so code reading LoanPayment.dueDate works regardless of base schema
    await createLoanPaymentView(sequelize, LoanRepaymentsTable);
  },

  async down(...args) {
    const { qi, sequelize } = resolveArgs(args);

    // Drop compat view if we created it
    await dropViewIfAdded(sequelize, "LoanPayment");

    // Drop indexes we added
    for (const ix of ADDED.Indexes) {
      await removeIndexIfAdded(qi, ix.table, ix.name);
    }

    // Drop columns we added
    for (const [table, cols] of Object.entries(ADDED.Columns)) {
      for (const col of cols) {
        await removeColumnIfAdded(qi, table, col);
      }
    }

    // Drop any table we created (loan_repayments)
    for (const t of ADDED.Tables) {
      try { await qi.dropTable(t); } catch {}
    }
  },
};
