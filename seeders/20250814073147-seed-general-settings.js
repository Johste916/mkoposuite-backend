'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const qi = queryInterface;
    const sequelize = qi.sequelize;
    const dialect = sequelize.getDialect();
    const table = 'settings';

    const value = {
      branding: { appName: 'MkopoSuite', logoUrl: '', primaryColor: '#1d4ed8', secondaryColor: '#0ea5e9' },
      locale: {
        country: 'Tanzania',
        currency: 'TZS',
        timezone: 'Africa/Dar_es_Salaam',
        language: 'en',
        currencyInWords: 'Shillings',
        dateFormat: 'dd/mm/yyyy',
      },
      numberFormats: { thousandSeparator: ',', decimalSeparator: '.', currencyPosition: 'prefix' },
      dashboard: { landingWidgets: ['kpis', 'recent-activity', 'collections'], showTicker: true },
    };

    // Don't include "id" — schema may or may not have it.
    // Use explicit JSONB cast on Postgres to avoid "Invalid value" errors.
    if (dialect === 'postgres') {
      const json = JSON.stringify(value).replace(/'/g, "''"); // escape single quotes
      await sequelize.query(`
        INSERT INTO "settings" ("key","value","description","createdAt","updatedAt")
        VALUES ('general', '${json}'::jsonb, '', NOW(), NOW())
        ON CONFLICT ("key") DO NOTHING;
      `);
    } else {
      // Other dialects accept plain JS object for JSON/JSONB
      const now = new Date();
      try {
        await qi.bulkInsert(table, [{
          key: 'general',
          value,
          description: '',
          createdAt: now,
          updatedAt: now,
        }], {});
      } catch (e) {
        // ignore unique violations if already seeded
        if (!/duplicate key|unique constraint/i.test(e.message)) throw e;
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('settings', { key: 'general' });
  },
};
