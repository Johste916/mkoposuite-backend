'use strict';
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/* ---------- Connection / global model defaults tuned for Postgres ---------- */
const LOG_SQL = process.env.DEBUG_SQL === '1' || process.env.SQL_DEBUG === '1';

const common = {
  dialect: 'postgres',
  logging: LOG_SQL ? (msg) => console.log('[sql]', msg) : false,
  benchmark: LOG_SQL,
  timezone: 'UTC',
  quoteIdentifiers: true,
  searchPath: 'public',
  retry: { max: 3 },
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: 0,
    idle: 10000,
    acquire: 30000,
  },
  define: {
    schema: 'public',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    // 🔒 Be explicit so we don't accidentally generate branch_id / users
    underscored: false,
    freezeTableName: false,
  },
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
        ssl: { require: true, rejectUnauthorized: false },
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

const safeAssoc = (fn, label) => {
  try { fn(); } catch (e) { console.warn(`⚠️  Association skipped (${label}): ${e.message}`); }
};

/* ---------- Core models ---------- */
db.User          = require('./user')(sequelize, DataTypes);
db.Branch        = tryLoad(() => require('./branch')(sequelize, DataTypes), 'Branch');
db.Borrower      = tryLoad(() => require('./borrower')(sequelize, DataTypes), 'Borrower');
db.Loan          = tryLoad(() => require('./loan')(sequelize, DataTypes), 'Loan');
db.LoanRepayment = tryLoad(() => require('./loanrepayment')(sequelize, DataTypes), 'LoanRepayment');
db.LoanPayment   = tryLoad(() => require('./loanpayment')(sequelize, DataTypes), 'LoanPayment');

/* 🆕 Ensure LoanSchedule is registered regardless of file casing */
db.LoanSchedule =
 tryLoad(() => require('./loanSchedule')(sequelize, DataTypes), 'LoanSchedule') ||
  tryLoad(() => require('./loanSchedule')(sequelize, DataTypes), 'LoanSchedule');

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
db.Role          = tryLoad(() => require('./Role')(sequelize, DataTypes), 'Role');
db.UserRole      = tryLoad(() => require('./UserRole')(sequelize, DataTypes), 'UserRole');
db.Permission    = tryLoad(() => require('./Permission')(sequelize, DataTypes), 'Permission');
db.RolePermission= tryLoad(() => require('./RolePermission')(sequelize, DataTypes), 'RolePermission');

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

/* 🆕 Borrower Groups */
db.BorrowerGroup       = tryLoad(() => require('./borrowergroup')(sequelize, DataTypes), 'BorrowerGroup');
db.BorrowerGroupMember = tryLoad(() => require('./borrowergroupmember')(sequelize, DataTypes), 'BorrowerGroupMember');

/* ------------------------------------------------------------------
   ✅ Repayment model compatibility shim
------------------------------------------------------------------- */
try {
  if (db.LoanPayment && !db.LoanRepayment) db.LoanRepayment = db.LoanPayment;
  if (db.LoanRepayment && !db.LoanPayment) db.LoanPayment = db.LoanRepayment;

  if (sequelize.models) {
    if (sequelize.models.LoanPayment && !sequelize.models.LoanRepayment) {
      sequelize.models.LoanRepayment = sequelize.models.LoanPayment;
    }
    if (sequelize.models.LoanRepayment && !sequelize.models.LoanPayment) {
      sequelize.models.LoanPayment = sequelize.models.LoanRepayment;
    }
  }
} catch (e) {
  console.warn('⚠️  Repayment alias setup skipped:', e.message);
}

/* ------------------------------------------------------------------
   🔗 Let each model attach its own associations first (if provided)
------------------------------------------------------------------- */
Object.values(db).forEach((m) => {
  if (m && typeof m.associate === 'function') {
    try { m.associate(db); } 
    catch (e) { console.warn(`⚠️  associate() failed for ${m.name || 'model'}: ${e.message}`); }
  }
});

/* ---------------- Associations (core) ---------------- */
if (db.User && db.Branch) {
  safeAssoc(() => db.User.belongsTo(db.Branch,   { foreignKey: 'branchId' }), 'User→Branch');
  safeAssoc(() => db.Branch.hasMany(db.User,     { foreignKey: 'branchId' }), 'Branch→Users');
}

if (db.Borrower && db.Branch) {
  safeAssoc(() => db.Borrower.belongsTo(db.Branch, { foreignKey: 'branchId' }), 'Borrower→Branch');
  safeAssoc(() => db.Branch.hasMany(db.Borrower,   { foreignKey: 'branchId' }), 'Branch→Borrowers');
}

if (db.Loan && db.Borrower) {
  safeAssoc(() => db.Loan.belongsTo(db.Borrower, { foreignKey: 'borrowerId' }), 'Loan→Borrower');
  safeAssoc(() => db.Borrower.hasMany(db.Loan,   { foreignKey: 'borrowerId' }), 'Borrower→Loans');
}

if (db.Loan && db.Branch) {
  safeAssoc(() => db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId' }), 'Loan→Branch');
  safeAssoc(() => db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' }), 'Loan→branch(alias)');
  safeAssoc(() => db.Branch.hasMany(db.Loan,   { foreignKey: 'branchId' }), 'Branch→Loans');
  safeAssoc(() => db.Branch.hasMany(db.Loan,   { foreignKey: 'branchId', as: 'loans' }), 'Branch→loans(alias)');
}

/* 🆕 LoanSchedule associations (only if model loaded) */
if (db.LoanSchedule && db.Loan) {
  safeAssoc(() => db.LoanSchedule.belongsTo(db.Loan, { foreignKey: 'loanId' }), 'Schedule→Loan');
  safeAssoc(() => db.Loan.hasMany(db.LoanSchedule,   { foreignKey: 'loanId' }), 'Loan→Schedules');
}

if (db.LoanRepayment && db.Loan) {
  safeAssoc(() => db.LoanRepayment.belongsTo(db.Loan, { foreignKey: 'loanId' }), 'Repayment→Loan');
  safeAssoc(() => db.Loan.hasMany(db.LoanRepayment,   { foreignKey: 'loanId' }), 'Loan→Repayments');
}

if (db.LoanPayment && db.Loan) {
  safeAssoc(() => db.LoanPayment.belongsTo(db.Loan, { foreignKey: 'loanId' }), 'Payment→Loan');
  safeAssoc(() => db.Loan.hasMany(db.LoanPayment,   { foreignKey: 'loanId' }), 'Loan→Payments');
}

if (db.LoanPayment && db.User) {
  safeAssoc(() => db.LoanPayment.belongsTo(db.User, { foreignKey: 'userId' }), 'Payment→User');
  safeAssoc(() => db.User.hasMany(db.LoanPayment,   { foreignKey: 'userId' }), 'User→Payments');
}

if (db.Loan && db.LoanProduct) {
  safeAssoc(() => db.Loan.belongsTo(db.LoanProduct, { foreignKey: 'productId' }), 'Loan→Product');
  safeAssoc(() => db.LoanProduct.hasMany(db.Loan,   { foreignKey: 'productId' }), 'Product→Loans');
}

/* Loan ↔ User workflow (guarded) */
if (db.Loan && db.User) {
  if (hasAttr(db.Loan, 'approvedBy')) {
    safeAssoc(() => db.Loan.belongsTo(db.User, { foreignKey: 'approvedBy' }), 'Loan→approvedBy');
    safeAssoc(() => db.Loan.belongsTo(db.User, { foreignKey: 'approvedBy', as: 'approver' }), 'Loan→approver(alias)');
    safeAssoc(() => db.User.hasMany(db.Loan,   { foreignKey: 'approvedBy', as: 'approvedLoans' }), 'User→approvedLoans');
  }
  if (hasAttr(db.Loan, 'disbursedBy')) {
    safeAssoc(() => db.Loan.belongsTo(db.User, { foreignKey: 'disbursedBy', as: 'disburser' }), 'Loan→disburser(alias)');
    safeAssoc(() => db.User.hasMany(db.Loan,   { foreignKey: 'disbursedBy', as: 'disbursedLoans' }), 'User→disbursedLoans');
  }
  if (hasAttr(db.Loan, 'initiatedBy')) {
    safeAssoc(() => db.Loan.belongsTo(db.User, { foreignKey: 'initiatedBy', as: 'initiator' }), 'Loan→initiator(alias)');
    safeAssoc(() => db.User.hasMany(db.Loan,   { foreignKey: 'initiatedBy', as: 'initiatedLoans' }), 'User→initiatedLoans');
  }
  if (hasAttr(db.Loan, 'rejectedBy')) {
    safeAssoc(() => db.Loan.belongsTo(db.User, { foreignKey: 'rejectedBy',  as: 'rejector' }), 'Loan→rejector(alias)');
    safeAssoc(() => db.User.hasMany(db.Loan,   { foreignKey: 'rejectedBy',  as: 'rejectedLoans' }), 'User→rejectedLoans');
  }
}

/* Collateral */
if (db.Collateral && db.Borrower) {
  safeAssoc(() => db.Collateral.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' }), 'Collateral→Borrower');
  safeAssoc(() => db.Borrower.hasMany(db.Collateral,   { foreignKey: 'borrowerId', as: 'collateral' }), 'Borrower→Collateral');
}
if (db.Collateral && db.Loan) {
  safeAssoc(() => db.Collateral.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' }), 'Collateral→Loan');
  safeAssoc(() => db.Loan.hasMany(db.Collateral,   { foreignKey: 'loanId', as: 'collateral' }), 'Loan→Collateral');
}
if (db.Collateral && db.User) {
  safeAssoc(() => db.Collateral.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' }), 'Collateral→creator');
  safeAssoc(() => db.Collateral.belongsTo(db.User, { foreignKey: 'updatedBy', as: 'updater' }), 'Collateral→updater');
}

/* Expense */
if (db.Expense && db.User) {
  safeAssoc(() => db.Expense.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' }), 'Expense→creator');
  safeAssoc(() => db.Expense.belongsTo(db.User, { foreignKey: 'updatedBy', as: 'updater' }), 'Expense→updater');
}
if (db.Expense && db.Branch) {
  safeAssoc(() => db.Expense.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' }), 'Expense→branch');
}

/* Savings ↔ Borrower */
if (db.SavingsTransaction && db.Borrower) {
  safeAssoc(() => db.SavingsTransaction.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' }), 'SavingsTx→Borrower');
  safeAssoc(() => db.Borrower.hasMany(db.SavingsTransaction,   { foreignKey: 'borrowerId', as: 'savingsTransactions' }), 'Borrower→SavingsTx');
}

/* Communications */
if (db.Communication && db.CommunicationAttachment) {
  safeAssoc(() => db.Communication.hasMany(db.CommunicationAttachment, { foreignKey: 'communicationId', as: 'attachments', onDelete: 'CASCADE' }), 'Comm→Attachments');
  safeAssoc(() => db.CommunicationAttachment.belongsTo(db.Communication, { foreignKey: 'communicationId', as: 'communication' }), 'Attachment→Comm');
}

/* Audit logs */
if (db.AuditLog && db.User) {
  safeAssoc(() => db.AuditLog.belongsTo(db.User,   { foreignKey: 'userId',  as: 'user' }), 'Audit→User');
  safeAssoc(() => db.User.hasMany(db.AuditLog,     { foreignKey: 'userId',  as: 'auditLogs' }), 'User→AuditLogs');
}
if (db.AuditLog && db.Branch) {
  safeAssoc(() => db.AuditLog.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' }), 'Audit→Branch');
  safeAssoc(() => db.Branch.hasMany(db.AuditLog,   { foreignKey: 'branchId', as: 'auditLogs' }), 'Branch→AuditLogs');
}

/* Activity */
if (db.ActivityLog && db.User) {
  safeAssoc(() => db.ActivityLog.belongsTo(db.User, { foreignKey: 'userId', as: 'User' }), 'ActivityLog→User');
  safeAssoc(() => db.User.hasMany(db.ActivityLog,   { foreignKey: 'userId' }), 'User→ActivityLogs');
}
if (db.ActivityComment && db.ActivityLog) {
  safeAssoc(() => db.ActivityComment.belongsTo(db.ActivityLog, { foreignKey: 'activityId' }), 'ActivityComment→ActivityLog');
  safeAssoc(() => db.ActivityLog.hasMany(db.ActivityComment,   { foreignKey: 'activityId' }), 'ActivityLog→Comments');
}
if (db.ActivityComment && db.User) {
  safeAssoc(() => db.ActivityComment.belongsTo(db.User, { foreignKey: 'userId', as: 'User' }), 'ActivityComment→User');
}
if (db.ActivityAssignment && db.ActivityLog) {
  safeAssoc(() => db.ActivityAssignment.belongsTo(db.ActivityLog, { foreignKey: 'activityId' }), 'ActivityAssignment→ActivityLog');
  safeAssoc(() => db.ActivityLog.hasMany(db.ActivityAssignment,   { foreignKey: 'activityId' }), 'ActivityLog→Assignments');
}
if (db.ActivityAssignment && db.User) {
  safeAssoc(() => db.ActivityAssignment.belongsTo(db.User, { foreignKey: 'assigneeId', as: 'assignee' }), 'ActivityAssignment→assignee');
  safeAssoc(() => db.ActivityAssignment.belongsTo(db.User, { foreignKey: 'assignerId', as: 'assigner' }), 'ActivityAssignment→assigner');
}

/* ---------- Accounting associations ---------- */
if (db.Account && db.LedgerEntry) {
  safeAssoc(() => db.Account.hasMany(db.LedgerEntry, { foreignKey: 'accountId' }), 'Account→LedgerEntries');
  safeAssoc(() => db.LedgerEntry.belongsTo(db.Account, { foreignKey: 'accountId' }), 'LedgerEntry→Account');
}
if (db.JournalEntry && db.LedgerEntry) {
  safeAssoc(() => db.JournalEntry.hasMany(db.LedgerEntry, { foreignKey: 'journalEntryId' }), 'JournalEntry→LedgerEntries');
  safeAssoc(() => db.LedgerEntry.belongsTo(db.JournalEntry, { foreignKey: 'journalEntryId' }), 'LedgerEntry→JournalEntry');
}

/* ---------- HR & Payroll associations ---------- */
if (db.Employee && db.Branch) {
  safeAssoc(() => db.Employee.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' }), 'Employee→Branch');
  safeAssoc(() => db.Branch.hasMany(db.Employee,   { foreignKey: 'branchId', as: 'employees' }), 'Branch→Employees');
}
if (db.Attendance && db.Employee) {
  const fk = hasAttr(db.Attendance, 'employee_id') ? 'employee_id' : 'employeeId';
  safeAssoc(() => db.Attendance.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' }), 'Attendance→Employee');
  safeAssoc(() => db.Employee.hasMany(db.Attendance,   { foreignKey: fk, as: 'attendance' }), 'Employee→Attendance');
}
if (db.PayrollItem && db.Employee) {
  const fk = hasAttr(db.PayrollItem, 'employee_id') ? 'employee_id' : 'employeeId';
  safeAssoc(() => db.PayrollItem.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' }), 'PayrollItem→Employee');
  safeAssoc(() => db.Employee.hasMany(db.PayrollItem,   { foreignKey: fk, as: 'payItems' }), 'Employee→PayrollItems');
}
if (db.Payslip && db.Employee) {
  const fk = hasAttr(db.Payslip, 'employee_id') ? 'employee_id' : 'employeeId';
  safeAssoc(() => db.Payslip.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' }), 'Payslip→Employee');
  safeAssoc(() => db.Employee.hasMany(db.Payslip,   { foreignKey: fk, as: 'payslips' }), 'Employee→Payslips');
}
if (db.Payslip && db.Payrun) {
  const fk = hasAttr(db.Payslip, 'payrun_id') ? 'payrun_id' : 'payrunId';
  safeAssoc(() => db.Payslip.belongsTo(db.Payrun, { foreignKey: fk, as: 'payrun' }), 'Payslip→Payrun');
  safeAssoc(() => db.Payrun.hasMany(db.Payslip,   { foreignKey: fk, as: 'payslips' }), 'Payrun→Payslips');
}
if (db.LeaveRequest && db.Employee) {
  const fk = hasAttr(db.LeaveRequest, 'employee_id') ? 'employee_id' : 'employeeId';
  safeAssoc(() => db.LeaveRequest.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' }), 'LeaveRequest→Employee');
  safeAssoc(() => db.Employee.hasMany(db.LeaveRequest,   { foreignKey: fk, as: 'leaveRequests' }), 'Employee→LeaveRequests');
}
if (db.Contract && db.Employee) {
  const fk = hasAttr(db.Contract, 'employee_id') ? 'employee_id' : 'employeeId';
  safeAssoc(() => db.Contract.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' }), 'Contract→Employee');
  safeAssoc(() => db.Employee.hasMany(db.Contract,   { foreignKey: fk, as: 'contracts' }), 'Employee→Contracts');
}

/* ---------- Plans & Entitlements associations (guarded) ---------- */
if (db.Plan && db.Entitlement) {
  if (db.PlanEntitlement) {
    safeAssoc(() => db.Plan.belongsToMany(db.Entitlement, { through: db.PlanEntitlement, foreignKey: 'plan_id', otherKey: 'entitlement_id', as: 'entitlements' }), 'Plan↔Entitlement (model)');
    safeAssoc(() => db.Entitlement.belongsToMany(db.Plan, { through: db.PlanEntitlement, foreignKey: 'entitlement_id', otherKey: 'plan_id', as: 'plans' }), 'Entitlement↔Plan (model)');
  } else {
    safeAssoc(() => db.Plan.belongsToMany(db.Entitlement, { through: 'plan_entitlements', foreignKey: 'plan_id', otherKey: 'entitlement_id', as: 'entitlements' }), 'Plan↔Entitlement (table)');
    safeAssoc(() => db.Entitlement.belongsToMany(db.Plan, { through: 'plan_entitlements', foreignKey: 'entitlement_id', otherKey: 'plan_id', as: 'plans' }), 'Entitlement↔Plan (table)');
  }
}

/* ---------- Bank & Cash associations ---------- */
if (db.Bank && db.Tenant) {
  safeAssoc(() => db.Bank.belongsTo(db.Tenant, { foreignKey: 'tenantId', as: 'tenant' }), 'Bank→Tenant');
  safeAssoc(() => db.Tenant.hasMany(db.Bank,   { foreignKey: 'tenantId', as: 'banks' }), 'Tenant→Banks');
}
if (db.Bank && db.BankTransaction) {
  safeAssoc(() => db.Bank.hasMany(db.BankTransaction, { foreignKey: 'bankId', as: 'transactions' }), 'Bank→Transactions');
  safeAssoc(() => db.BankTransaction.belongsTo(db.Bank, { foreignKey: 'bankId', as: 'bank' }), 'Transaction→Bank');
}
if (db.BankTransaction && db.Tenant) {
  safeAssoc(() => db.BankTransaction.belongsTo(db.Tenant, { foreignKey: 'tenantId', as: 'tenant' }), 'Transaction→Tenant');
}
if (db.BankTransaction && db.User) {
  safeAssoc(() => db.BankTransaction.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' }), 'Transaction→User');
}
if (db.BankTransaction && db.Loan) {
  safeAssoc(() => db.BankTransaction.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' }), 'Transaction→Loan');
  safeAssoc(() => db.Loan.hasMany(db.BankTransaction,   { foreignKey: 'loanId', as: 'bankTransactions' }), 'Loan→Transactions');
}
if (db.BankTransaction && db.Borrower) {
  safeAssoc(() => db.BankTransaction.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' }), 'Transaction→Borrower');
}

if (db.CashAccount && db.Tenant) {
  safeAssoc(() => db.CashAccount.belongsTo(db.Tenant, { foreignKey: 'tenantId', as: 'tenant' }), 'CashAccount→Tenant');
  safeAssoc(() => db.Tenant.hasMany(db.CashAccount,   { foreignKey: 'tenantId', as: 'cashAccounts' }), 'Tenant→CashAccounts');
}
if (db.CashAccount && db.CashTransaction) {
  safeAssoc(() => db.CashAccount.hasMany(db.CashTransaction, { foreignKey: 'cashAccountId', as: 'transactions' }), 'CashAccount→Transactions');
  safeAssoc(() => db.CashTransaction.belongsTo(db.CashAccount, { foreignKey: 'cashAccountId', as: 'cashAccount' }), 'CashTx→CashAccount');
}
if (db.CashTransaction && db.User) {
  safeAssoc(() => db.CashTransaction.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' }), 'CashTx→User');
}
if (db.CashTransaction && db.Loan) {
  safeAssoc(() => db.CashTransaction.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' }), 'CashTx→Loan');
  safeAssoc(() => db.Loan.hasMany(db.CashTransaction,   { foreignKey: 'loanId', as: 'cashTransactions' }), 'Loan→CashTx');
}
if (db.CashTransaction && db.Borrower) {
  safeAssoc(() => db.CashTransaction.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' }), 'CashTx→Borrower');
}

/* 🆕 Borrower Groups associations */
if (db.BorrowerGroup && db.Branch && hasAttr(db.BorrowerGroup, 'branchId')) {
  safeAssoc(() => db.BorrowerGroup.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' }), 'Group→Branch');
  safeAssoc(() => db.Branch.hasMany(db.BorrowerGroup,   { foreignKey: 'branchId', as: 'groups' }), 'Branch→Groups');
}
if (db.BorrowerGroup && db.User && hasAttr(db.BorrowerGroup, 'officerId')) {
  safeAssoc(() => db.BorrowerGroup.belongsTo(db.User, { foreignKey: 'officerId', as: 'officer' }), 'Group→Officer');
  safeAssoc(() => db.User.hasMany(db.BorrowerGroup,   { foreignKey: 'officerId', as: 'officerGroups' }), 'User→OfficerGroups');
}
if (db.BorrowerGroup && db.BorrowerGroupMember) {
  safeAssoc(() => db.BorrowerGroup.hasMany(db.BorrowerGroupMember, { foreignKey: 'groupId', as: 'groupMembers', onDelete: 'CASCADE' }), 'Group→Members');
  safeAssoc(() => db.BorrowerGroupMember.belongsTo(db.BorrowerGroup, { foreignKey: 'groupId', as: 'group' }), 'Member→Group');
}
if (db.BorrowerGroupMember && db.Borrower) {
  safeAssoc(() => db.BorrowerGroupMember.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' }), 'Member→Borrower');
}
if (db.BorrowerGroup && db.Borrower && db.BorrowerGroupMember) {
  safeAssoc(() => db.BorrowerGroup.belongsToMany(db.Borrower, {
    through: db.BorrowerGroupMember, foreignKey: 'groupId', otherKey: 'borrowerId', as: 'members',
  }), 'Group↔Borrowers');
  safeAssoc(() => db.Borrower.belongsToMany(db.BorrowerGroup, {
    through: db.BorrowerGroupMember, foreignKey: 'borrowerId', otherKey: 'groupId', as: 'groups',
  }), 'Borrower↔Groups');
}

/* ------------------------------------------------------------------
   🛡️ IAM backstops (only if not already added by model.associate)
------------------------------------------------------------------- */
if (db.User && db.Role) {
  const hasUserRoles = !!(db.User.associations && db.User.associations.Roles);
  if (!hasUserRoles) {
    const throughUR = db.UserRole || sequelize.models.UserRole || 'UserRoles';
    safeAssoc(() => db.User.belongsToMany(db.Role, {
      through: throughUR, foreignKey: 'userId', otherKey: 'roleId', as: 'Roles',
    }), 'User↔Role');
  }
}
if (db.Role && db.User) {
  const hasRoleUsers = !!(db.Role.associations && db.Role.associations.Users);
  if (!hasRoleUsers) {
    const throughUR = db.UserRole || sequelize.models.UserRole || 'UserRoles';
    safeAssoc(() => db.Role.belongsToMany(db.User, {
      through: throughUR, foreignKey: 'roleId', otherKey: 'userId', as: 'Users',
    }), 'Role↔User');
  }
}
if (db.Role && db.Permission) {
  const hasRolePerms = !!(db.Role.associations && db.Role.associations.Permissions);
  if (!hasRolePerms) {
    const throughRP = db.RolePermission || sequelize.models.RolePermission || 'RolePermissions';
    safeAssoc(() => db.Role.belongsToMany(db.Permission, {
      through: throughRP, foreignKey: 'roleId', otherKey: 'permissionId', as: 'Permissions',
    }), 'Role↔Permission');
  }
}

/* ---------- Export ---------- */
db.sequelize = sequelize;
db.Sequelize = Sequelize;
module.exports = db;
