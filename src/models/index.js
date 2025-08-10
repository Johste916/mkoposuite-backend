// backend/src/models/index.js
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

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

const db = {};

// ===== Load Models =====
db.User          = require('./user')(sequelize, DataTypes);
db.Branch        = require('./branch')(sequelize, DataTypes);
db.Borrower      = require('./borrower')(sequelize, DataTypes);
db.Loan          = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, DataTypes);
db.LoanPayment   = require('./loanpayment')(sequelize, DataTypes);
db.Setting       = require('./setting')(sequelize, DataTypes);

// 👉 IMPORTANT: Case-sensitive on Linux/Render. File must be src/models/LoanProduct.js
db.LoanProduct   = require('./LoanProduct')(sequelize, DataTypes);

// ===== Associations =====
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

// ===== Export =====
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
