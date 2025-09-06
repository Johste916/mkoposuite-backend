'use strict';

module.exports = {
  async up(queryInterface /* , Sequelize */) {
    const q = queryInterface.sequelize;

    // Ensure tables exist
    const check = async (t) => {
      const [r] = await q.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema='public' AND table_name=$1
         ) AS present;`,
        { bind: [t] }
      );
      return !!r?.[0]?.present;
    };
    if (!(await check('plans')) || !(await check('entitlements')) || !(await check('plan_entitlements'))) {
      console.warn('↪️  Skipping plan-entitlements mapping: required tables missing');
      return;
    }

    // Fetch plan ids
    const [plans] = await q.query(`
      SELECT id, LOWER(COALESCE(code,name)) AS code
      FROM public.plans
      WHERE LOWER(COALESCE(code,name)) IN ('basic','pro','premium');
    `);
    const pid = Object.fromEntries(plans.map((p) => [p.code, p.id]));
    if (!pid.basic || !pid.pro || !pid.premium) {
      console.warn('⚠️  Missing basic/pro/premium plans; cannot map entitlements');
      return;
    }

    // Fetch entitlement ids
    const ENT_KEYS = [
      'savings.view','accounting.view','payroll.view','collateral.view',
      'loans.view','sms.send','investors.view','collections.view',
      'esign.view','assets.view','reports.view',
    ];
    const [ents] = await q.query(
      `SELECT id, key FROM public.entitlements WHERE key = ANY($1);`,
      { bind: [ENT_KEYS] }
    );
    const eid = Object.fromEntries(ents.map((e) => [e.key, e.id]));

    const BASIC_KEYS = new Set([
      'savings.view','accounting.view','collateral.view',
      'loans.view','investors.view','collections.view','assets.view',
    ]);

    // Desired pairs
    const want = [];
    for (const k of ENT_KEYS) {
      const e = eid[k];
      if (!e) continue;
      if (BASIC_KEYS.has(k)) want.push([pid.basic, e]);
      want.push([pid.pro, e]);
      want.push([pid.premium, e]);
    }

    // Existing pairs (avoid duplicates)
    const [existing] = await q.query(
      `SELECT plan_id, entitlement_id FROM public.plan_entitlements
       WHERE plan_id = ANY($1);`,
      { bind: [[pid.basic, pid.pro, pid.premium]] }
    );
    const have = new Set(existing.map((r) => `${r.plan_id}:${r.entitlement_id}`));

    const now = new Date();
    const toInsert = want
      .filter(([p, e]) => !have.has(`${p}:${e}`))
      .map(([plan_id, entitlement_id]) => ({
        id: require('crypto').randomUUID(),
        plan_id, entitlement_id,
        created_at: now, updated_at: now,
      }));

    if (toInsert.length) {
      await queryInterface.bulkInsert('plan_entitlements', toInsert);
    }
  },

  async down(queryInterface /* , Sequelize */) {
    const q = queryInterface.sequelize;

    // Limit deletes to our three plans & known entitlement keys
    const [plans] = await q.query(`
      SELECT id FROM public.plans
      WHERE LOWER(COALESCE(code,name)) IN ('basic','pro','premium');
    `);
    const planIds = plans.map((p) => p.id);
    if (!planIds.length) return;

    const ENT_KEYS = [
      'savings.view','accounting.view','payroll.view','collateral.view',
      'loans.view','sms.send','investors.view','collections.view',
      'esign.view','assets.view','reports.view',
    ];
    const [ents] = await q.query(
      `SELECT id FROM public.entitlements WHERE key = ANY($1);`,
      { bind: [ENT_KEYS] }
    );
    const entIds = ents.map((e) => e.id);
    if (!entIds.length) return;

    await q.query(
      `DELETE FROM public.plan_entitlements
       WHERE plan_id = ANY($1) AND entitlement_id = ANY($2);`,
      { bind: [planIds, entIds] }
    );
  },
};
