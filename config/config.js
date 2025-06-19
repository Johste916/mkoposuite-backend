module.exports = {
  development: {
    username: 'postgres',
    password: 'Johsta67!',
    database: 'postgres',
    host: 'db.qlrkytmgsxyuyjgfghuu.supabase.co',
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
    // (same values as development if needed)
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
