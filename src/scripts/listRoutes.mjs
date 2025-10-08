import "dotenv/config";

const { default: app } = await import("../app.js");

// Build full path strings by walking nested routers
function getPath(layer) {
  if (layer.route && layer.route.path) return layer.route.path;
  if (layer.regexp && layer.regexp.fast_star) return "*";
  if (layer.regexp) {
    // convert something like /^\/api\/?(?=\/|$)/i to '/api'
    const match = layer.regexp.toString().match(/^\/\^\\(\/.*)\\\?\(\?=\\\/\|\$\)\/i$/);
    if (match) return match[1].replace(/\\\//g, "/");
  }
  return "";
}

function walk(stack, prefix = "") {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
      const handlers = (layer.route.stack || []).map((s) => s.handle?.name || "anonymous");
      out.push({
        methods,
        path: `${prefix}${layer.route.path}`.replace(/\/+/g, "/"),
        handlers,
      });
    } else if (layer.name === "router" && layer.handle?.stack) {
      const seg = getPath(layer);
      const nextPrefix = (prefix + seg).replace(/\/+/g, "/");
      out.push(...walk(layer.handle.stack, nextPrefix));
    }
  }
  return out;
}

const routes = walk(app._router?.stack || []).sort((a, b) => a.path.localeCompare(b.path));
console.log("🗺  Express routes (with mount prefixes):");
for (const r of routes) {
  console.log(`${r.methods.join(",").padEnd(10)} ${r.path}   -> ${r.handlers.join(" > ")}`);
}
console.log(`\nTotal routes: ${routes.length}`);
