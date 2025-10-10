'use strict';

module.exports = function makeAutoAssign({ db }) {
  const { User, Role, Loan, Branch, sequelize } = db;
  const { Op } = require('sequelize');

  async function pickBranchId({ body, creator }) {
    if (body.branchId) return body.branchId;
    if (creator?.branchId) return creator.branchId;

    // Fallback: first branch (or null if none)
    const b = await Branch.findOne({ attributes: ['id'], order: [['name','ASC']] });
    return b?.id || null;
  }

  async function listLoanOfficers(branchId) {
    const officers = await User.findAll({
      include: [{
        model: Role, as: 'Roles', through: { attributes: [] },
        where: { name: { [Op.iLike]: 'loan officer' } },
        required: false,
      }],
      where: { ...(branchId ? { branchId } : {}) },
    });

    return officers.filter(u => u.isLoanOfficer ? u.isLoanOfficer() : ((u.role||'').toLowerCase() === 'loan officer'));
  }

  async function pickLoanOfficerId({ branchId, explicitId }) {
    if (explicitId) {
      const u = await User.scope('withRoles').findByPk(explicitId);
      if (u && u.isLoanOfficer() && (!branchId || String(u.branchId) === String(branchId))) return u.id;
    }

    const officers = await listLoanOfficers(branchId);
    if (officers.length === 0) return null;

    // least loaded by non-closed loans
    const ids = officers.map(o => o.id);
    const [rows] = await sequelize.query(`
      select "loanOfficerId" as id, count(*) as c
      from "Loans"
      where "loanOfficerId" in (:ids) and lower(status) not in ('closed','rejected','cancelled')
      group by "loanOfficerId"
    `, { replacements: { ids } });

    const counts = Object.fromEntries(ids.map(id => [id, 0]));
    (rows || []).forEach(r => { counts[r.id] = Number(r.c || 0); });
    const least = ids.sort((a,b) => counts[a] - counts[b])[0];
    if (least) return least;

    // round-robin using branch.meta
    const b = branchId ? await Branch.findByPk(branchId) : null;
    const meta = (b?.meta || {});
    const i = Number(meta.roundRobinIndex || 0);
    const next = officers[i % officers.length].id;
    if (b) {
      meta.roundRobinIndex = (i + 1) % officers.length;
      await b.update({ meta });
    }
    return next;
  }

  return { pickBranchId, pickLoanOfficerId };
};
