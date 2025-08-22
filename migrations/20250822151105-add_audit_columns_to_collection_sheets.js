'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(qi, Sequelize) {
    // Helper to map PK type we find on `users.id`
    const mapType = (t) => {
      const s = String(t || '').toLowerCase();
      if (s.includes('uuid')) return Sequelize.UUID;
      if (s.includes('bigint')) return Sequelize.BIGINT;
      return Sequelize.INTEGER;
    };

    // Does `users` table exist?
    let usersExists = false;
    let userPkType = Sequelize.INTEGER;
    try {
      const [r] = await qi.sequelize.query(`SELECT to_regclass('public.users') AS t;`);
      usersExists = Boolean(r?.[0]?.t);
      if (usersExists) {
        const users = await qi.describeTable('users');
        userPkType = mapType(users?.id?.type);
      }
    } catch {
      usersExists = false;
    }

    // Current columns on collection_sheets
    const table = await qi.describeTable('collection_sheets');

    // Build column defs conditionally (FKs only if users table exists)
    const createdByCol = usersExists
      ? {
          type: userPkType,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        }
      : { type: userPkType, allowNull: true };

    const updatedByCol = usersExists
      ? {
          type: userPkType,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        }
      : { type: userPkType, allowNull: true };

    if (!table.createdBy) {
      await qi.addColumn('collection_sheets', 'createdBy', createdByCol);
    }
    if (!table.updatedBy) {
      await qi.addColumn('collection_sheets', 'updatedBy', updatedByCol);
    }
  },

  async down(qi /*, Sequelize */) {
    // Remove columns if they exist (safe on any state)
    const table = await qi.describeTable('collection_sheets').catch(() => null);
    if (table?.updatedBy) await qi.removeColumn('collection_sheets', 'updatedBy');
    if (table?.createdBy) await qi.removeColumn('collection_sheets', 'createdBy');
  },
};
