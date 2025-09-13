'use strict';

let models;
try { models = require('../models'); } catch { try { models = require('../../models'); } catch {} }

const calcLib = (() => {
  try { return require('../utils/penalties'); } catch { try { return require('../../utils/penalties'); } catch { return {}; } }
})();
const calcDailyPenalty =
  typeof calcLib.calcDailyPenalty === 'function'
    ? calcLib.calcDailyPenalty
    : ({ overdueAmount }) => Number(overdueAmount || 0) * 0.001; // default 0.1%/day

const sequelize = models?.sequelize || null;

// Pick whichever schedule model exists
const Schedule =
  models?.LoanSchedule ||
  models?.LoanSchedules ||
  models?.LoanRepaymentSchedule ||
  models?.RepaymentSchedule ||
  null;

// soft optional
const Loan = models?.Loan || models?.Loans || null;

function n(x, d = 0) { const v = Number(x); return Number.isFinite(v) ? v : d; }
function dueDate(s) { return new Date(s.dueDate || s.due_date || s.due_on || s.due || 0); }
function statusOf(s) { return String(s.status || '').toLowerCase(); }

module.exports.runPenaltiesJob = async () => {
  if (!sequelize) return { ok: false, error: 'sequelize not available' };
  if (!Schedule || typeof Schedule.findAll !== 'function') {
    console.warn('[penaltiesJob] LoanSchedule-like model not found.');
    return { ok: false, error: 'LoanSchedule model not found' };
  }

  const t = await sequelize.transaction();
  try {
    const today = new Date();

    // 1) Apply daily penalties to overdue items with outstanding balance
    const overdue = await Schedule.findAll({ where: { status: 'overdue' }, transaction: t });
    for (const s of overdue) {
      const principal = n(s.principal || s.principal_amount);
      const interest  = n(s.interest || s.interest_amount);
      const fees      = n(s.fees || s.fee || s.charges);
      const penalties = n(s.penalties);
      const total     = n(s.total) || (principal + interest + fees + penalties);
      const paid      = n(s.paid || s.amount_paid);

      const remaining = Math.max(0, total - paid);
      if (remaining <= 0.000001) continue;

      const p = n(calcDailyPenalty({ overdueAmount: remaining }));
      const newPenalties = penalties + p;
      const newTotal = principal + interest + fees + newPenalties;

      await s.update({ penalties: newPenalties, total: newTotal }, { transaction: t });
    }

    // 2) Normalize statuses (paid / overdue / upcoming)
    const all = await Schedule.findAll({ transaction: t });
    for (const s of all) {
      const principal = n(s.principal || s.principal_amount);
      const interest  = n(s.interest || s.interest_amount);
      const fees      = n(s.fees || s.fee || s.charges);
      const penalties = n(s.penalties);
      const total     = n(s.total) || (principal + interest + fees + penalties);
      const paid      = n(s.paid || s.amount_paid);

      const due = dueDate(s);
      const paidEnough = paid >= total - 0.01;
      const nextStatus = paidEnough ? 'paid' : (due < today ? 'overdue' : 'upcoming');

      if (nextStatus !== statusOf(s) || total !== n(s.total)) {
        await s.update({ status: nextStatus, total }, { transaction: t });
      }
    }

    await t.commit();
    return { ok: true };
  } catch (e) {
    await t.rollback();
    console.error('penaltiesJob error:', e);
    return { ok: false, error: e.message };
  }
};
