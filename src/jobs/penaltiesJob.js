const { Loan, LoanSchedule, sequelize } = require("../models");
const { calcDailyPenalty } = require("../utils/penalties");

module.exports.runPenaltiesJob = async () => {
  const t = await sequelize.transaction();
  try {
    const today = new Date();
    const schedules = await LoanSchedule.findAll({
      where: { status: "overdue" }, transaction: t,
    });

    for (const s of schedules) {
      const remaining = Math.max(0,
        Number(s.total||0) - Number(s.paid||0)
      );
      if (remaining <= 0) continue;

      const penalty = calcDailyPenalty({ overdueAmount: remaining });
      const penalties = Number(s.penalties || 0) + penalty;
      const total = Number(s.principal||0) + Number(s.interest||0) + Number(s.fees||0) + penalties;

      await s.update({ penalties, total }, { transaction: t });
    }

    // Mark schedules overdue if dueDate < today and not paid
    const upcoming = await LoanSchedule.findAll({ transaction: t });
    for (const s of upcoming) {
      const due = new Date(s.dueDate);
      const paidEnough = Number(s.paid || 0) >= Number(s.total || 0) - 0.01;
      const status = paidEnough ? "paid" : (due < today ? "overdue" : "upcoming");
      if (status !== s.status) await s.update({ status }, { transaction: t });
    }

    await t.commit();
    return { ok: true };
  } catch (e) {
    await t.rollback();
    console.error("penaltiesJob error:", e);
    return { ok: false, error: e.message };
  }
};
