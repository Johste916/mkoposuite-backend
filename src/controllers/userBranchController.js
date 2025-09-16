// controllers/userBranchController.js
'use strict';

const { sequelize } = require('../models');

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/**
 * Body:
 * {
 *   branchId: 1,                     // integer
 *   userIds: ["uuid-1","uuid-2"]     // array of UUID strings
 * }
 *
 * Enforces: one active branch per user until unassigned.
 */
exports.assignBranch = async (req, res, next) => {
  try {
    const branchId = Number.parseInt(String(req.body?.branchId), 10);
    if (!Number.isFinite(branchId)) {
      return res.status(400).json({ error: 'branchId must be an integer' });
    }

    const raw = req.body?.userIds;
    const userIds = Array.isArray(raw) ? raw.filter(Boolean) : [];
    if (!userIds.length) return res.status(400).json({ error: 'userIds[] required' });

    const invalid = userIds.filter((id) => !isUuid(id));
    if (invalid.length) {
      return res.status(400).json({ error: 'All userIds must be UUID strings', details: { invalid } });
    }

    // Conflict check: user already assigned to another branch?
    const conflicts = await sequelize.query(`
      SELECT ub.user_id AS "userId", ub.branch_id AS "branchId",
             b.name AS "branchName"
      FROM public.user_branches ub
      JOIN public.branches b ON b.id = ub.branch_id
      WHERE ub.user_id = ANY($1::uuid[])
        AND ub.branch_id <> $2::int
    `, { bind: [userIds, branchId], type: sequelize.QueryTypes.SELECT });

    if (conflicts && conflicts.length) {
      return res.status(409).json({
        error: 'User(s) already assigned to another branch — unassign first.',
        conflicts: conflicts.map(c => ({
          userId: c.userId,
          currentBranchId: c.branchId,
          currentBranchName: c.branchName,
          unassignUrl: `/api/branches/${c.branchId}/staff/${c.userId}`,
        })),
      });
    }

    // Single bulk insert; safe binding
    await sequelize.query(
      `
      INSERT INTO public.user_branches_rt (user_id, branch_id, created_at)
      SELECT uid, $2::int, NOW()
      FROM unnest($1::uuid[]) AS t(uid)
      ON CONFLICT (user_id, branch_id) DO NOTHING
      `,
      { bind: [userIds, branchId] }
    );

    return res.json({ ok: true, assigned: userIds.length });
  } catch (e) {
    const code = e?.original?.code || e?.parent?.code;
    if (code === '22P02') {
      return res.status(400).json({ error: 'Invalid ID type' });
    }
    return next(e);
  }
};
