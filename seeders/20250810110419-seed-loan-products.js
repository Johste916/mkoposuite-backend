'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.bulkInsert('loan_products', [
      {
        name: 'Micro Loan',
        code: 'MICRO',
        status: 'active',
        interest_method: 'flat',
        interest_rate: 3.5,
        min_principal: 50000,
        max_principal: 500000,
        min_term_months: 1,
        max_term_months: 12,
        penalty_rate: 1.0,
        fees: JSON.stringify([{ name: 'Processing', type: 'percent', value: 1.5 }]),
        eligibility: JSON.stringify({ minAge: 18, residency: 'TZ' }),
        created_at: now, updated_at: now
      },
      {
        name: 'SME Working Capital',
        code: 'SME-WC',
        status: 'active',
        interest_method: 'reducing',
        interest_rate: 2.4,
        min_principal: 500000,
        max_principal: 20000000,
        min_term_months: 3,
        max_term_months: 24,
        penalty_rate: 1.2,
        fees: JSON.stringify([{ name: 'Arrangement', type: 'fixed', value: 50000 }]),
        eligibility: JSON.stringify({ minBusinessAgeMonths: 6 }),
        created_at: now, updated_at: now
      }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('loan_products', null, {});
  }
};
