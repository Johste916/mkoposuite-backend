module.exports.requireEntitlement = (key) => (req, res, next) => {
  // If you store entitlements in req.user or can fetch by tenantId, check here.
  // For speed, you can cache in memory/redis or call the same function your
  // /tenants/me/entitlements controller uses.
  const mods = req.entitlements?.modules;
  if (mods && mods[key]) return next();
  return res.status(403).json({ error: `Feature '${key}' is not enabled for this tenant.` });
};
