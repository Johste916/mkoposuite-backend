// src/lib/tenant.js
function readMode() {
  return (process.env.MULTI_TENANT_MODE || 'optional').toLowerCase();
}

function getDefaultTenantId() {
  return process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
}

/**
 * Resolve the tenant id for this request.
 * Sources (in order):
 *  - Header:  x-tenant-id
 *  - Auth user: req.user.tenantId / req.user.tenant.id / req.user.orgId / req.user.companyId
 *  - Fallback: DEFAULT_TENANT_ID   (when mode=off or optional)
 *
 * When mode=enforced and `requireForWrite=true`, throws if none found.
 */
function resolveTenantId(req, { requireForWrite = false } = {}) {
  const mode = readMode();

  const claim =
    req.headers?.['x-tenant-id'] ||
    req.user?.tenantId ||
    req.user?.tenant?.id ||
    req.user?.orgId ||
    req.user?.companyId ||
    null;

  if (mode === 'off') return getDefaultTenantId();
  if (mode === 'optional') return claim || getDefaultTenantId();

  // mode === 'enforced'
  if (!claim && requireForWrite) {
    const err = new Error('Tenant context required');
    err.status = 400; err.expose = true;
    throw err;
  }
  return claim || null;
}

module.exports = { resolveTenantId, readMode, getDefaultTenantId };
