'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        allowNull: false,
        primaryKey: true,
      },
      name: { type: Sequelize.STRING, allowNull: false },
      email: { type: Sequelize.STRING, allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING, allowNull: false },

      // ✅ optional single-role string used by some parts of the code
      role: { type: Sequelize.STRING, allowNull: true, defaultValue: 'user' },

      // ✅ used by officer auto-assignment checks
      branchId: { type: Sequelize.INTEGER, allowNull: true },

      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        defaultValue: 'active',
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Case-insensitive unique email (best-effort; works on Postgres)
    try {
      await queryInterface.addIndex('Users', [Sequelize.literal('LOWER("email")')], {
        unique: true,
        name: 'users_email_lower_unique_idx',
      });
    } catch (_) {}
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Users');
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_Users_status";`);
  },
};
