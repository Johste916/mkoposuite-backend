'use strict';
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/* Force `public` schema so prod finds public tables */
const common = {
  dialect: 'postgres',
  logging: false,
  searchPath: 'public',
  define: { schema: 'public' },
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
      { ...common, host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 5432 }
    );

const db = {};
const tryLoad = (loader, nameForLog) => {
  try { return loader(); }
  catch (e) { console.warn(`⚠️  Model not loaded: ${nameForLog} (${e.message})`); return null; }
};
const hasAttr = (model, attr) => !!(model && model.rawAttributes && (model.rawAttributes[attr] || Object.values(model.rawAttributes).some(a => a.field === attr)));

/* ---------- Core models ---------- */
db.User          = require('./user')(sequelize, DataTypes);
db.Branch        = require('./branch')(sequelize, DataTypes);
db.Borrower      = require('./borrower')(sequelize, DataTypes);
db.Loan          = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = tryLoad(() => require('./loanrepayment')(sequelize, DataTypes), 'LoanRepayment');
db.LoanPayment   = tryLoad(() => require('./loanpayment')(sequelize, DataTypes),   'LoanPayment');
db.Setting       = require('./setting')(sequelize, DataTypes);
db.LoanProduct   = tryLoad(() => require('./LoanProduct')(sequelize, DataTypes),   'LoanProduct');

/* Access control (optional) */
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

/* Collections */
db.CollectionSheet = tryLoad(() => require('./collectionSheet')(sequelize, DataTypes), 'CollectionSheet');

/* Collateral */
db.Collateral = tryLoad(() => require('./collateral')(sequelize, DataTypes), 'Collateral');

/* Expense */
db.Expense = tryLoad(() => require('./expense')(sequelize, DataTypes), 'Expense');

/* Investors */
db.Investor = tryLoad(() => require('./investor')(sequelize, DataTypes), 'Investor');

/* ---------------- Associations (core) ---------------- */
if (db.User && db.Branch) {
  db.User.belongsTo(db.Branch,   { foreignKey: 'branchId' });
  db.Branch.hasMany(db.User,     { foreignKey: 'branchId' });
}

if (db.Borrower && db.Branch) {
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

db.sequelize = sequelize;
db.Sequelize = Sequelize;
module.exports = db;
