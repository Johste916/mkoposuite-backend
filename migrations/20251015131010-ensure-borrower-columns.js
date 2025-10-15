'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tName = 'Borrowers';
    const qi = queryInterface;

    const ensureColumn = async (name, spec) => {
      const desc = await qi.describeTable(tName);
      if (!desc[name]) {
        await qi.addColumn(tName, name, spec);
      }
    };

    const tryAddConstraint = async (name, opts) => {
      try {
        await qi.addConstraint(tName, { ...opts, name });
      } catch (e) {
        // ignore if already exists or table missing
      }
    };

    // Core / profile
    await ensureColumn('nationalId', { type: Sequelize.STRING, allowNull: true });
    await ensureColumn('phone',      { type: Sequelize.STRING, allowNull: true });
    await ensureColumn('email',      { type: Sequelize.STRING, allowNull: true });
    await ensureColumn('address',    { type: Sequelize.STRING, allowNull: true });

    // Branch & officer
    await ensureColumn('branchId',        { type: Sequelize.INTEGER, allowNull: true });
    await ensureColumn('loan_officer_id', { type: Sequelize.UUID, allowNull: true });

    // KYC / personal
    await ensureColumn('gender',               { type: Sequelize.STRING(16), allowNull: true });
    await ensureColumn('birthDate',            { type: Sequelize.DATEONLY, allowNull: true });
    await ensureColumn('employmentStatus',     { type: Sequelize.STRING(32), allowNull: true });
    await ensureColumn('occupation',           { type: Sequelize.STRING, allowNull: true });
    await ensureColumn('idType',               { type: Sequelize.STRING(32), allowNull: true });
    await ensureColumn('idIssuedDate',         { type: Sequelize.DATEONLY, allowNull: true });
    await ensureColumn('idExpiryDate',         { type: Sequelize.DATEONLY, allowNull: true });
    await ensureColumn('nextKinName',          { type: Sequelize.STRING, allowNull: true });
    await ensureColumn('nextKinPhone',         { type: Sequelize.STRING, allowNull: true });
    await ensureColumn('nextOfKinRelationship',{ type: Sequelize.STRING, allowNull: true });

    // Extras used in UI
    await ensureColumn('groupId',        { type: Sequelize.STRING, allowNull: true });
    await ensureColumn('loanType',       { type: Sequelize.STRING(32), allowNull: true, defaultValue: 'individual' });
    await ensureColumn('regDate',        { type: Sequelize.DATEONLY, allowNull: true });
    await ensureColumn('maritalStatus',  { type: Sequelize.STRING(32), allowNull: true });
    await ensureColumn('educationLevel', { type: Sequelize.STRING(64), allowNull: true });
    await ensureColumn('customerNumber', { type: Sequelize.STRING(64), allowNull: true });
    await ensureColumn('tin',            { type: Sequelize.STRING(32), allowNull: true });
    await ensureColumn('nationality',    { type: Sequelize.STRING(64), allowNull: true });
    await ensureColumn('photoUrl',       { type: Sequelize.STRING, allowNull: true });

    await ensureColumn('status', { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'active' });

    // Indexes (idempotent-ish)
    try { await qi.addIndex(tName, ['phone']); } catch {}
    try { await qi.addIndex(tName, ['nationalId']); } catch {}
    try { await qi.addIndex(tName, ['branchId']); } catch {}
    try { await qi.addIndex(tName, ['loan_officer_id']); } catch {}
    try { await qi.addIndex(tName, ['status']); } catch {}

    // FK: branchId -> Branches.id (if Branches exists)
    try {
      await qi.describeTable('Branches'); // throws if table doesn't exist
      await tryAddConstraint('fk_borrowers_branch_id_snake', {
        type: 'foreign key',
        fields: ['branchId'],
        references: { table: 'Branches', field: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    } catch {}

    // Optional FK to Users on loan_officer_id (only if Users table exists and id is UUID)
    try {
      const usersDesc = await qi.describeTable('Users');
      if (usersDesc.id && /uuid/i.test(String(usersDesc.id.type))) {
        await tryAddConstraint('fk_borrowers_loan_officer_uuid', {
          type: 'foreign key',
          fields: ['loan_officer_id'],
          references: { table: 'Users', field: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        });
      }
    } catch {}

    // Backfill status if null
    await qi.sequelize.query(`UPDATE "${tName}" SET "status"='active' WHERE "status" IS NULL`);
  },

  async down(queryInterface) {
    // Non-destructive: just try to drop added FKs; keep columns because FE depends on them.
    try { await queryInterface.removeConstraint('Borrowers', 'fk_borrowers_branch_id_snake'); } catch {}
    try { await queryInterface.removeConstraint('Borrowers', 'fk_borrowers_loan_officer_uuid'); } catch {}
  },
};
