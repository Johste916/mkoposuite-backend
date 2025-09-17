// migrations/20250808121235-create-activity-logs.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Create the table FIRST, without any FK
    await queryInterface.createTable("activity_logs", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      userId: { type: Sequelize.UUID, allowNull: true }, // "Users".id is UUID
      action: { type: Sequelize.STRING, allowNull: false },
      details: { type: Sequelize.JSONB, allowNull: true },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    // Add the FK conditionally to public."Users"
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF to_regclass('public."Users"') IS NOT NULL THEN
          ALTER TABLE public.activity_logs
          ADD CONSTRAINT fk_activity_logs_user
          FOREIGN KEY ("userId")
          REFERENCES public."Users"(id)
          ON DELETE CASCADE
          ON UPDATE CASCADE;
        END IF;
      END$$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("activity_logs");
  },
};
