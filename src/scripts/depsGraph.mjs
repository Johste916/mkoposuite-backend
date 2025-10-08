import madge from "madge";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const entry = path.resolve(__dirname, ".."); // -> backend/src

try {
  const res = await madge(entry, {
    fileExtensions: ["js", "mjs", "cjs"],
    detectiveOptions: { es6: { mixedImports: true } }
  });

  const graph = res.obj();
  console.log("🔗 Module dependency graph (JSON):");
  console.log(JSON.stringify(graph, null, 2));

  const circular = await res.circular();
  if (circular.length) {
    console.log("\n⚠ Circular dependencies detected:");
    circular.forEach((cycle, i) => console.log(`${i + 1}. ${cycle.join(" -> ")}`));
    process.exitCode = 1;
  } else {
    console.log("\n✅ No circular dependencies");
  }
} catch (err) {
  console.error("❌ Dependency graph failed:", err.message);
  process.exit(1);
}
