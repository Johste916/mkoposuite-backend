// backend/src/reporting/reportRegistry.js
const { Op } = require('sequelize');
const { User, Loan } = require('../models');

function toCsv(rows) {
  if (!rows?.length) return Buffer.from('empty\n');
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')].concat(rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(',')));
  return Buffer.from(lines.join('\n'));
}

/** Each generator returns: { filename, mime, buffer } */
const registry = {
  // Example: Daily loans summary
  'loans.dailySummary': async (opts = {}) => {
    const since = new Date(); since.setHours(0,0,0,0);
    const loans = await Loan.findAll({ where: { createdAt: { [Op.gte]: since } }, limit: 1000 });
    const rows = loans.map(l => ({ id: l.id, amount: l.amount, status: l.status, createdAt: l.createdAt }));
    return { filename: 'loans_daily.csv', mime: 'text/csv', buffer: toCsv(rows) };
  },

  // Example: Users list (for testing)
  'users.directory': async () => {
    const list = await User.findAll({ limit: 1000 });
    const rows = list.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
    return { filename: 'users.csv', mime: 'text/csv', buffer: toCsv(rows) };
  },
};

function listReportDefs() {
  // Could fetch descriptions from DB later
  return [
    { key: 'loans.dailySummary',  name: 'Loans — Daily Summary',  formats: ['csv'] },
    { key: 'users.directory',     name: 'Users Directory',        formats: ['csv'] },
  ];
}

async function runReport(reportKey, options) {
  const gen = registry[reportKey];
  if (!gen) throw new Error(`Unknown reportKey "${reportKey}"`);
  return gen(options || {});
}

module.exports = { runReport, listReportDefs };
