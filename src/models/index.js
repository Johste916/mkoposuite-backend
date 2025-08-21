// models/index.js
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/* ----------------------------------------------------------------
 * Sequelize instance
 * ---------------------------------------------------------------- */
const common = {
  dialect: 'postgres',
  logging: false,
  // ✅ Ensure we always use the public schema
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
      {
        ...common,
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 5432,
      }
    );

const db = {};

/* Helpers */
const tryLoad = (loader, nameForLog) => {
  try {
    return loader();
  } catch (e) {
    console.warn(`⚠️  Model not loaded: ${nameForLog} (${e.message})`);
    return null;
  }
};
const hasAttr = (model, attr) =>
  !!(model && model.rawAttributes && model.rawAttributes[attr]);
const pickFk = (model, camel, snake) => {
  if (hasAttr(model, camel)) return camel;
  if (hasAttr(model, snake)) return snake;
  return null;
};

/* ----------------------------------------------------------------
 * Core models
 * ---------------------------------------------------------------- */
db.User          = require('./user')(sequelize, DataTypes);
db.Branch        = tryLoad(() => require('./branch')(sequelize, DataTypes), 'Branch');
db.Borrower      = require('./borrower')(sequelize, DataTypes);
db.Loan          = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = tryLoad(() => require('./loanrepayment')(sequelize, DataTypes), 'LoanRepayment');
db.LoanPayment   = tryLoad(() => require('./loanpayment')(sequelize, DataTypes),   'LoanPayment');
db.Setting       = require('./setting')(sequelize, DataTypes);
db.LoanProduct   = tryLoad(() => require('./LoanProduct')(sequelize, DataTypes),   'LoanProduct');

/* Access control */
db.Role       = tryLoad(() => require('./Role')(sequelize, DataTypes), 'Role');
db.UserRole   = tryLoad(() => require('./UserRole')(sequelize, DataTypes), 'UserRole');
db.Permission = tryLoad(() => require('./Permission')(sequelize, DataTypes), 'Permission');

/* Optional modules */
db.SavingsTransaction      = tryLoad(() => require('./SavingsTransaction')(sequelize, DataTypes), 'SavingsTransaction');
db.ReportSubscription      = tryLoad(() => require('./ReportSubscription')(sequelize, DataTypes), 'ReportSubscription');
db.Communication           = tryLoad(() => require('./Communication')(sequelize, DataTypes), 'Communication');
db.CommunicationAttachment = tryLoad(() => require('./CommunicationAttachment')(sequelize, DataTypes), 'CommunicationAttachment');
db.AuditLog                = tryLoad(() => require('./AuditLog')(sequelize, DataTypes), 'AuditLog');

/* Activity logs (optional) */
db.ActivityLog        = tryLoad(() => require('./ActivityLog')(sequelize, DataTypes), 'ActivityLog');
db.ActivityComment    = tryLoad(() => require('./ActivityComment')(sequelize, DataTypes), 'ActivityComment');
db.ActivityAssignment = tryLoad(() => require('./ActivityAssignment')(sequelize, DataTypes), 'ActivityAssignment');

/* Accounting (optional) */
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

/* Only register if the FK column actually exists on loans */
if (db.Loan && db.Branch && hasAttr(db.Loan, 'branchId')) {
  db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId' });
  db.Branch.hasMany(db.Loan,   { foreignKey: 'branchId' });
}
if (db.Loan && db.LoanProduct && hasAttr(db.Loan, 'productId')) {
  db.Loan.belongsTo(db.LoanProduct, { foreignKey: 'productId' });
  db.LoanProduct.hasMany(db.Loan,   { foreignKey: 'productId' });
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

/* Users ↔ Roles many-to-many */
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

/* Optional: SavingsTransaction ↔ Borrower */
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

/* Optional: Communication ↔ Attachments */
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

/* Optional: Audit ↔ User/Branch */
if (db.AuditLog && db.User) {
  db.AuditLog.belongsTo(db.User,   { foreignKey: 'userId',  as: 'user' });
  db.User.hasMany(db.AuditLog,     { foreignKey: 'userId',  as: 'auditLogs' });
}
if (db.AuditLog && db.Branch) {
  db.AuditLog.belongsTo(db.Branch, { foreignKey: 'branchId', as: 'branch' });
  db.Branch.hasMany(db.AuditLog,   { foreignKey: 'branchId', as: 'auditLogs' });
}

/* Optional: Activity */
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
 * Exports
 * ---------------------------------------------------------------- */
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
