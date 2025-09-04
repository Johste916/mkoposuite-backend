'use strict';
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/* Force `public` schema so prod finds public tables (works in single DB, multi-tenant by data) */
const common = {
  dialect: 'postgres',
  logging: false,
  searchPath: 'public',
  define: { schema: 'public' },
  pool: { max: 10, min: 0, idle: 10000 },
  timezone: 'Z',
};

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      ...common,
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    })
  : new Sequelize(
      process.env.DB_NAME || 'mkoposuite_dev',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASS || null,
      {
        ...common,
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 5432,
      }
    );

const db = {};
const tryLoad = (loader, nameForLog) => {
  try { return loader(); }
  catch (e) { console.warn(`⚠️  Model not loaded: ${nameForLog} (${e.message})`); return null; }
};
const hasAttr = (model, attr) =>
  !!(model && model.rawAttributes && (model.rawAttributes[attr] || Object.values(model.rawAttributes).some(a => a.field === attr)));

/* ---------- Core models ---------- */
db.User          = require('./user')(sequelize, DataTypes);
db.Branch        = require('./branch')(sequelize, DataTypes);
db.Borrower      = require('./borrower')(sequelize, DataTypes);
db.Loan          = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = tryLoad(() => require('./loanrepayment')(sequelize, DataTypes), 'LoanRepayment');
db.LoanPayment   = tryLoad(() => require('./loanpayment')(sequelize, DataTypes),   'LoanPayment');
db.Setting       = require('./setting')(sequelize, DataTypes);
db.LoanProduct   = tryLoad(() => require('./LoanProduct')(sequelize, DataTypes),   'LoanProduct');

/* Optional/Multi-tenant */
db.Tenant     = tryLoad(() => require('./tenant')(sequelize, DataTypes), 'Tenant');
db.Role       = tryLoad(() => require('./Role')(sequelize, DataTypes),       'Role');
db.UserRole   = tryLoad(() => require('./UserRole')(sequelize, DataTypes),   'UserRole');
db.Permission = tryLoad(() => require('./Permission')(sequelize, DataTypes), 'Permission');

/* Savings (required) */
db.SavingsTransaction = require('./savingstransaction')(sequelize, DataTypes);

/* Optional modules */
db.ReportSubscription      = tryLoad(() => require('./ReportSubscription')(sequelize, DataTypes), 'ReportSubscription');
db.Communication           = tryLoad(() => require('./Communication')(sequelize, DataTypes), 'Communication');
db.CommunicationAttachment = tryLoad(() => require('./CommunicationAttachment')(sequelize, DataTypes), 'CommunicationAttachment');
db.AuditLog                = tryLoad(() => require('./AuditLog')(sequelize, DataTypes), 'AuditLog');

/* Activity (optional) */
db.ActivityLog        = tryLoad(() => require('./ActivityLog')(sequelize, DataTypes), 'ActivityLog');
db.ActivityComment    = tryLoad(() => require('./ActivityComment')(sequelize, DataTypes), 'ActivityComment');
db.ActivityAssignment = tryLoad(() => require('./ActivityAssignment')(sequelize, DataTypes), 'ActivityAssignment');

/* Accounting (required for accounting module) */
db.Account      = tryLoad(() => require('./account')(sequelize, DataTypes),      'Account');
db.JournalEntry = tryLoad(() => require('./journalEntry')(sequelize, DataTypes), 'JournalEntry');
db.LedgerEntry  = tryLoad(() => require('./ledgerEntry')(sequelize, DataTypes),  'LedgerEntry');

/* Collections / Collateral / Expense / Investors */
db.CollectionSheet = tryLoad(() => require('./collectionSheet')(sequelize, DataTypes), 'CollectionSheet');
db.Collateral      = tryLoad(() => require('./collateral')(sequelize, DataTypes), 'Collateral');
db.Expense         = tryLoad(() => require('./expense')(sequelize, DataTypes), 'Expense');
db.Investor        = tryLoad(() => require('./investor')(sequelize, DataTypes), 'Investor');

/* HR & Payroll */
db.Employee     = tryLoad(() => require('./employee')(sequelize, DataTypes),     'Employee');
db.Attendance   = tryLoad(() => require('./attendance')(sequelize, DataTypes),   'Attendance');
db.PayrollItem  = tryLoad(() => require('./payrollItem')(sequelize, DataTypes),  'PayrollItem');
db.Payrun       = tryLoad(() => require('./payrun')(sequelize, DataTypes),       'Payrun');
db.Payslip      = tryLoad(() => require('./payslip')(sequelize, DataTypes),      'Payslip');
db.LeaveRequest = tryLoad(() => require('./leaveRequest')(sequelize, DataTypes), 'LeaveRequest');
db.Contract     = tryLoad(() => require('./contract')(sequelize, DataTypes),     'Contract');

/* ---------------- Associations (core) ---------------- */
if (db.User && db.Branch && hasAttr(db.User, 'branchId')) {
  db.User.belongsTo(db.Branch,   { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.User,     { foreignKey: 'branchId', as: 'users' });
}

/* Optional: User ↔ Tenant if tenant model/column exist */
if (db.Tenant && db.User && hasAttr(db.User, 'tenantId')) {
  db.User.belongsTo(db.Tenant, { foreignKey: 'tenantId', as: 'tenant' });
  db.Tenant.hasMany(db.User,   { foreignKey: 'tenantId', as: 'users' });
}

if (db.Borrower && db.Branch && hasAttr(db.Borrower, 'branchId')) {
  db.Borrower.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.Borrower,   { foreignKey: 'branchId', as: 'borrowers' });
}

if (db.Loan && db.Borrower && hasAttr(db.Loan, 'borrowerId')) {
  db.Loan.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
  db.Borrower.hasMany(db.Loan,   { foreignKey: 'borrowerId', as: 'loans' });
}

if (db.Loan && db.Branch && hasAttr(db.Loan, 'branchId')) {
  // ✅ keep a single association with alias, remove duplicate
  db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.Loan,   { foreignKey: 'branchId', as: 'loans' });
}

if (db.LoanRepayment && db.Loan && hasAttr(db.LoanRepayment, 'loanId')) {
  db.LoanRepayment.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' });
  db.Loan.hasMany(db.LoanRepayment,   { foreignKey: 'loanId', as: 'repayments' });
}

if (db.LoanPayment && db.Loan && hasAttr(db.LoanPayment, 'loanId')) {
  db.LoanPayment.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' });
  db.Loan.hasMany(db.LoanPayment,   { foreignKey: 'loanId', as: 'payments' });
}
if (db.LoanPayment && db.User && hasAttr(db.LoanPayment, 'userId')) {
  db.LoanPayment.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
  db.User.hasMany(db.LoanPayment,   { foreignKey: 'userId', as: 'loanPayments' });
}

if (db.Loan && db.LoanProduct && hasAttr(db.Loan, 'productId')) {
  db.Loan.belongsTo(db.LoanProduct, { foreignKey: 'productId', as: 'product' });
  db.LoanProduct.hasMany(db.Loan,   { foreignKey: 'productId', as: 'loans' });
}

/* Loan ↔ User workflow (guarded) */
if (db.Loan && db.User) {
  if (hasAttr(db.Loan, 'approvedBy')) {
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
if (db.Collateral && db.Borrower && hasAttr(db.Collateral, 'borrowerId')) {
  db.Collateral.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
  db.Borrower.hasMany(db.Collateral,   { foreignKey: 'borrowerId', as: 'collateral' });
}
if (db.Collateral && db.Loan && hasAttr(db.Collateral, 'loanId')) {
  db.Collateral.belongsTo(db.Loan, { foreignKey: 'loanId', as: 'loan' });
  db.Loan.hasMany(db.Collateral,   { foreignKey: 'loanId', as: 'collateral' });
}
if (db.Collateral && db.User) {
  if (hasAttr(db.Collateral, 'createdBy'))
    db.Collateral.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' });
  if (hasAttr(db.Collateral, 'updatedBy'))
    db.Collateral.belongsTo(db.User, { foreignKey: 'updatedBy', as: 'updater' });
}

/* Expense */
if (db.Expense && db.User) {
  if (hasAttr(db.Expense, 'createdBy'))
    db.Expense.belongsTo(db.User, { foreignKey: 'createdBy', as: 'creator' });
  if (hasAttr(db.Expense, 'updatedBy'))
    db.Expense.belongsTo(db.User, { foreignKey: 'updatedBy', as: 'updater' });
}
if (db.Expense && db.Branch && hasAttr(db.Expense, 'branchId')) {
  db.Expense.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
}

/* Savings ↔ Borrower */
if (db.SavingsTransaction && db.Borrower && hasAttr(db.SavingsTransaction, 'borrowerId')) {
  db.SavingsTransaction.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
  db.Borrower.hasMany(db.SavingsTransaction,   { foreignKey: 'borrowerId', as: 'savingsTransactions' });
}

/* Communications */
if (db.Communication && db.CommunicationAttachment) {
  db.Communication.hasMany(db.CommunicationAttachment, { foreignKey: 'communicationId', as: 'attachments', onDelete: 'CASCADE' });
  db.CommunicationAttachment.belongsTo(db.Communication, { foreignKey: 'communicationId', as: 'communication' });
}

/* Audit logs */
if (db.AuditLog && db.User && hasAttr(db.AuditLog, 'userId')) {
  db.AuditLog.belongsTo(db.User,   { foreignKey: 'userId',  as: 'user' });
  db.User.hasMany(db.AuditLog,     { foreignKey: 'userId',  as: 'auditLogs' });
}
if (db.AuditLog && db.Branch && hasAttr(db.AuditLog, 'branchId')) {
  db.AuditLog.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.AuditLog,   { foreignKey: 'branchId', as: 'auditLogs' });
}

/* Activity */
if (db.ActivityLog && db.User && hasAttr(db.ActivityLog, 'userId')) {
  db.ActivityLog.belongsTo(db.User, { foreignKey: 'userId', as: 'User' });
  db.User.hasMany(db.ActivityLog,   { foreignKey: 'userId' });
}
if (db.ActivityComment && db.ActivityLog && hasAttr(db.ActivityComment, 'activityId')) {
  db.ActivityComment.belongsTo(db.ActivityLog, { foreignKey: 'activityId' });
  db.ActivityLog.hasMany(db.ActivityComment,   { foreignKey: 'activityId' });
}
if (db.ActivityComment && db.User && hasAttr(db.ActivityComment, 'userId')) {
  db.ActivityComment.belongsTo(db.User, { foreignKey: 'userId', as: 'User' });
}
if (db.ActivityAssignment && db.ActivityLog && hasAttr(db.ActivityAssignment, 'activityId')) {
  db.ActivityAssignment.belongsTo(db.ActivityLog, { foreignKey: 'activityId' });
  db.ActivityLog.hasMany(db.ActivityAssignment,   { foreignKey: 'activityId' });
}
if (db.ActivityAssignment && db.User) {
  if (hasAttr(db.ActivityAssignment, 'assigneeId'))
    db.ActivityAssignment.belongsTo(db.User, { foreignKey: 'assigneeId', as: 'assignee' });
  if (hasAttr(db.ActivityAssignment, 'assignerId'))
    db.ActivityAssignment.belongsTo(db.User, { foreignKey: 'assignerId', as: 'assigner' });
}

/* ---------- Accounting associations ---------- */
if (db.Account && db.LedgerEntry && hasAttr(db.LedgerEntry, 'accountId')) {
  db.Account.hasMany(db.LedgerEntry, { foreignKey: 'accountId', as: 'entries' });
  db.LedgerEntry.belongsTo(db.Account, { foreignKey: 'accountId', as: 'account' });
}
if (db.JournalEntry && db.LedgerEntry && hasAttr(db.LedgerEntry, 'journalEntryId')) {
  db.JournalEntry.hasMany(db.LedgerEntry, { foreignKey: 'journalEntryId', as: 'lines' });
  db.LedgerEntry.belongsTo(db.JournalEntry, { foreignKey: 'journalEntryId', as: 'journalEntry' });
}

/* ---------- HR & Payroll associations ---------- */
if (db.Employee && db.Branch && hasAttr(db.Employee, 'branchId')) {
  db.Employee.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.Employee,   { foreignKey: 'branchId', as: 'employees' });
}
if (db.Attendance && db.Employee) {
  const fk = hasAttr(db.Attendance, 'employee_id') ? 'employee_id' : (hasAttr(db.Attendance,'employeeId') ? 'employeeId' : null);
  if (fk) {
    db.Attendance.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
    db.Employee.hasMany(db.Attendance,   { foreignKey: fk, as: 'attendance' });
  }
}
if (db.PayrollItem && db.Employee) {
  const fk = hasAttr(db.PayrollItem, 'employee_id') ? 'employee_id' : (hasAttr(db.PayrollItem,'employeeId') ? 'employeeId' : null);
  if (fk) {
    db.PayrollItem.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
    db.Employee.hasMany(db.PayrollItem,   { foreignKey: fk, as: 'payItems' });
  }
}
if (db.Payslip && db.Employee) {
  const fk = hasAttr(db.Payslip, 'employee_id') ? 'employee_id' : (hasAttr(db.Payslip,'employeeId') ? 'employeeId' : null);
  if (fk) {
    db.Payslip.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
    db.Employee.hasMany(db.Payslip,   { foreignKey: fk, as: 'payslips' });
  }
}
if (db.Payslip && db.Payrun) {
  const fk = hasAttr(db.Payslip, 'payrun_id') ? 'payrun_id' : (hasAttr(db.Payslip,'payrunId') ? 'payrunId' : null);
  if (fk) {
    db.Payslip.belongsTo(db.Payrun, { foreignKey: fk, as: 'payrun' });
    db.Payrun.hasMany(db.Payslip,   { foreignKey: fk, as: 'payslips' });
  }
}
if (db.LeaveRequest && db.Employee) {
  const fk = hasAttr(db.LeaveRequest, 'employee_id') ? 'employee_id' : (hasAttr(db.LeaveRequest,'employeeId') ? 'employeeId' : null);
  if (fk) {
    db.LeaveRequest.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
    db.Employee.hasMany(db.LeaveRequest,   { foreignKey: fk, as: 'leaveRequests' });
  }
}
if (db.Contract && db.Employee) {
  const fk = hasAttr(db.Contract, 'employee_id') ? 'employee_id' : (hasAttr(db.Contract,'employeeId') ? 'employeeId' : null);
  if (fk) {
    db.Contract.belongsTo(db.Employee, { foreignKey: fk, as: 'employee' });
    db.Employee.hasMany(db.Contract,   { foreignKey: fk, as: 'contracts' });
  }
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;
module.exports = db;
