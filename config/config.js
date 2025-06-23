module.exports = {
  development: {
    username: 'postgres',
    password: 'Johsta67!',
    database: 'postgres',
    host: 'db.wmqicrqpffbcosxvkfci.supabase.co', // ✅ new working host
    port: 5432,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  },

  test: {
    // Optional: can copy same as development if needed
  },

  production: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
};
