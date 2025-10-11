// backend/src/utils/audit.js
let AuditLog;
try { ({ AuditLog } = require('../models')); } catch {}

async function writeAudit({ req, category = 'system', action, message = '' }) {
  try {
    if (!AuditLog?.create) return;
    await AuditLog.create({
      userId: req?.user?.id || null,
      branchId: req?.user?.branchId || null,
      category,
      action,
      message,
      ip: req?.ip,
    });
  } catch {}
}

module.exports = { writeAudit };
