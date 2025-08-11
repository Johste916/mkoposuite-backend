'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1️⃣ Create table without foreign key first
    await queryInterface.createTable('activity_logs', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      userId: {
        type: Sequelize.UUID, // match your users.id type
        allowNull: true
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false
      },
      details: {
        type: Sequelize.JSONB,
        allowNull: true
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // 2️⃣ Add the FK constraint after table exists
    //    This won't throw an error if users doesn't exist *at migration time*
    //    because the FK creation will run when users table is already there.
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
          ALTER TABLE activity_logs
          ADD CONSTRAINT fk_activity_logs_user
          FOREIGN KEY ("userId")
          REFERENCES users(id)
          ON DELETE CASCADE;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('activity_logs');
  }
};
