'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1️⃣ Create table without FK constraints first
    await queryInterface.createTable('activity_assignments', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      activityId: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      assigneeId: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      assignerId: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      dueDate: {
        type: Sequelize.DATE,
        allowNull: true
      },
      note: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('open', 'in-progress', 'completed', 'cancelled'),
        defaultValue: 'open'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // 2️⃣ Add FK to activity_logs if it exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs') THEN
          ALTER TABLE activity_assignments
          ADD CONSTRAINT fk_activity_assignments_activity
          FOREIGN KEY ("activityId")
          REFERENCES activity_logs(id)
          ON UPDATE CASCADE
          ON DELETE CASCADE;
        END IF;
      END$$;
    `);

    // 3️⃣ Add FK to users for assigneeId if it exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
          ALTER TABLE activity_assignments
          ADD CONSTRAINT fk_activity_assignments_assignee
          FOREIGN KEY ("assigneeId")
          REFERENCES users(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);

    // 4️⃣ Add FK to users for assignerId if it exists
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
          ALTER TABLE activity_assignments
          ADD CONSTRAINT fk_activity_assignments_assigner
          FOREIGN KEY ("assignerId")
          REFERENCES users(id)
          ON UPDATE CASCADE
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('activity_assignments');
  }
};
