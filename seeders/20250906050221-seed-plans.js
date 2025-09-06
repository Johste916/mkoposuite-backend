'use strict';

module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;
    const [exists] = await q.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name=$1
       ) AS present;`, { bind: ['plans'] }
    );
    if (!exists?.[0]?.present) { console.warn('↪️  skip: table "plans" missing'); return; }

    const defs = [
      { code: 'basic',   name: 'Basic',   limits: { borrowers: 1000,  loans: 2000,  sms_credits: 0 } },
      { code: 'pro',     name: 'Pro',     limits: { borrowers: 10000, loans: 20000, sms_credits: 1000 } },
      { code: 'premium', name: 'Premium', limits: { borrowers: null,  loans: null,  sms_credits: null } },
    ];
    const [rows] = await q.query(`SELECT LOWER(COALESCE(code,name)) AS code FROM public.plans;`);
    const have = new Set(rows.map(r => r.code));
    const now = new Date();
    const toInsert = defs.filter(p => !have.has(p.code)).map(p => ({
      id: require('crypto').randomUUID(), code: p.code, name: p.name,
      limits: JSON.stringify(p.limits), created_at: now, updated_at: now
    }));
    if (toInsert.length) await queryInterface.bulkInsert('plans', toInsert);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM public.plans WHERE LOWER(COALESCE(code,name)) = ANY($1);`,
      { bind: [['basic','pro','premium']] }
    );
  },
};
