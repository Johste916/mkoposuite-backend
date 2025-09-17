'use strict';
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/* ---------- Connection / global model defaults tuned for Postgres ---------- */
const LOG_SQL = process.env.DEBUG_SQL === '1' || process.env.SQL_DEBUG === '1';

const common = {
  dialect: 'postgres',
  logging: LOG_SQL ? (msg) => console.log('[sql]', msg) : false,
  benchmark: LOG_SQL,
  // ✅ Postgres understands 'UTC' or '+00:00' — NOT 'Z'
  timezone: 'UTC',
  quoteIdentifiers: true,        // keep case of "createdAt"/"updatedAt"
  searchPath: 'public',          // ensure we hit the public schema
  retry: { max: 3 },
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: 0,
    idle: 10000,
    acquire: 30000,
  },
  define: {
    schema: 'public',
    // ⬇️ Critical: our tables use camelCase timestamp columns
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    // Do NOT set underscored globally; individual models may still use snake_case via `field: '...'`
  },
  // Ensure models that specify underscored don't downgrade timestamps to created_at
  hooks: {
    beforeDefine: (_attrs, options) => {
      if (!Object.prototype.hasOwnProperty.call(options, 'timestamps')) options.timestamps = true;
      if (!Object.prototype.hasOwnProperty.call(options, 'createdAt')) options.createdAt = 'createdAt';
      if (!Object.prototype.hasOwnProperty.call(options, 'updatedAt')) options.updatedAt = 'updatedAt';
    },
  },
};

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      ...common,
      dialectOptions: {
        ssl: { require: true, rejectUnauthorized: false }, // Supabase/managed PG
        keepAlive: true,
        application_name: process.env.APP_NAME || 'mkoposuite',
      },
    })
  : new Sequelize(
      process.env.DB_NAME || 'mkoposuite_dev',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASS || null,
      {
        ...common,
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 5432,
        dialectOptions: { application_name: process.env.APP_NAME || 'mkoposuite' },
      }
    );

const db = {};

/* ---------- Helpers ---------- */
const tryLoad = (loader, nameForLog) => {
  try { return loader(); }
  catch (e) { console.warn(`⚠️  Model not loaded: ${nameForLog} (${e.message})`); return null; }
};
const hasAttr = (model, attr) =>
  !!(model && model.rawAttributes && (model.rawAttributes[attr] || Object.values(model.rawAttributes).some(a => a.field === attr)));

/* ---------- Core models ---------- */
db.User          = require('./user')(sequelize, DataTypes);
db.Branch        = tryLoad(() => require('./branch')(sequelize, DataTypes), 'Branch');
db.Borrower      = tryLoad(() => require('./borrower')(sequelize, DataTypes), 'Borrower');
db.Loan          = tryLoad(() => require('./loan')(sequelize, DataTypes), 'Loan');
db.LoanRepayment = tryLoad(() => require('./loanrepayment')(sequelize, DataTypes), 'LoanRepayment');
db.LoanPayment   = tryLoad(() => require('./loanpayment')(sequelize, DataTypes), 'LoanPayment');
db.Setting       = require('./setting')(sequelize, DataTypes);
db.LoanProduct   = tryLoad(() => require('./LoanProduct')(sequelize, DataTypes), 'LoanProduct');

/* ✅ Banks & Transactions */
db.Bank            = tryLoad(() => require('./bank')(sequelize, DataTypes), 'Bank');
db.BankTransaction = tryLoad(() => require('./bankTransaction')(sequelize, DataTypes), 'BankTransaction');

/* ✅ Cashbook */
db.CashAccount     = tryLoad(() => require('./cashAccount')(sequelize, DataTypes), 'CashAccount');
db.CashTransaction = tryLoad(() => require('./cashTransaction')(sequelize, DataTypes), 'CashTransaction');

/* Multitenancy */
db.Tenant     = tryLoad(() => require('./Tenant')(sequelize, DataTypes), 'Tenant');
db.TenantUser = tryLoad(() => require('./TenantUser')(sequelize, DataTypes), 'TenantUser');

/* Access control (optional) */
db.Role       = tryLoad(() => require('./Role')(sequelize, DataTypes), 'Role');
db.UserRole   = tryLoad(() => require('./UserRole')(sequelize, DataTypes), 'UserRole');
db.Permission = tryLoad(() => require('./Permission')(sequelize, DataTypes), 'Permission');

/* Savings (required) */
db.SavingsTransaction = tryLoad(() => require('./savingstransaction')(sequelize, DataTypes), 'SavingsTransaction');

/* Optional modules */
db.ReportSubscription      = tryLoad(() => require('./ReportSubscription')(sequelize, DataTypes), 'ReportSubscription');
db.Communication           = tryLoad(() => require('./Communication')(sequelize, DataTypes), 'Communication');
db.CommunicationAttachment = tryLoad(() => require('./CommunicationAttachment')(sequelize, DataTypes), 'CommunicationAttachment');
db.AuditLog                = tryLoad(() => require('./AuditLog')(sequelize, DataTypes), 'AuditLog');

/* Activity (optional) */
db.ActivityLog        = tryLoad(() => require('./ActivityLog')(sequelize, DataTypes), 'ActivityLog');
db.ActivityComment    = tryLoad(() => require('./ActivityComment')(sequelize, DataTypes), 'ActivityComment');
db.ActivityAssignment = tryLoad(() => require('./ActivityAssignment')(sequelize, DataTypes), 'ActivityAssignment');

/* Accounting (optional) */
db.Account      = tryLoad(() => require('./account')(sequelize, DataTypes), 'Account');
db.JournalEntry = tryLoad(() => require('./journalEntry')(sequelize, DataTypes), 'JournalEntry');
db.LedgerEntry  = tryLoad(() => require('./ledgerEntry')(sequelize, DataTypes), 'LedgerEntry');

/* Collections / Collateral / Expense / Investors (optional) */
db.CollectionSheet = tryLoad(() => require('./collectionSheet')(sequelize, DataTypes), 'CollectionSheet');
db.Collateral      = tryLoad(() => require('./collateral')(sequelize, DataTypes), 'Collateral');
db.Expense         = tryLoad(() => require('./expense')(sequelize, DataTypes), 'Expense');
db.Investor        = tryLoad(() => require('./investor')(sequelize, DataTypes), 'Investor');

/* HR & Payroll (optional) */
db.Employee     = tryLoad(() => require('./employee')(sequelize, DataTypes), 'Employee');
db.Attendance   = tryLoad(() => require('./attendance')(sequelize, DataTypes), 'Attendance');
db.PayrollItem  = tryLoad(() => require('./payrollItem')(sequelize, DataTypes), 'PayrollItem');
db.Payrun       = tryLoad(() => require('./payrun')(sequelize, DataTypes), 'Payrun');
db.Payslip      = tryLoad(() => require('./payslip')(sequelize, DataTypes), 'Payslip');
db.LeaveRequest = tryLoad(() => require('./leaveRequest')(sequelize, DataTypes), 'LeaveRequest');
db.Contract     = tryLoad(() => require('./contract')(sequelize, DataTypes), 'Contract');

/* Plans & Entitlements (optional) */
db.Plan            = tryLoad(() => require('./plan')(sequelize, DataTypes), 'Plan');
db.Entitlement     = tryLoad(() => require('./entitlement')(sequelize, DataTypes), 'Entitlement');
db.PlanEntitlement = tryLoad(() => require('./planentitlement')(sequelize, DataTypes), 'PlanEntitlement');

/* ---------------- Associations (core) ---------------- */
if (db.User && db.Branch) {
  db.User.belongsTo(db.Branch,   { foreignKey: 'branchId' });
  db.Branch.hasMany(db.User,     { foreignKey: 'branchId' });
}

if (db.Borrower && db.Branch) {
  // ✅ Use the model attribute `branchId` (which maps to DB column branch_id via field)
  db.Borrower.belongsTo(db.Branch, { foreignKey: 'branchId' });
  db.Branch.hasMany(db.Borrower,   { foreignKey: 'branchId' });
}

if (db.Loan && db.Borrower) {
  db.Loan.belongsTo(db.Borrower, { foreignKey: 'borrowerId' });
  db.Borrower.hasMany(db.Loan,   { foreignKey: 'borrowerId' });
}

if (db.Loan && db.Branch) {
  db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId' });
  db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.Loan,   { foreignKey: 'branchId' });
  db.Branch.hasMany(db.Loan,   { foreignKey: 'branchId', as: 'loans' });
}

if (db.LoanRepayment && db.Loan) {
  db.LoanRepayment.belongsTo(db.Loan, { foreignKey: 'loanId' });
  db.Loan.hasMany(db.LoanRepayment,   { foreignKey: 'loanId' });
}

if (db.LoanPayment && db.Loan) {
  db.LoanPayment.belongsTo(db.Loan, { foreignKey: 'loanId' });
  db.Loan.hasMany(db.LoanPayment,   { foreignKey: 'loanId' });
}

if (db.LoanPayment && db.User) {
  db.LoanPayment.belongsTo(db.User, { foreignKey: 'userId' });
  db.User.hasMany(db.LoanPayment,   { foreignKey: 'userId' });
}

if (db.Loan && db.LoanProduct) {
  db.Loan.belongsTo(db.LoanProduct, { foreignKey: 'productId' });
  db.LoanProduct.hasMany(db.Loan,   { foreignKey: 'productId' });
}

/* Loan ↔ User workflow (guarded) */
if (db.Loan && db.User) {
  if (hasAttr(db.Loan, 'approvedBy')) {
    db.Loan.belongsTo(db.User, { foreignKey: 'approvedBy' });
    db.Loan.belongsTo(db.User, { foreignKey: 'approvedBy', as: 'approver' });
    db.User.hasMany(db.Loan,   { foreignKey: 'approvedBy', as: 'approvedLoans' });
  }
  if (hasAttr(db.Loan, 'disbursedBy')) {
    db.Loan.belongsTo(db.User, { foreignKey: 'disbursedBy', as: 'disburser' });
    db.User.hasMany(db.Loan,   { foreignKey: 'disbursedBy', as: 'disbursedLoans' });
  }
  if (hasAttr(db.Loan, 'initiatedBy')) {
    db.Loan.belongsTo(db.User, { foreignKey: 'initiatedBy', as: 'initiator' });
    db.User.hasMany(db.Loan,   { foreignKey: 'initiatedBy', as: 'initiatedLoans' });
  }
  if (hasAttr(db.Loan, 'rejectedBy')) {
    db.Loan.belongsTo(db.User, { foreignKey: 'rejectedBy',  as: 'rejector' });
    db.User.hasMany(db.Loan,   { foreignKey: 'rejectedBy',  as: 'rejectedLoans' });
  }
}

/* Collateral */
if (db.Collateral && db.Borrower) {
  db.Collateral.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
  db.Borrower.hasMany(db.Collateral,   { foreignKey: 'borrowerId', as: 'collateral' });
}
if (db.Collateral && db.Loan) {
  db.Collateral.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' });
  db.Loan.hasMany(db.Collateral,   { foreignKey: 'loanId', as: 'collateral' });
}
if (db.Collateral && db.User) {
  db.Collateral.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' });
  db.Collateral.belongsTo(db.User, { foreignKey: 'updatedBy', as: 'updater' });
}

/* Expense */
if (db.Expense && db.User) {
  db.Expense.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' });
  db.Expense.belongsTo(db.User, { foreignKey: 'updatedBy', as: 'updater' });
}
if (db.Expense && db.Branch) {
  db.Expense.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
}

/* Savings ↔ Borrower */
if (db.SavingsTransaction && db.Borrower) {
  db.SavingsTransaction.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
  db.Borrower.hasMany(db.SavingsTransaction,   { foreignKey: 'borrowerId', as: 'savingsTransactions' });
}

/* Communications */
if (db.Communication && db.CommunicationAttachment) {
  db.Communication.hasMany(db.CommunicationAttachment, { foreignKey: 'communicationId', as: 'attachments', onDelete: 'CASCADE' });
  db.CommunicationAttachment.belongsTo(db.Communication, { foreignKey: 'communicationId', as: 'communication' });
}

/* Audit logs */
if (db.AuditLog && db.User) {
  db.AuditLog.belongsTo(db.User,   { foreignKey: 'userId',  as: 'user' });
  db.User.hasMany(db.AuditLog,     { foreignKey: 'userId',  as: 'auditLogs' });
}
if (db.AuditLog && db.Branch) {
  db.AuditLog.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.AuditLog,   { foreignKey: 'branchId', as: 'auditLogs' });
}

/* Activity */
if (db.ActivityLog && db.User) {
  db.ActivityLog.belongsTo(db.User, { foreignKey: 'userId', as: 'User' });
  db.User.hasMany(db.ActivityLog,   { foreignKey: 'userId' });
}
if (db.ActivityComment && db.ActivityLog) {
  db.ActivityComment.belongsTo(db.ActivityLog, { foreignKey: 'activityId' });
  db.ActivityLog.hasMany(db.ActivityComment,   { foreignKey: 'activityId' });
}
if (db.ActivityComment && db.User) {
  db.ActivityComment.belongsTo(db.User, { foreignKey: 'userId', as: 'User' });
}
if (db.ActivityAssignment && db.ActivityLog) {
  db.ActivityAssignment.belongsTo(db.ActivityLog, { foreignKey: 'activityId' });
  db.ActivityLog.hasMany(db.ActivityAssignment,   { foreignKey: 'activityId' });
}
if (db.ActivityAssignment && db.User) {
  db.ActivityAssignment.belongsTo(db.User, { foreignKey: 'assigneeId', as: 'assignee' });
  db.ActivityAssignment.belongsTo(db.User, { foreignKey: 'assignerId', as: 'assigner' });
}

/* ---------- Accounting associations ---------- */
if (db.Account && db.LedgerEntry) {
  db.Account.hasMany(db.LedgerEntry, { foreignKey: 'accountId' });
  db.LedgerEntry.belongsTo(db.Account, { foreignKey: 'accountId' });
}
if (db.JournalEntry && db.LedgerEntry) {
  db.JournalEntry.hasMany(db.LedgerEntry, { foreignKey: 'journalEntryId' });
  db.LedgerEntry.belongsTo(db.JournalEntry, { foreignKey: 'journalEntryId' });
}

/* ---------- HR & Payroll associations ---------- */
if (db.Employee && db.Branch) {
  db.Employee.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.Employee,   { foreignKey: 'branchId', as: 'employees' });
}
if (db.Attendance && db.Employee) {
  const fk = hasAttr(db.Attendance, 'employee_id') ? 'employee_id' : 'employeeId';
  db.Attendance.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
  db.Employee.hasMany(db.Attendance,   { foreignKey: fk, as: 'attendance' });
}
if (db.PayrollItem && db.Employee) {
  const fk = hasAttr(db.PayrollItem, 'employee_id') ? 'employee_id' : 'employeeId';
  db.PayrollItem.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
  db.Employee.hasMany(db.PayrollItem,   { foreignKey: fk, as: 'payItems' });
}
if (db.Payslip && db.Employee) {
  const fk = hasAttr(db.Payslip, 'employee_id') ? 'employee_id' : 'employeeId';
  db.Payslip.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
  db.Employee.hasMany(db.Payslip,   { foreignKey: fk, as: 'payslips' });
}
if (db.Payslip && db.Payrun) {
  const fk = hasAttr(db.Payslip, 'payrun_id') ? 'payrun_id' : 'payrunId';
  db.Payslip.belongsTo(db.Payrun, { foreignKey: fk, as: 'payrun' });
  db.Payrun.hasMany(db.Payslip,   { foreignKey: fk, as: 'payslips' });
}
if (db.LeaveRequest && db.Employee) {
  const fk = hasAttr(db.LeaveRequest, 'employee_id') ? 'employee_id' : 'employeeId';
  db.LeaveRequest.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
  db.Employee.hasMany(db.LeaveRequest,   { foreignKey: fk, as: 'leaveRequests' });
}
if (db.Contract && db.Employee) {
  const fk = hasAttr(db.Contract, 'employee_id') ? 'employee_id' : 'employeeId';
  db.Contract.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
  db.Employee.hasMany(db.Contract,   { foreignKey: fk, as: 'contracts' });
}

/* ---------- Plans & Entitlements associations (guarded) ---------- */
if (db.Plan && db.Entitlement) {
  if (db.PlanEntitlement) {
    db.Plan.belongsToMany(db.Entitlement, { through: db.PlanEntitlement, foreignKey: 'plan_id', otherKey: 'entitlement_id', as: 'entitlements' });
    db.Entitlement.belongsToMany(db.Plan, { through: db.PlanEntitlement, foreignKey: 'entitlement_id', otherKey: 'plan_id', as: 'plans' });
  } else {
    db.Plan.belongsToMany(db.Entitlement, { through: 'plan_entitlements', foreignKey: 'plan_id', otherKey: 'entitlement_id', as: 'entitlements' });
    db.Entitlement.belongsToMany(db.Plan, { through: 'plan_entitlements', foreignKey: 'entitlement_id', otherKey: 'plan_id', as: 'plans' });
  }
}

/* ---------- Bank & Cash associations ---------- */
if (db.Bank && db.Tenant) {
  db.Bank.belongsTo(db.Tenant, { foreignKey: 'tenantId', as: 'tenant' });
  db.Tenant.hasMany(db.Bank,   { foreignKey: 'tenantId', as: 'banks' });
}
if (db.Bank && db.BankTransaction) {
  db.Bank.hasMany(db.BankTransaction, { foreignKey: 'bankId', as: 'transactions' });
  db.BankTransaction.belongsTo(db.Bank, { foreignKey: 'bankId', as: 'bank' });
}
if (db.BankTransaction && db.Tenant) {
  db.BankTransaction.belongsTo(db.Tenant, { foreignKey: 'tenantId', as: 'tenant' });
}
if (db.BankTransaction && db.User) {
  db.BankTransaction.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' });
}
if (db.BankTransaction && db.Loan) {
  db.BankTransaction.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' });
  db.Loan.hasMany(db.BankTransaction,   { foreignKey: 'loanId', as: 'bankTransactions' });
}
if (db.BankTransaction && db.Borrower) {
  db.BankTransaction.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
}

if (db.CashAccount && db.Tenant) {
  db.CashAccount.belongsTo(db.Tenant, { foreignKey: 'tenantId', as: 'tenant' });
  db.Tenant.hasMany(db.CashAccount,   { foreignKey: 'tenantId', as: 'cashAccounts' });
}
if (db.CashAccount && db.CashTransaction) {
  db.CashAccount.hasMany(db.CashTransaction, { foreignKey: 'cashAccountId', as: 'transactions' });
  db.CashTransaction.belongsTo(db.CashAccount, { foreignKey: 'cashAccountId', as: 'cashAccount' });
}
if (db.CashTransaction && db.User) {
  db.CashTransaction.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' });
}
if (db.CashTransaction && db.Loan) {
  db.CashTransaction.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' });
  db.Loan.hasMany(db.CashTransaction,   { foreignKey: 'loanId', as: 'cashTransactions' });
}
if (db.CashTransaction && db.Borrower) {
  db.CashTransaction.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
}

/* ---------- Export ---------- */
db.sequelize = sequelize;
db.Sequelize = Sequelize;
module.exports = db;
