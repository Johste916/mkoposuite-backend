// backend/src/models/index.js

require('dotenv').config(); // Load .env variables
const { Sequelize, DataTypes } = require('sequelize');

// Print env check (for debugging only — remove if not needed)
console.log('📦 ENV TEST:', {
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_HOST: process.env.DB_HOST,
  DB_PORT: process.env.DB_PORT,
});

// Initialize Sequelize using individual parameters
const sequelize = new Sequelize(
  process.env.DB_NAME || 'postgres',
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 6543,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false, // Important for Supabase SSL
      },
    },
  }
);

// Initialize DB object
const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

// Load all models
db.User = require('./user')(sequelize, DataTypes);
db.Role = require('./role')(sequelize, DataTypes);
db.Branch = require('./branch')(sequelize, DataTypes);
db.Borrower = require('./borrower')(sequelize, DataTypes);
db.Loan = require('./loan')(sequelize, DataTypes);
db.LoanRepayment = require('./loanrepayment')(sequelize, DataTypes);
db.LoanPayment = require('./loanpayment')(sequelize, DataTypes);

// Setup associations (optional, add if needed)
if (db.User && db.Loan) {
  db.User.hasMany(db.Loan, { foreignKey: 'userId' });
  db.Loan.belongsTo(db.User, { foreignKey: 'userId' });
}

module.exports = db;
