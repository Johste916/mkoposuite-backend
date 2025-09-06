'use strict';
const crypto = require('crypto');

const now = new Date();
const uuid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
  );

const ENT_KEYS = [
  'savings.view','accounting.view','payroll.view','collateral.view',
  'loans.view','sms.send','investors.view','collections.view',
  'esign.view','assets.view','reports.view'
];
const BASIC_KEYS = new Set([
  'savings.view','accounting.view','collateral.view',
  'loans.view','investors.view','collections.view','assets.view'
]);

module.exports = {
  async up(queryInterface) {
    const q = queryInterface.sequelize;

    const tableExists = async (t) => {
      const [r] = await q.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name=$1
        ) AS present;`, { bind: [t] });
      return !!r?.[0]?.present;
    };

    const hasPlans = await tableExists('plans');
    const hasEnts  = await tableExists('entitlements');
    const hasMap   = await tableExists('plan_entitlements');
    if (!hasPlans || !hasEnts || !hasMap) {
      console.warn('↪️  Skipping seed-entitlements: required tables missing', { hasPlans, hasEnts, hasMap });
      return;
    }

    // Insert missing entitlements
    const [eRows] = await q.query(`SELECT key FROM public.entitlements;`);
    const haveEnt = new Set(eRows.map(r => r.key));
    const entInserts = ENT_KEYS
      .filter(k => !haveEnt.has(k))
      .map(k => ({
        id: uuid(),
        key: k,
        label: k.replace(/\./g,' ').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase()),
        created_at: now,
        updated_at: now
      }));
    if (entInserts.length) {
      await queryInterface.bulkInsert('entitlements', entInserts);
    }

    // Get plan ids
    const [plans] = await q.query(`SELECT id, LOWER(code) AS code FROM public.plans WHERE LOWER(code) IN ('basic','pro','premium','enterprise');`);
    const idByCode = Object.fromEntries(plans.map(p => [p.code, p.id]));
    const premiumId = idByCode['premium'] || idByCode['enterprise'];
    const proId     = idByCode['pro'];
    const basicId   = idByCode['basic'];

    if (!basicId || !proId || !premiumId) {
      console.warn('⚠️  seed-entitlements: plans missing; mapping will be partial', { basic: !!basicId, pro: !!proId, premium: !!premiumId });
    }

    // Get entitlement ids
    const [ents] = await q.query(`SELECT id, key FROM public.entitlements;`);
    const idByKey = Object.fromEntries(ents.map(e => [e.key, e.id]));

    // Existing mappings
    const [existing] = await q.query(`SELECT plan_id, entitlement_id FROM public.plan_entitlements;`);
    const havePair = new Set(existing.map(r => `${r.plan_id}:${r.entitlement_id}`));

    const wantPairs = [];
    for (const key of ENT_KEYS) {
      const eid = idByKey[key];
      if (!eid) continue;

      // basic subset
      if (basicId && BASIC_KEYS.has(key)) wantPairs.push([basicId, eid]);

      // pro = all
      if (proId) wantPairs.push([proId, eid]);

      // premium/enterprise = all
      if (premiumId) wantPairs.push([premiumId, eid]);

      // if enterprise plan exists separately, map it too
      const enterpriseId = idByCode['enterprise'];
      if (enterpriseId && enterpriseId !== premiumId) wantPairs.push([enterpriseId, eid]);
    }

    const inserts = wantPairs
      .filter(([pid, eid]) => !havePair.has(`${pid}:${eid}`))
      .map(([pid, eid]) => ({
        id: uuid(),
        plan_id: pid,
        entitlement_id: eid,
        created_at: now,
        updated_at: now
      }));

    if (inserts.length) {
      await queryInterface.bulkInsert('plan_entitlements', inserts);
    }
  },

  async down(queryInterface) {
    const q = queryInterface.sequelize;
    // remove mappings for our known plans & ents
    await q.query(`
      DELETE FROM public.plan_entitlements
      WHERE plan_id IN (SELECT id FROM public.plans WHERE LOWER(code) IN ('basic','pro','premium','enterprise'))
        AND entitlement_id IN (SELECT id FROM public.entitlements WHERE key = ANY($1));
    `, { bind: [ENT_KEYS] });

    await q.query(`DELETE FROM public.entitlements WHERE key = ANY($1);`, { bind: [ENT_KEYS] });
  }
};
