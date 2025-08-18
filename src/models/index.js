const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/** Sequelize instance */
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

/* ---------- helper to require case-insensitively ---------- */
const tryRequire = (p) => { try { return require(p); } catch { return null; } };
const requireModel = (name, variants) => {
  for (const v of variants) {
    const mod = tryRequire(`./${v}`);
    if (mod) return mod(sequelize, DataTypes);
  }
  console.warn(`⚠️  Model not loaded: ${name} (tried ${variants.join(', ')})`);
  return undefined;
};

/* ---------------------------- Core models ---------------------------- */
db.User          = requireModel('User', ['user', 'User']);
db.Branch        = requireModel('Branch', ['branch', 'Branch']);
db.Borrower      = requireModel('Borrower', ['borrower', 'Borrower']);
db.Loan          = requireModel('Loan', ['loan', 'Loan']);
db.LoanRepayment = requireModel('LoanRepayment', ['loanrepayment', 'LoanRepayment']);
db.LoanPayment   = requireModel('LoanPayment', ['loanpayment', 'LoanPayment']);
db.Setting       = requireModel('Setting', ['setting', 'Setting']);
db.LoanProduct   = requireModel('LoanProduct', ['LoanProduct', 'loanproduct', 'loanProduct']);

/* Savings transactions (required by Borrowers/Dashboard) */
db.SavingsTransaction = requireModel('SavingsTransaction', ['SavingsTransaction', 'savingstransaction', 'savingsTransaction']);

/* ------------------------ Access control models ---------------------- */
db.Role       = requireModel('Role', ['Role', 'role', 'roles']);
db.UserRole   = requireModel('UserRole', ['UserRole', 'userrole', 'userroles']);
db.Permission = requireModel('Permission', ['Permission', 'permission']);

/* --------------------- Optional/Reporting/Audit --------------------- */
db.ReportSubscription = requireModel('ReportSubscription', ['ReportSubscription', 'reportsubscription']);
db.Communication = requireModel('Communication', ['Communication', 'communication']);
db.CommunicationAttachment = requireModel('CommunicationAttachment', ['CommunicationAttachment', 'communicationattachment']);
db.AuditLog = requireModel('AuditLog', ['AuditLog', 'auditlog']);

/* Optional activity */
db.ActivityLog        = requireModel('ActivityLog', ['ActivityLog', 'activitylog']);
db.ActivityComment    = requireModel('ActivityComment', ['ActivityComment', 'activitycomment']);
db.ActivityAssignment = requireModel('ActivityAssignment', ['ActivityAssignment', 'activityassignment']);

/* Optional borrower extras */
db.KYCDocument       = requireModel('KYCDocument', ['KYCDocument', 'kycdocument', 'KycDocument']);
db.BorrowerComment   = requireModel('BorrowerComment', ['BorrowerComment', 'borrowercomment']);
db.BorrowerGroup     = requireModel('BorrowerGroup', ['BorrowerGroup', 'borrowergroup', 'Group']);
db.BorrowerGroupMember = requireModel('BorrowerGroupMember', ['BorrowerGroupMember', 'borrowergroupmember', 'GroupMember']);

/* ============================== Associations ============================== */
/* Users ↔ Branches */
if (db.User && db.Branch) {
  db.User.belongsTo(db.Branch,   { foreignKey: 'branchId' });
  db.Branch.hasMany(db.User,     { foreignKey: 'branchId' });
}

/* Borrowers ↔ Branches */
if (db.Borrower && db.Branch) {
  db.Borrower.belongsTo(db.Branch, { foreignKey: 'branchId' });
  db.Branch.hasMany(db.Borrower,   { foreignKey: 'branchId' });
}

/* Loans ↔ Borrowers/Branches/Products */
if (db.Loan && db.Borrower) {
  db.Loan.belongsTo(db.Borrower, { foreignKey: 'borrowerId' });
  db.Borrower.hasMany(db.Loan,   { foreignKey: 'borrowerId' });
}
if (db.Loan && db.Branch) {
  db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId' });
  db.Branch.hasMany(db.Loan,   { foreignKey: 'branchId' });
}
if (db.Loan && db.LoanProduct) {
  db.Loan.belongsTo(db.LoanProduct, { foreignKey: 'productId' });
  db.LoanProduct.hasMany(db.Loan,   { foreignKey: 'productId' });
}

/* LoanRepayments / LoanPayments ↔ Loans / Users */
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

/* SavingsTransaction ↔ Borrower */
if (db.SavingsTransaction && db.Borrower) {
  db.SavingsTransaction.belongsTo(db.Borrower, { foreignKey: 'borrowerId', as: 'borrower' });
  db.Borrower.hasMany(db.SavingsTransaction,   { foreignKey: 'borrowerId', as: 'savingsTransactions' });
}

/* Users ↔ Roles (many-to-many) */
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

/* Report subscriptions ↔ Role/User */
if (db.ReportSubscription && db.Role) {
  db.ReportSubscription.belongsTo(db.Role, { foreignKey: 'roleId', as: 'role' });
}
if (db.ReportSubscription && db.User) {
  db.ReportSubscription.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });
}

/* Communications */
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

/* Audit ↔ User/Branch */
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

/* Optional accounting */
try {
  db.Account      = requireModel('Account', ['account', 'Account']);
  db.JournalEntry = requireModel('JournalEntry', ['journalEntry', 'JournalEntry', 'journalentry']);
  db.LedgerEntry  = requireModel('LedgerEntry', ['ledgerEntry', 'LedgerEntry', 'ledgerentry']);

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
    db.Account.belongsTo(db.Account, { as: 'parent', foreignKey: 'parentId' });
  }
} catch (e) {
  console.warn('⚠️  Accounting models not fully loaded:', e.message);
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
