'use strict';

module.exports = {
  async up(queryInterface) {
    const id = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
    await queryInterface.sequelize.query(`
      INSERT INTO public.tenants (id, name, status, plan_code, grace_days, created_at, updated_at)
      VALUES (:id, 'Organization', 'trial', 'basic', 7, now(), now())
      ON CONFLICT (id) DO NOTHING;
    `, { replacements: { id } });
  },
  async down(queryInterface) {
    const id = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
    await queryInterface.sequelize.query(`DELETE FROM public.tenants WHERE id = :id;`, { replacements: { id } });
  },
};
