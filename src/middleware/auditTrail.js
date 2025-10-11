'use strict';
const { logAudit } = require('../utils/audit');

module.exports = function auditTrail() {
  return (req, _res, next) => {
    req.audit = async (payload = {}) => {
      try { await logAudit({ req, ...payload }); } catch {}
    };
    next();
  };
};
