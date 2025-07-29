const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config.js')[env];

const db = {};

// Initialize Sequelize
let sequelize;
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

// Import models
db.User = require('./user')(sequelize, Sequelize.DataTypes);
db.Branch = require('./branch')(sequelize, Sequelize.DataTypes);
db.Borrower = require('./borrower')(sequelize, Sequelize.DataTypes);
db.Loan = require('./loan')(sequelize, Sequelize.DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, Sequelize.DataTypes);
db.LoanPayment = require('./loanpayment')(sequelize, Sequelize.DataTypes);

// ======================
// Model Associations
// ======================

// User ↔ Branch
db.User.belongsTo(db.Branch, { foreignKey: 'branchId' });
db.Branch.hasMany(db.User, { foreignKey: 'branchId' });

// Borrower ↔ Branch
db.Borrower.belongsTo(db.Branch, { foreignKey: 'branchId' });
db.Branch.hasMany(db.Borrower, { foreignKey: 'branchId' });

// Loan ↔ Borrower
db.Loan.belongsTo(db.Borrower, { foreignKey: 'borrowerId' });
db.Borrower.hasMany(db.Loan, { foreignKey: 'borrowerId' });

// Loan ↔ Branch
db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId' });
db.Branch.hasMany(db.Loan, { foreignKey: 'branchId' });

// LoanRepayment ↔ Loan
db.LoanRepayment.belongsTo(db.Loan, { foreignKey: 'loanId' });
db.Loan.hasMany(db.LoanRepayment, { foreignKey: 'loanId' });

// LoanPayment ↔ Loan
db.LoanPayment.belongsTo(db.Loan, { foreignKey: 'loanId' });
db.Loan.hasMany(db.LoanPayment, { foreignKey: 'loanId' });

// LoanPayment ↔ User (who recorded the payment)
db.LoanPayment.belongsTo(db.User, { foreignKey: 'userId' });
db.User.hasMany(db.LoanPayment, { foreignKey: 'userId' });

// Export Sequelize and db object
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
