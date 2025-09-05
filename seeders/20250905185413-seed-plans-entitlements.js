'use strict';

/**
 * Seeds Plans, Entitlements, and Plan→Entitlement mappings.
 * - Table names assumed: plans, entitlements, plan_entitlements
 * - Columns assumed:
 *    plans:            id (uuid), code (uniq), name, limits (jsonb), created_at, updated_at
 *    entitlements:     id (uuid), key (uniq), label?, created_at, updated_at
 *    plan_entitlements:id (uuid), plan_id (fk), entitlement_id (fk), created_at, updated_at
 *
 * Safe/Idempotent:
 * - Checks tables exist first; if missing, exits gracefully.
 * - Only inserts rows that are not already present.
 */

const crypto = require('crypto');

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
         ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
           (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16)
         );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const q = qi.sequelize;

    const tableExists = async (t) => {
      const [rows] = await q.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema='public' AND table_name=$1
         ) AS present;`,
        { bind: [t] }
      );
      return !!rows?.[0]?.present;
    };

    const plansTbl = 'plans';
    const entsTbl  = 'entitlements';
    const mapTbl   = 'plan_entitlements';

    const hasPlans = await tableExists(plansTbl);
    const hasEnts  = await tableExists(entsTbl);
    const hasMap   = await tableExists(mapTbl);

    if (!hasPlans || !hasEnts || !hasMap) {
      console.warn('↪️  Skipping seed: required tables missing:', {
        plans: hasPlans, entitlements: hasEnts, plan_entitlements: hasMap
      });
      return;
    }

    // Column detection (helps if schema differs slightly)
    const columnsFor = async (t) => {
      const [rows] = await q.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1;`,
        { bind: [t] }
      );
      return new Set(rows.map(r => r.column_name));
    };

    const planCols = await columnsFor(plansTbl);
    const entCols  = await columnsFor(entsTbl);

    const hasPlanCode   = planCols.has('code');
    const hasPlanLimits = planCols.has('limits');
    const hasEntLabel   = entCols.has('label');

    // ------- Define seeds -------
    const PLAN_DEFS = [
      { code: 'basic',      name: 'Basic',      limits: { borrowers: 1000,  loans: 2000,  sms_credits: 0 } },
      { code: 'pro',        name: 'Pro',        limits: { borrowers: 10000, loans: 20000, sms_credits: 1000 } },
      { code: 'enterprise', name: 'Enterprise', limits: { borrowers: null,  loans: null,  sms_credits: null } }, // null => Unlimited
    ];

    const ENT_KEYS = [
      'savings.view','accounting.view','payroll.view','collateral.view',
      'loans.view','sms.send','investors.view','collections.view',
      'esign.view','assets.view','reports.view'
    ];

    const BASIC_KEYS = new Set([
      'savings.view','accounting.view','collateral.view',
      'loans.view','investors.view','collections.view','assets.view'
    ]);
    // Pro/Enterprise = all ENT_KEYS

    const now = new Date();

    // ------- Plans: insert missing -------
    const [planRows] = await q.query(
      `SELECT id, ${hasPlanCode ? 'code' : 'LOWER(name) AS code'} FROM ${plansTbl};`
    );
    const havePlan = new Set(planRows.map(r => String(r.code).toLowerCase()));

    const planInserts = PLAN_DEFS
      .filter(p => !havePlan.has(p.code))
      .map(p => ({
        id: uuid(),
        ...(hasPlanCode ? { code: p.code } : {}),
        name: p.name,
        ...(hasPlanLimits ? { limits: JSON.stringify(p.limits) } : {}),
        created_at: now,
        updated_at: now,
      }));

    if (planInserts.length) {
      await qi.bulkInsert(plansTbl, planInserts);
    }

    // Re-read plans to build code->id map
    const [planRows2] = await q.query(
      `SELECT id, ${hasPlanCode ? 'code' : 'LOWER(name) AS code'} FROM ${plansTbl};`
    );
    const planIdByCode = Object.fromEntries(
      planRows2.map(r => [String(r.code).toLowerCase(), r.id])
    );

    // ------- Entitlements: insert missing -------
    const [entRows] = await q.query(`SELECT id, key FROM ${entsTbl};`);
    const haveEnt = new Set(entRows.map(r => r.key));

    const entInserts = ENT_KEYS
      .filter(k => !haveEnt.has(k))
      .map(k => ({
        id: uuid(),
        key: k,
        ...(hasEntLabel ? { label: k.replace(/\./g, ' ').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) } : {}),
        created_at: now,
        updated_at: now,
      }));

    if (entInserts.length) {
      await qi.bulkInsert(entsTbl, entInserts);
    }

    // Re-read entitlements to build key->id map
    const [entRows2] = await q.query(`SELECT id, key FROM ${entsTbl};`);
    const entIdByKey = Object.fromEntries(entRows2.map(r => [r.key, r.id]));

    // ------- PlanEntitlements: insert missing -------
    const basicId = planIdByCode['basic'];
    const proId   = planIdByCode['pro'];
    const entId   = planIdByCode['enterprise'];

    if (!basicId || !proId || !entId) {
      console.warn('⚠️  Plans not fully present; skipping mapping.');
      return;
    }

    // Build desired mappings
    const want = [];
    for (const k of ENT_KEYS) {
      const eid = entIdByKey[k];
      if (!eid) continue;

      // basic: subset
      if (BASIC_KEYS.has(k)) want.push([basicId, eid]);

      // pro + enterprise: all
      want.push([proId, eid]);
      want.push([entId, eid]);
    }

    // Read existing pairs to avoid duplicates
    const [existingPairs] = await q.query(
      `SELECT plan_id, entitlement_id FROM ${mapTbl}
       WHERE plan_id IN ($1,$2,$3);`,
      { bind: [basicId, proId, entId] }
    );
    const havePair = new Set(existingPairs.map(r => `${r.plan_id}:${r.entitlement_id}`));

    const mapInserts = want
      .filter(([pid, eid]) => !havePair.has(`${pid}:${eid}`))
      .map(([pid, eid]) => ({
        id: uuid(),
        plan_id: pid,
        entitlement_id: eid,
        created_at: now,
        updated_at: now,
      }));

    if (mapInserts.length) {
      await qi.bulkInsert(mapTbl, mapInserts);
    }

    console.log(`✅ Seeded plans/entitlements. Inserted: plans=${planInserts.length}, entitlements=${entInserts.length}, mappings=${mapInserts.length}`);
  },

  async down(queryInterface /* , Sequelize */) {
    const qi = queryInterface;
    const q = qi.sequelize;

    const plansTbl = 'plans';
    const entsTbl  = 'entitlements';
    const mapTbl   = 'plan_entitlements';

    const PLAN_CODES = ['basic','pro','enterprise'];
    const ENT_KEYS = [
      'savings.view','accounting.view','payroll.view','collateral.view',
      'loans.view','sms.send','investors.view','collections.view',
      'esign.view','assets.view','reports.view'
    ];

    // Find our plan/ent IDs first
    const [plans] = await q.query(`SELECT id, LOWER(COALESCE(code, name)) AS code FROM ${plansTbl} WHERE LOWER(COALESCE(code, name)) IN ('basic','pro','enterprise');`);
    const pIds = plans.map(p => p.id);

    const [ents] = await q.query(`SELECT id, key FROM ${entsTbl} WHERE key = ANY($1);`, { bind: [ENT_KEYS] });
    const eIds = ents.map(e => e.id);

    // Delete mappings for our plans/ents
    if (pIds.length && eIds.length) {
      await q.query(
        `DELETE FROM ${mapTbl} WHERE plan_id = ANY($1) AND entitlement_id = ANY($2);`,
        { bind: [pIds, eIds] }
      );
    }

    // Delete our entitlements (only those we inserted)
    if (eIds.length) {
      await q.query(`DELETE FROM ${entsTbl} WHERE id = ANY($1);`, { bind: [eIds] });
    }

    // Delete our plans
    if (pIds.length) {
      await q.query(`DELETE FROM ${plansTbl} WHERE id = ANY($1);`, { bind: [pIds] });
    }

    console.log('↩️  Reverted plans/entitlements seed.');
  }
};
