// sequelize-auto-alias.js
const { Model } = require('sequelize');

function applyAlias(sourceModel, inc) {
  // If user already specified association/as, leave it alone
  if (!inc) return inc;
  if (inc.association) return inc;

  // If include is by model and 'as' is missing, try to infer from associations
  if (inc.model && !inc.as) {
    const assocs = Object.values(sourceModel.associations || {});
    const matches = assocs.filter(a => {
      // match by target reference or target name
      return a.target === inc.model || a.target?.name === inc.model?.name;
    });

    // If there is exactly one association to that model, use its alias
    if (matches.length === 1) {
      inc.as = matches[0].as;
    }
  }

  // Recurse for nested includes using the current inc.model as the new source
  if (Array.isArray(inc.include) && inc.include.length) {
    const nextSource = inc.model || sourceModel;
    inc.include = inc.include.map(child => applyAlias(nextSource, child));
  }
  return inc;
}

function autoAliasOptions(sourceModel, options = {}) {
  if (!options.include) return options;
  options.include = options.include.map(inc => applyAlias(sourceModel, inc));
  return options;
}

const patch = (methodName) => {
  const original = Model[methodName];
  Model[methodName] = function patched(options = {}, ...rest) {
    options = autoAliasOptions(this, options);
    return original.call(this, options, ...rest);
  };
};

// Patch the most common methods that accept `include`
['findAll', 'findOne', 'findAndCountAll', 'count', 'findByPk'].forEach(patch);

console.log('[sequelize-auto-alias] enabled');
