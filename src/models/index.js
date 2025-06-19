// backend/src/models/index.js

require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');

// Setup the Sequelize connection using environment variables
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: 'postgres',
    logging: false,
  }
);

// Initialize the DB object
const db = {};

// Attach Sequelize instance and constructor
db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Load and initialize all models
db.User          = require('./user')(sequelize, DataTypes);
db.Loan          = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, DataTypes);
db.Borrower      = require('./borrower')(sequelize, DataTypes);
db.Branch        = require('./branch')(sequelize, DataTypes);
db.LoanPayment   = require('./loanpayment')(sequelize, DataTypes);

// Export the DB object
module.exports = db;
