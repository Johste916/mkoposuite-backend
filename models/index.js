// src/models/index.js
require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');

// Ensure all values are read
const dbName = process.env.DB_NAME;
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASSWORD;
const dbHost = process.env.DB_HOST;
const dbPort = process.env.DB_PORT;

if (!dbName || !dbUser || !dbPass || !dbHost || !dbPort) {
  throw new Error("❌ Missing one or more required DB environment variables");
}

const sequelize = new Sequelize(dbName, dbUser, dbPass, {
  host: dbHost,
  port: dbPort,
  dialect: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.User = require('./user')(sequelize, DataTypes);
db.Loan = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, DataTypes);
db.Borrower = require('./borrower')(sequelize, DataTypes);
db.Branch = require('./branch')(sequelize, DataTypes);
db.LoanPayment = require('./loanpayment')(sequelize, DataTypes);

module.exports = db;
