// Safe helpers around model metadata so controllers can adapt to your schema

// Return true if the model actually defines an attribute (by logical name)
function hasAttr(model, logical) {
  return !!model?.rawAttributes?.[logical];
}

// Map a logical attribute name to its real DB column (falls back to the same)
function field(model, logical) {
  return model?.rawAttributes?.[logical]?.field || logical;
}

module.exports = { hasAttr, field };
