const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/* ----------------------------------------------------------------
 * Sequelize instance
 * ---------------------------------------------------------------- */
const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
      logging: false,
    })
  : new Sequelize(
      process.env.DB_NAME || 'mkoposuite_dev',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASS || null,
      {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 5432,
        dialect: 'postgres',
        logging: false,
      }
    );

const db = {};

/* Small helper for optional models without crashing boot */
const tryLoad = (loader, nameForLog) => {
  try {
    return loader();
  } catch (e) {
    console.warn(`⚠️  Model not loaded: ${nameForLog} (${e.message})`);
    return null;
  }
};

/* ----------------------------------------------------------------
 * Core models (existing)
 * Filenames are case-sensitive on Linux:
 *   user.js, branch.js, borrower.js, loan.js, loanrepayment.js,
 *   loanpayment.js, setting.js, LoanProduct.js
 * ---------------------------------------------------------------- */
db.User          = require('./user')(sequelize, DataTypes);
db.Branch        = require('./branch')(sequelize, DataTypes);
db.Borrower      = require('./borrower')(sequelize, DataTypes);
db.Loan          = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, DataTypes);
db.LoanPayment   = require('./loanpayment')(sequelize, DataTypes);
db.Setting       = require('./setting')(sequelize, DataTypes);
db.LoanProduct   = require('./LoanProduct')(sequelize, DataTypes);

/* ----------------------------------------------------------------
 * Access control
 * Filenames must be exactly: Role.js, UserRole.js, Permission.js
 * ---------------------------------------------------------------- */
db.Role       = require('./Role')(sequelize, DataTypes);
db.UserRole   = require('./UserRole')(sequelize, DataTypes);
db.Permission = require('./Permission')(sequelize, DataTypes);

/* ----------------------------------------------------------------
 * Optional modules (loaded only if files exist)
 * ---------------------------------------------------------------- */
db.SavingsTransaction      = tryLoad(() => require('./SavingsTransaction')(sequelize, DataTypes), 'SavingsTransaction');
db.ReportSubscription      = tryLoad(() => require('./ReportSubscription')(sequelize, DataTypes), 'ReportSubscription');
db.Communication           = tryLoad(() => require('./Communication')(sequelize, DataTypes), 'Communication');
db.CommunicationAttachment = tryLoad(() => require('./CommunicationAttachment')(sequelize, DataTypes), 'CommunicationAttachment');
db.AuditLog                = tryLoad(() => require('./AuditLog')(sequelize, DataTypes), 'AuditLog');

/* Activity logs (optional) */
db.ActivityLog        = tryLoad(() => require('./ActivityLog')(sequelize, DataTypes), 'ActivityLog');
db.ActivityComment    = tryLoad(() => require('./ActivityComment')(sequelize, DataTypes), 'ActivityComment');
db.ActivityAssignment = tryLoad(() => require('./ActivityAssignment')(sequelize, DataTypes), 'ActivityAssignment');

/* ----------------------------------------------------------------
 * Optional accounting
 * Files: account.js, journalEntry.js, ledgerEntry.js
 * ---------------------------------------------------------------- */
db.Account      = tryLoad(() => require('./account')(sequelize, DataTypes), 'Account');
db.JournalEntry = tryLoad(() => require('./journalEntry')(sequelize, DataTypes), 'JournalEntry');
db.LedgerEntry  = tryLoad(() => require('./ledgerEntry')(sequelize, DataTypes), 'LedgerEntry');

/* ----------------------------------------------------------------
 * Associations (core)
 * ---------------------------------------------------------------- */
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
  db.Branch.hasMany(db.Loan,   { foreignKey: 'branchId' });
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

/* ----------------------------------------------------------------
 * Associations (Users ↔ Roles many-to-many)
 * Through: UserRoles (model file: UserRole.js)
 * ---------------------------------------------------------------- */
if (db.User && db.Role && db.UserRole) {
  db.User.belongsToMany(db.Role, {
    through: db.UserRole,
    foreignKey: 'userId',
    otherKey: 'roleId',
    as: 'Roles',
  });
  db.Role.belongsToMany(db.User, {
    through: db.UserRole,
    foreignKey: 'roleId',
    otherKey: 'userId',
    as: 'Users',
  });
}

/* ----------------------------------------------------------------
 * SavingsTransaction ↔ Borrower (optional)
 * ---------------------------------------------------------------- */
if (db.SavingsTransaction && db.Borrower) {
  db.SavingsTransaction.belongsTo(db.Borrower, {
    foreignKey: 'borrowerId',
    as: 'borrower',
  });
  db.Borrower.hasMany(db.SavingsTransaction, {
    foreignKey: 'borrowerId',
    as: 'savingsTransactions',
  });
}

/* ----------------------------------------------------------------
 * Communications (optional)
 * ---------------------------------------------------------------- */
if (db.Communication && db.CommunicationAttachment) {
  db.Communication.hasMany(db.CommunicationAttachment, {
    foreignKey: 'communicationId',
    as: 'attachments',
    onDelete: 'CASCADE',
  });
  db.CommunicationAttachment.belongsTo(db.Communication, {
    foreignKey: 'communicationId',
    as: 'communication',
  });
}

/* ----------------------------------------------------------------
 * Audit ↔ User/Branch (optional)
 * ---------------------------------------------------------------- */
if (db.AuditLog && db.User) {
  db.AuditLog.belongsTo(db.User,   { foreignKey: 'userId',  as: 'user' });
  db.User.hasMany(db.AuditLog,     { foreignKey: 'userId',  as: 'auditLogs' });
}
if (db.AuditLog && db.Branch) {
  db.AuditLog.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.AuditLog,   { foreignKey: 'branchId', as: 'auditLogs' });
}

/* ----------------------------------------------------------------
 * Activity (optional)
 * ---------------------------------------------------------------- */
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

/* ----------------------------------------------------------------
 * Accounting associations (optional)
 * ---------------------------------------------------------------- */
if (db.Account && db.LedgerEntry) {
  db.Account.hasMany(db.LedgerEntry, { foreignKey: 'accountId', as: 'entries' });
  db.LedgerEntry.belongsTo(db.Account, { foreignKey: 'accountId', as: 'account' });
}
if (db.JournalEntry && db.LedgerEntry) {
  db.JournalEntry.hasMany(db.LedgerEntry, {
    foreignKey: 'journalEntryId',
    as: 'lines',
    onDelete: 'CASCADE',
  });
  db.LedgerEntry.belongsTo(db.JournalEntry, {
    foreignKey: 'journalEntryId',
    as: 'journal',
  });
}
if (db.Account) {
  db.Account.hasMany(db.Account, { as: 'children', foreignKey: 'parentId' });
  db.Account.belongsTo(db.Account, { as: 'parent',   foreignKey: 'parentId' });
}

/* ----------------------------------------------------------------
 * Exports
 * ---------------------------------------------------------------- */
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
