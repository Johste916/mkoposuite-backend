const Sequelize = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

const db = {};

// Load models
db.User = require('./user')(sequelize, Sequelize.DataTypes);
db.Branch = require('./branch')(sequelize, Sequelize.DataTypes);
db.Borrower = require('./borrower')(sequelize, Sequelize.DataTypes);
db.Loan = require('./loan')(sequelize, Sequelize.DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, Sequelize.DataTypes);
db.LoanPayment = require('./loanpayment')(sequelize, Sequelize.DataTypes);

// ======================
// ✅ Model Associations
// ======================
if (db.User && db.Branch) {
  db.User.belongsTo(db.Branch, { foreignKey: 'branchId' });
  db.Branch.hasMany(db.User, { foreignKey: 'branchId' });
}

if (db.Borrower && db.Branch) {
  db.Borrower.belongsTo(db.Branch, { foreignKey: 'branchId' });
  db.Branch.hasMany(db.Borrower, { foreignKey: 'branchId' });
}

if (db.Loan && db.Borrower) {
  db.Loan.belongsTo(db.Borrower, { foreignKey: 'borrowerId' });
  db.Borrower.hasMany(db.Loan, { foreignKey: 'borrowerId' });
}

if (db.Loan && db.Branch) {
  db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId' });
  db.Branch.hasMany(db.Loan, { foreignKey: 'branchId' });
}

if (db.LoanRepayment && db.Loan) {
  db.LoanRepayment.belongsTo(db.Loan, { foreignKey: 'loanId' });
  db.Loan.hasMany(db.LoanRepayment, { foreignKey: 'loanId' });
}

if (db.LoanPayment && db.Loan) {
  db.LoanPayment.belongsTo(db.Loan, { foreignKey: 'loanId' });
  db.Loan.hasMany(db.LoanPayment, { foreignKey: 'loanId' });
}

if (db.LoanPayment && db.User) {
  db.LoanPayment.belongsTo(db.User, { foreignKey: 'userId' });
  db.User.hasMany(db.LoanPayment, { foreignKey: 'userId' });
}

// ======================
// Finalize
// ======================
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
