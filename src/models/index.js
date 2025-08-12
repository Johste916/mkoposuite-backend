// backend/src/models/index.js
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/**
 * Sequelize instance
 */
const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    })
  : new Sequelize(
      process.env.DB_NAME || 'mkoposuite_dev',
      process.env.DB_USER || 'postgres',
      process.env.DB_PASS || null,
      {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 5432,
        dialect: 'postgres',
      }
    );

/**
 * db object to hold all models and the sequelize instance
 */
const db = {};

/* =========================
 * Load Existing Models
 * ========================= */
db.User          = require('./user')(sequelize, DataTypes);
db.Branch        = require('./branch')(sequelize, DataTypes);
db.Borrower      = require('./borrower')(sequelize, DataTypes);
db.Loan          = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, DataTypes);
db.LoanPayment   = require('./loanpayment')(sequelize, DataTypes);
db.Setting       = require('./setting')(sequelize, DataTypes);

// 👉 IMPORTANT: Case-sensitive on Linux/Render. File must be src/models/LoanProduct.js
db.LoanProduct   = require('./LoanProduct')(sequelize, DataTypes);

/* =========================
 * Load New Accounting Models
 * =========================
 * Make sure these files exist:
 *   - src/models/account.js
 *   - src/models/journalEntry.js
 *   - src/models/ledgerEntry.js
 */
try {
  db.Account       = require('./account')(sequelize, DataTypes);
  db.JournalEntry  = require('./journalEntry')(sequelize, DataTypes);
  db.LedgerEntry   = require('./ledgerEntry')(sequelize, DataTypes);
} catch (e) {
  // If any file is missing during first boot, log a friendly note.
  console.warn('⚠️  Accounting models not fully loaded:', e.message);
}

/* =========================
 * Associations (Existing)
 * ========================= */
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

// 👉 Link loans to products
if (db.Loan && db.LoanProduct) {
  db.Loan.belongsTo(db.LoanProduct, { foreignKey: 'productId' });
  db.LoanProduct.hasMany(db.Loan,   { foreignKey: 'productId' });
}

/* =========================
 * Associations (Accounting)
 * ========================= */
if (db.Account && db.LedgerEntry) {
  // One Account has many LedgerEntries
  db.Account.hasMany(db.LedgerEntry, { foreignKey: 'accountId', as: 'entries' });
  db.LedgerEntry.belongsTo(db.Account, { foreignKey: 'accountId', as: 'account' });
}

if (db.JournalEntry && db.LedgerEntry) {
  // One JournalEntry has many LedgerEntries
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

// Optional: account hierarchy (parent/child)
if (db.Account) {
  db.Account.hasMany(db.Account, { as: 'children', foreignKey: 'parentId' });
  db.Account.belongsTo(db.Account, { as: 'parent', foreignKey: 'parentId' });
}

/* =========================
 * Export
 * ========================= */
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
