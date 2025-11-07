'use strict';

module.exports = function makeAutoAssign({ db }) {
  const { User, Role, Loan, Branch, sequelize } = db;
  const { Op } = require('sequelize');

  async function pickBranchId({ body, creator }) {
    if (body.branchId) return body.branchId;
    if (creator?.branchId) return creator.branchId;
    const b = await Branch.findOne({ attributes: ['id'], order: [['name', 'ASC']] });
    return b?.id || null;
  }

  async function listLoanOfficers(branchId) {
    const officers = await User.findAll({
      include: [{
        model: Role,
        as: 'Roles',
        through: { attributes: [] },
        where: { name: { [Op.iLike]: '%loan officer%' } }, // <-- robust match
        required: true,                                    // <-- must actually be officers
      }],
      where: { ...(branchId ? { branchId } : {}) },
    });

    // Keep backward compatibility with helper methods/fields
    return officers.filter(u =>
      (typeof u.isLoanOfficer === 'function' && u.isLoanOfficer()) ||
      String(u.role || '').toLowerCase() === 'loan officer' ||
      true // include all matched above
    );
  }

  async function pickLoanOfficerId({ branchId, explicitId }) {
    if (explicitId) {
      const u = await User.scope('withRoles').findByPk(explicitId);
      if (u && (u.isLoanOfficer?.() || true) && (!branchId || String(u.branchId) === String(branchId))) {
        return u.id;
      }
    }

    const officers = await listLoanOfficers(branchId);
    if (officers.length === 0) return null;

    const ids = officers.map(o => o.id);

    // Determine table/column metadata safely
    const tableObj = Loan.getTableName();
    const table = typeof tableObj === 'string' ? tableObj : tableObj.toString(); // handles schema
    const officerKey =
      Loan.rawAttributes?.loanOfficerId ? 'loanOfficerId' :
      Loan.rawAttributes?.officerId     ? 'officerId'     :
      null;
    const statusKey =
      Loan.rawAttributes?.status     ? 'status'     :
      Loan.rawAttributes?.loanStatus ? 'loanStatus' :
      null;

    let least = null;

    if (officerKey) {
      const whereStatus =
        statusKey ? `AND LOWER("${statusKey}") NOT IN ('closed','rejected','cancelled')` : '';

      const [rows] = await sequelize.query(
        `
          SELECT "${officerKey}" AS id, COUNT(*)::int AS c
          FROM ${table}
          WHERE "${officerKey}" IN (:ids) ${whereStatus}
          GROUP BY "${officerKey}"
        `,
        { replacements: { ids } }
      );

      const counts = Object.fromEntries(ids.map(id => [id, 0]));
      (rows || []).forEach(r => { counts[r.id] = Number(r.c || 0); });
      least = ids.sort((a, b) => counts[a] - counts[b])[0];
      if (least) return least;
    }

    // Fallback: round-robin via Branch.meta
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
