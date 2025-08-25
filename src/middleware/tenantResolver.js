module.exports = async function tenantResolver(req, _res, next) {
  // Derive tenant from auth token, subdomain, or header
  // For now: header "x-tenant-id" fallback to req.user.tenantId
  const t = req.headers['x-tenant-id'] || req.user?.tenantId;
  if (!t) return next(Object.assign(new Error('Tenant not resolved'), { status: 401, expose: true }));
  req.tenantId = t;
  next();
};
