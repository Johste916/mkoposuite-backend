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

db.User.belongsTo(db.Branch, { foreignKey: 'branchId' });
db.Branch.hasMany(db.User, { foreignKey: 'branchId' });

db.Borrower.belongsTo(db.Branch, { foreignKey: 'branchId' });
db.Branch.hasMany(db.Borrower, { foreignKey: 'branchId' });

db.Loan.belongsTo(db.Borrower, { foreignKey: 'borrowerId' });
db.Borrower.hasMany(db.Loan, { foreignKey: 'borrowerId' });

db.Loan.belongsTo(db.Branch, { foreignKey: 'branchId' });
db.Branch.hasMany(db.Loan, { foreignKey: 'branchId' });

db.LoanRepayment.belongsTo(db.Loan, { foreignKey: 'loanId' });
db.Loan.hasMany(db.LoanRepayment, { foreignKey: 'loanId' });

db.LoanPayment.belongsTo(db.Loan, { foreignKey: 'loanId' });
db.Loan.hasMany(db.LoanPayment, { foreignKey: 'loanId' });

db.LoanPayment.belongsTo(db.User, { foreignKey: 'userId' });
db.User.hasMany(db.LoanPayment, { foreignKey: 'userId' });

// Finalize
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
