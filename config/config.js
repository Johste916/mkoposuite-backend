// backend/config/config.js
require('dotenv').config();

const common = {
  dialect: 'postgres',
  logging: process.env.SQL_LOGGING === 'true' ? console.log : false,
  define: { timestamps: true },
  pool: { max: 10, min: 0, idle: 10000, acquire: 30000 },
};

const development = {
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || null,
  database: process.env.DB_NAME || 'mkoposuite_dev',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  ...common,            // no SSL locally
};

const baseProd = process.env.DATABASE_URL
  ? { use_env_variable: 'DATABASE_URL', ...common }
  : {
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 5432,
      ...common,
    };

// Render/Heroku need SSL in prod
const production = {
  ...baseProd,
  dialectOptions: {
    ...(baseProd.dialectOptions || {}),
    ssl: { require: true, rejectUnauthorized: false },
  },
};

const test = {
  ...development,
  database: process.env.TEST_DB_NAME || 'mkoposuite_test',
  logging: false,
};

module.exports = { development, test, production };
