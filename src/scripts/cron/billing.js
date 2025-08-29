// scripts/cron/billing.js
const axios = require('axios');
(async () => {
  try {
    await axios.post(`${process.env.INTERNAL_BASE_URL || 'http://localhost:10000'}/api/billing/cron/daily`, {}, {
      headers: { 'x-admin-key': process.env.ADMIN_TASK_KEY || '' }
    });
    console.log('Billing cron ok');
  } catch (e) {
    console.error('Billing cron failed', e.message);
    process.exit(1);
  }
})();
