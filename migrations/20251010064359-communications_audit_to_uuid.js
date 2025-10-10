'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Drop legacy FKs if they exist
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_created_by_fkey') THEN
          ALTER TABLE public."communications" DROP CONSTRAINT communications_created_by_fkey;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_updated_by_fkey') THEN
          ALTER TABLE public."communications" DROP CONSTRAINT communications_updated_by_fkey;
        END IF;
      END$$;
    `);

    // Convert INTEGER -> UUID safely (cast via text only if UUID-shaped; else NULL)
    await queryInterface.sequelize.query(`
      ALTER TABLE public."communications"
        ALTER COLUMN created_by TYPE uuid
          USING (
            CASE
              WHEN created_by IS NULL THEN NULL
              WHEN created_by::text ~ '^[0-9a-fA-F-]{36}$' THEN (created_by::text)::uuid
              ELSE NULL
            END
          ),
        ALTER COLUMN updated_by TYPE uuid
          USING (
            CASE
              WHEN updated_by IS NULL THEN NULL
              WHEN updated_by::text ~ '^[0-9a-fA-F-]{36}$' THEN (updated_by::text)::uuid
              ELSE NULL
            END
          );
    `);

    // Helpful indexes
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS communications_created_by_idx ON public."communications"(created_by);
      CREATE INDEX IF NOT EXISTS communications_updated_by_idx ON public."communications"(updated_by);
    `);

    // (Optional) settings.key uniqueness
    await queryInterface.sequelize.query(`
      ALTER TABLE public."settings"
        ALTER COLUMN key TYPE varchar(200);
      CREATE UNIQUE INDEX IF NOT EXISTS settings_key_unique ON public."settings"(key);
    `);
  },

  async down(queryInterface) {
    // Convert back to INTEGER (UUIDs become NULL)
    await queryInterface.sequelize.query(`
      ALTER TABLE public."communications"
        ALTER COLUMN created_by TYPE integer
          USING (CASE WHEN created_by::text ~ '^[0-9]+$' THEN created_by::integer ELSE NULL END),
        ALTER COLUMN updated_by TYPE integer
          USING (CASE WHEN updated_by::text ~ '^[0-9]+$' THEN updated_by::integer ELSE NULL END);
    `);

    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS communications_created_by_idx;
      DROP INDEX IF EXISTS communications_updated_by_idx;
      DROP INDEX IF EXISTS settings_key_unique;
    `);
  }
};
