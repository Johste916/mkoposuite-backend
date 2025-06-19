'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const config = require(__dirname + '/../config/config.js')[env];
const db = {};

let sequelize;

if (config.use_env_variable && process.env[config.use_env_variable]) {
  // ✅ Use DATABASE_URL in production
  sequelize = new Sequelize(process.env[config.use_env_variable], config);
} else {
  // ✅ Use local DB in development
  sequelize = new Sequelize(config.database, config.username, config.password, config);
}

// ✅ Register models
db.User = require('./user')(sequelize, Sequelize.DataTypes);
db.Borrower = require('./borrower')(sequelize, Sequelize.DataTypes);
db.Branch = require('./branch')(sequelize, Sequelize.DataTypes);
db.Loan = require('./loan')(sequelize, Sequelize.DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, Sequelize.DataTypes);
db.LoanPayment = require('./loanpayment')(sequelize, Sequelize.DataTypes);

// ✅ Apply associations
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
