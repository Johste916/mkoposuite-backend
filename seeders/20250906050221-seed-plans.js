'use strict';
const crypto = require('crypto');

const now = new Date();
const uuid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
  );

const PLAN_DEFS = [
  { code: 'basic',      name: 'Basic',      limits: { borrowers: 1000,  loans: 2000,  sms_credits: 0 } },
  { code: 'pro',        name: 'Pro',        limits: { borrowers: 10000, loans: 20000, sms_credits: 1000 } },
  { code: 'premium',    name: 'Premium',    limits: { borrowers: null,  loans: null,  sms_credits: null } },
  { code: 'enterprise', name: 'Enterprise', limits: { borrowers: null,  loans: null,  sms_credits: null } }, // alias
];

module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;

    const [exists] = await q.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='plans'
      ) AS present;`);
    if (!exists?.[0]?.present) {
      console.warn('↪️  Skipping seed-plans: plans table missing');
      return;
    }

    const [rows] = await q.query(`SELECT LOWER(code) AS code FROM public.plans;`);
    const have = new Set(rows.map(r => r.code));

    const inserts = PLAN_DEFS
      .filter(p => !have.has(p.code))
      .map(p => ({
        id: uuid(),
        code: p.code,
        name: p.name,
        limits: JSON.stringify(p.limits),
        created_at: now,
        updated_at: now
      }));

    if (inserts.length) {
      await queryInterface.bulkInsert('plans', inserts);
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM public.plans WHERE LOWER(code) IN ('basic','pro','premium','enterprise');`
    );
  }
};
