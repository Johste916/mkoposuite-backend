'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1️⃣ Create the activity_comments table without FK first
    await queryInterface.createTable('activity_comments', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      activityLogId: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      createdBy: {
        type: Sequelize.UUID, // or INTEGER depending on your users.id type
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

    // 2️⃣ Conditionally add FK to activity_logs if it exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs') THEN
          ALTER TABLE activity_comments
          ADD CONSTRAINT fk_activity_comments_activity_log
          FOREIGN KEY ("activityLogId")
          REFERENCES activity_logs(id)
          ON DELETE CASCADE;
        END IF;
      END$$;
    `);

    // 3️⃣ Conditionally add FK to users if it exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
          ALTER TABLE activity_comments
          ADD CONSTRAINT fk_activity_comments_created_by
          FOREIGN KEY ("createdBy")
          REFERENCES users(id)
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('activity_comments');
  }
};
