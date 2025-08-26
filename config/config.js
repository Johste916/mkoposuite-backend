// backend/config/config.js
'use strict';
require('dotenv').config();

const common = {
  dialect: 'postgres',
  logging: process.env.SQL_LOGGING === 'true' ? console.log : false,
  define: { timestamps: true },
  pool: { max: 10, min: 0, idle: 10000, acquire: 30000 },
};

/**
 * Dev: default to NO SSL so local Postgres works even if PGSSLMODE=require is present.
 * To use SSL in dev, set DB_SSL=true in .env.
 */
const devWantsSSL =
  (process.env.DB_SSL || '').toLowerCase() === 'true';

const development = {
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || null,
  database: process.env.DB_NAME || 'mkoposuite_dev',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  ...common,
  dialectOptions: devWantsSSL
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : { ssl: false }, // <-- explicitly disable to override PGSSLMODE=require
};

const test = {
  ...development,
  database: process.env.TEST_DB_NAME || 'mkoposuite_test',
  logging: false,
};

/**
 * Prod: always use DATABASE_URL with SSL (Supabase/Render).
 * If you truly don't want SSL in prod, change require->false at your own risk.
 */
const production = {
  use_env_variable: 'DATABASE_URL',
  ...common,
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false },
  },
};

module.exports = { development, test, production };
