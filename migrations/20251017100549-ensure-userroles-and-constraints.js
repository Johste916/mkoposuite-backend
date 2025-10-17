'use strict';

/**
 * Idempotent migration:
 * - Creates UserRoles if missing.
 * - Adds unique pair index (userId, roleId) if missing.
 * - Adds FKs to Users(id) and Roles(id) with CASCADE if missing.
 */
async function tableExists(sequelize, name) {
  const [rows] = await sequelize.query(`SELECT to_regclass('public."${name}"') AS reg;`);
  return !!rows[0].reg;
}
async function indexExists(sequelize, table, name) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename=:t AND indexname=:n`,
    { replacements: { t: table, n: name } }
  );
  return rows.length > 0;
}
async function fkExists(sequelize, table, constraintName) {
  const [rows] = await sequelize.query(
    `SELECT 1
     FROM information_schema.table_constraints
     WHERE table_schema='public' AND table_name=:t AND constraint_name=:c AND constraint_type='FOREIGN KEY'`,
    { replacements: { t: table, c: constraintName } }
  );
  return rows.length > 0;
}

module.exports = {
  async up(qi, Sequelize) {
    const t = await qi.sequelize.transaction();
    try {
      const hasTable = await tableExists(qi.sequelize, 'UserRoles');

      if (!hasTable) {
        await qi.createTable('UserRoles', {
          id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
          userId: { type: Sequelize.UUID, allowNull: false },
          roleId: { type: Sequelize.UUID, allowNull: false },
          createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
          updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') },
        }, { transaction: t });
      }

      if (!(await indexExists(qi.sequelize, 'UserRoles', 'user_roles_unique_pair'))) {
        await qi.addIndex('UserRoles', ['userId', 'roleId'], { unique: true, name: 'user_roles_unique_pair', transaction: t });
      }
      if (!(await indexExists(qi.sequelize, 'UserRoles', 'userroles_userid_idx'))) {
        await qi.addIndex('UserRoles', ['userId'], { name: 'userroles_userid_idx', transaction: t });
      }
      if (!(await indexExists(qi.sequelize, 'UserRoles', 'userroles_roleid_idx'))) {
        await qi.addIndex('UserRoles', ['roleId'], { name: 'userroles_roleid_idx', transaction: t });
      }

      if (!(await fkExists(qi.sequelize, 'UserRoles', 'userroles_userid_fkey'))) {
        await qi.addConstraint('UserRoles', {
          fields: ['userId'],
          type: 'foreign key',
          name: 'userroles_userid_fkey',
          references: { table: 'Users', field: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
          transaction: t,
        });
      }

      if (!(await fkExists(qi.sequelize, 'UserRoles', 'userroles_roleid_fkey'))) {
        await qi.addConstraint('UserRoles', {
          fields: ['roleId'],
          type: 'foreign key',
          name: 'userroles_roleid_fkey',
          references: { table: 'Roles', field: 'id' },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
          transaction: t,
        });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(qi, Sequelize) {
    const t = await qi.sequelize.transaction();
    try {
      // optional: keep table; but if you want to fully revert:
      try { await qi.removeConstraint('UserRoles', 'userroles_userid_fkey', { transaction: t }); } catch (_) {}
      try { await qi.removeConstraint('UserRoles', 'userroles_roleid_fkey', { transaction: t }); } catch (_) {}
      try { await qi.removeIndex('UserRoles', 'user_roles_unique_pair', { transaction: t }); } catch (_) {}
      try { await qi.removeIndex('UserRoles', 'userroles_userid_idx', { transaction: t }); } catch (_) {}
      try { await qi.removeIndex('UserRoles', 'userroles_roleid_idx', { transaction: t }); } catch (_) {}
      // Comment out the next line if you don't want to drop the table on down():
      // await qi.dropTable('UserRoles', { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },
};
