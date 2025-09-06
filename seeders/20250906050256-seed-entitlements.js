'use strict';

module.exports = {
  async up(queryInterface /* , Sequelize */) {
    const q = queryInterface.sequelize;

    const [exists] = await q.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema='public' AND table_name=$1
       ) AS present;`,
      { bind: ['entitlements'] }
    );
    if (!exists?.[0]?.present) {
      console.warn('↪️  Skipping seed-entitlements: table "entitlements" missing');
      return;
    }

    const ENT_KEYS = [
      'savings.view','accounting.view','payroll.view','collateral.view',
      'loans.view','sms.send','investors.view','collections.view',
      'esign.view','assets.view','reports.view',
    ];

    const [rows] = await q.query(`SELECT key FROM public.entitlements;`);
    const have = new Set(rows.map((r) => r.key));

    const now = new Date();
    const toInsert = ENT_KEYS
      .filter((k) => !have.has(k))
      .map((k) => ({
        id: require('crypto').randomUUID(),
        key: k,
        label: k.replace(/\./g,' ').replace(/_/g,' ').replace(/\b\w/g, (m) => m.toUpperCase()),
        created_at: now,
        updated_at: now,
      }));

    if (toInsert.length) {
      await queryInterface.bulkInsert('entitlements', toInsert);
    }
  },

  async down(queryInterface /* , Sequelize */) {
    const q = queryInterface.sequelize;
    const ENT_KEYS = [
      'savings.view','accounting.view','payroll.view','collateral.view',
      'loans.view','sms.send','investors.view','collections.view',
      'esign.view','assets.view','reports.view',
    ];
    await q.query(
      `DELETE FROM public.entitlements WHERE key = ANY($1);`,
      { bind: [ENT_KEYS] }
    );
  },
};
