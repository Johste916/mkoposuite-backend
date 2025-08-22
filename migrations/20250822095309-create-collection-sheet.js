'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(qi, Sequelize) {
    // Helpers
    const mapType = (t) => {
      const s = String(t || '').toLowerCase();
      if (s.includes('uuid')) return Sequelize.UUID;
      if (s.includes('bigint')) return Sequelize.BIGINT;
      return Sequelize.INTEGER; // default if unknown
    };

    // Detect whether referenced tables exist + their id types
    let hasBranches = true;
    let hasUsers = true;
    let branchPkType = Sequelize.INTEGER;
    let userPkType = Sequelize.INTEGER;

    try {
      const branches = await qi.describeTable('branches');
      branchPkType = mapType(branches?.id?.type);
    } catch {
      hasBranches = false;
    }

    try {
      const users = await qi.describeTable('users');
      userPkType = mapType(users?.id?.type);
    } catch {
      hasUsers = false;
    }

    // If a previous failed attempt created the enum, drop it to avoid conflicts
    await qi.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_collection_sheets_status') THEN
          DROP TYPE enum_collection_sheets_status;
        END IF;
      END$$;
    `);

    // Build FK columns conditionally
    const branchIdCol = { type: branchPkType, allowNull: true };
    if (hasBranches) {
      branchIdCol.references = { model: 'branches', key: 'id' };
      branchIdCol.onUpdate = 'CASCADE';
      branchIdCol.onDelete = 'SET NULL';
    }

    const collectorIdCol = { type: userPkType, allowNull: true };
    const loanOfficerIdCol = { type: userPkType, allowNull: true };
    if (hasUsers) {
      collectorIdCol.references = { model: 'users', key: 'id' };
      collectorIdCol.onUpdate = 'CASCADE';
      collectorIdCol.onDelete = 'SET NULL';

      loanOfficerIdCol.references = { model: 'users', key: 'id' };
      loanOfficerIdCol.onUpdate = 'CASCADE';
      loanOfficerIdCol.onDelete = 'SET NULL';
    }

    // Create table
    await qi.createTable('collection_sheets', {
      id: {
        type: Sequelize.UUID,
        allowNull: false,
        primaryKey: true,
        // No DB default; your model uses DataTypes.UUIDV4
      },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },

      collector: { type: Sequelize.STRING, allowNull: true },
      loanOfficer: { type: Sequelize.STRING, allowNull: true },

      status: {
        type: Sequelize.ENUM('pending', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },

      branchId: branchIdCol,
      collectorId: collectorIdCol,
      loanOfficerId: loanOfficerIdCol,

      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    });

    // Optional indexes (safe even without FKs)
    await qi.addIndex('collection_sheets', ['date']);
    await qi.addIndex('collection_sheets', ['status']);
    await qi.addIndex('collection_sheets', ['type']);
  },

  async down(qi) {
    await qi.dropTable('collection_sheets');
    await qi.sequelize.query('DROP TYPE IF EXISTS enum_collection_sheets_status;');
  },
};
