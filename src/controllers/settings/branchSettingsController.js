// backend/src/controllers/settings/branchSettingsController.js
const db = require('../../models');
const { Op, fn, col, where, literal } = db.Sequelize || {};
const Branch = db.Branch;

/** Helper: normalize code and trim strings */
function sanitizeBranchPayload(body = {}) {
  const out = {};
  if ('name' in body) out.name = String(body.name || '').trim();
  if ('code' in body) out.code = String(body.code || '').trim();
  if ('location' in body) out.location = String(body.location || '').trim();
  if ('manager' in body) out.manager = String(body.manager || '').trim();
  if ('phone' in body) out.phone = String(body.phone || '').trim();
  if ('email' in body) out.email = String(body.email || '').trim();
  if ('isActive' in body) out.isActive = !!body.isActive;
  return out;
}

/** Helper: basic validations */
function validateBranchPayload({ name, code, email }) {
  const errors = [];
  if (!name || name.length < 2) errors.push('Branch name must be at least 2 characters.');
  if (!code || code.length < 2) errors.push('Branch code must be at least 2 characters.');
  if (email) {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!ok) errors.push('Email is not valid.');
  }
  return errors;
}

/**
 * GET /api/settings/branch-settings
 * Query params:
 *  - q: search in name/code/location/manager
 *  - page (1-based), pageSize (default 20, max 200)
 *  - includeInactive=true|false
 */
exports.getBranchSettings = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const rawSize = parseInt(req.query.pageSize, 10) || 20;
    const pageSize = Math.min(Math.max(rawSize, 1), 200);
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';

    const whereClause = {};
    if (!includeInactive) whereClause.isActive = true;

    if (q && Branch.rawAttributes) {
      // portable LIKE across dialects
      const like = db.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
      const term = `%${q}%`;
      whereClause[Op.or] = [
        { name: { [like]: term } },
        { code: { [like]: term } },
        { location: { [like]: term } },
        { manager: { [like]: term } },
      ];
    }

    const { rows, count } = await Branch.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });

    res.status(200).json({
      items: rows,
      total: count,
      page,
      pageSize,
      hasMore: page * pageSize < count,
    });
  } catch (error) {
    console.error('❌ Error fetching branches:', error);
    res.status(500).json({ message: 'Failed to fetch branches' });
  }
};

/**
 * GET /api/settings/branch-settings/:id
 */
exports.getBranchById = async (req, res) => {
  try {
    const { id } = req.params;
    const branch = await Branch.findByPk(id);
    if (!branch) return res.status(404).json({ message: 'Branch not found' });
    res.status(200).json(branch);
  } catch (error) {
    console.error('❌ Error fetching branch:', error);
    res.status(500).json({ message: 'Failed to fetch branch' });
  }
};

/**
 * POST /api/settings/branch-settings
 * body: { name, code, location?, manager?, phone?, email?, isActive? }
 */
exports.createBranch = async (req, res) => {
  try {
    const payload = sanitizeBranchPayload(req.body || {});
    const errors = validateBranchPayload(payload);
    if (errors.length) return res.status(400).json({ message: 'Validation failed', errors });

    // Enforce unique branch code (case-insensitive across dialects)
    const dialect = db.sequelize.getDialect();
    let codeWhere;
    if (dialect === 'postgres') {
      codeWhere = where(fn('LOWER', col('code')), String(payload.code).toLowerCase());
    } else {
      // Fallback: normalize to lower in JS and compare with LIKE
      codeWhere = db.sequelize.where(
        fn('LOWER', col('code')),
        String(payload.code).toLowerCase()
      );
    }
    const existingCode = await Branch.findOne({ where: codeWhere });
    if (existingCode) {
      return res.status(409).json({ message: 'Branch code already exists. Use a unique code.' });
    }

    const created = await Branch.create({
      ...payload,
      isActive: payload.isActive !== undefined ? payload.isActive : true,
      createdBy: req?.user?.id || null,
      updatedBy: req?.user?.id || null,
    });

    res.status(201).json({ message: 'Branch created successfully', branch: created });
  } catch (error) {
    console.error('❌ Error creating branch:', error);
    res.status(500).json({ message: 'Failed to create branch' });
  }
};

/**
 * PUT /api/settings/branch-settings/:id
 * body: partial update of allowed fields
 */
exports.updateBranchSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const branch = await Branch.findByPk(id);
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    const incoming = sanitizeBranchPayload(req.body || {});
    // If code changing, enforce uniqueness
    if (incoming.code && incoming.code !== branch.code) {
      const dialect = db.sequelize.getDialect();
      let codeWhere;
      if (dialect === 'postgres') {
        codeWhere = where(fn('LOWER', col('code')), String(incoming.code).toLowerCase());
      } else {
        codeWhere = db.sequelize.where(
          fn('LOWER', col('code')),
          String(incoming.code).toLowerCase()
        );
      }
      const conflict = await Branch.findOne({ where: codeWhere });
      if (conflict) {
        return res.status(409).json({ message: 'Branch code already exists. Use a unique code.' });
      }
    }

    // Validate merged payload
    const merged = {
      name: incoming.name ?? branch.name,
      code: incoming.code ?? branch.code,
      location: incoming.location ?? branch.location,
      manager: incoming.manager ?? branch.manager,
      phone: incoming.phone ?? branch.phone,
      email: incoming.email ?? branch.email,
      isActive: incoming.isActive ?? branch.isActive,
    };
    const errors = validateBranchPayload(merged);
    if (errors.length) return res.status(400).json({ message: 'Validation failed', errors });

    await branch.update({ ...incoming, updatedBy: req?.user?.id || branch.updatedBy });
    res.status(200).json({ message: 'Branch updated successfully', branch });
  } catch (error) {
    console.error('❌ Error updating branch:', error);
    res.status(500).json({ message: 'Failed to update branch' });
  }
};

/**
 * DELETE /api/settings/branch-settings/:id
 * If you prefer soft-delete, flip isActive=false instead of destroy.
 * Here we prevent deleting if related records exist (optional if associations present).
 */
exports.deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const branch = await Branch.findByPk(id);
    if (!branch) return res.status(404).json({ message: 'Branch not found' });

    // Optional safety: block delete if associations exist
    // NOTE: uncomment and adjust if you have associations wired.
    // const borrowersCount = await db.Borrower.count({ where: { branchId: id } });
    // const loansCount = await db.Loan.count({ where: { branchId: id } });
    // if (borrowersCount || loansCount) {
    //   return res.status(400).json({
    //     message: 'Branch has related records (borrowers/loans). Deactivate instead of deleting.'
    //   });
    // }

    // Soft-delete approach (recommended):
    await branch.update({ isActive: false, updatedBy: req?.user?.id || null });
    // Hard delete (if you really want):
    // await branch.destroy();

    res.status(200).json({ message: 'Branch deactivated successfully' });
  } catch (error) {
    console.error('❌ Error deleting branch:', error);
    res.status(500).json({ message: 'Failed to delete branch' });
  }
};
