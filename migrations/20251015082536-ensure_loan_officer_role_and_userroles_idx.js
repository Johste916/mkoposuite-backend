'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
-- Ensure "loan officer" role exists
INSERT INTO "Roles"(id, name, description, "isSystem", "createdAt","updatedAt")
SELECT gen_random_uuid(), 'loan officer', 'Can manage/disburse loans', TRUE, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Roles" WHERE LOWER(name) = 'loan officer');

-- Unique index on (userId, roleId) to prevent dup mappings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='UserRoles' AND indexname='userroles_userid_roleid_uniq'
  ) THEN
    CREATE UNIQUE INDEX userroles_userid_roleid_uniq ON "UserRoles" ("userId","roleId");
  END IF;
END $$;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
DROP INDEX IF EXISTS userroles_userid_roleid_uniq;
-- keep the role; down migration won't delete it (safer for prod data)
    `);
  }
};
