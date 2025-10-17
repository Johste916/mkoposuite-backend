'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    const tableExists = async (t) => {
      try { await queryInterface.describeTable(t); return true; }
      catch { return false; }
    };
    const indexExists = async (table, name) => {
      const [rows] = await sequelize.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = :t AND indexname = :i`,
        { replacements: { t: table, i: name } }
      );
      return rows.length > 0;
    };
    const constraintExists = async (name) => {
      const [rows] = await sequelize.query(
        `SELECT 1 FROM pg_constraint WHERE conname = :n`,
        { replacements: { n: name } }
      );
      return rows.length > 0;
    };

    // ---- roles ---------------------------------------------------
    if (!(await tableExists('roles'))) {
      await sequelize.query(`
        CREATE TABLE roles (
          id          UUID PRIMARY KEY,
          name        VARCHAR(120) NOT NULL UNIQUE,
          description TEXT         NOT NULL DEFAULT '',
          is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
          created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );
      `);
    }

    // ---- user_roles ----------------------------------------------
    if (!(await tableExists('user_roles'))) {
      await sequelize.query(`
        CREATE TABLE user_roles (
          user_id     UUID NOT NULL,
          role_id     UUID NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    }

    // PK (user_id, role_id)
    if (!(await constraintExists('user_roles_pkey'))) {
      await sequelize.query(`
        ALTER TABLE user_roles
        ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);
      `);
    }

    // FK to roles
    if (!(await constraintExists('fk_user_roles_role_id'))) {
      await sequelize.query(`
        ALTER TABLE user_roles
        ADD CONSTRAINT fk_user_roles_role_id
        FOREIGN KEY (role_id) REFERENCES roles(id)
        ON UPDATE CASCADE ON DELETE CASCADE;
      `);
    }

    // Indexes (give explicit names and guard them)
    if (!(await indexExists('user_roles', 'idx_user_roles_user_id'))) {
      await sequelize.query(`CREATE INDEX idx_user_roles_user_id ON user_roles (user_id);`);
    }
    if (!(await indexExists('user_roles', 'idx_user_roles_role_id'))) {
      await sequelize.query(`CREATE INDEX idx_user_roles_role_id ON user_roles (role_id);`);
    }
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    // Drop in reverse order; IF EXISTS to be safe
    await sequelize.query(`DROP INDEX IF EXISTS idx_user_roles_role_id;`);
    await sequelize.query(`DROP INDEX IF EXISTS idx_user_roles_user_id;`);
    await sequelize.query(`ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS fk_user_roles_role_id;`);
    await sequelize.query(`ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;`);
    await sequelize.query(`DROP TABLE IF EXISTS user_roles CASCADE;`);
    await sequelize.query(`DROP TABLE IF EXISTS roles CASCADE;`);
  },
};
