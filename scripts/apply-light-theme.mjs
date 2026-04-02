/**
 * Reemplaza utilidades Tailwind oscuras por equivalentes claros en .tsx bajo src/
 * (excluye src/app/api).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "src");

/** Orden: primero cadenas más largas / con variantes. */
const REPLACEMENTS = [
  ["hover:bg-slate-800/40", "hover:bg-slate-200/80"],
  ["hover:bg-slate-800", "hover:bg-slate-200"],
  ["hover:bg-slate-900/80", "hover:bg-slate-100"],
  ["focus:bg-slate-800", "focus:bg-slate-200"],
  ["bg-slate-950/50", "bg-slate-100/90"],
  ["bg-slate-900/80", "bg-slate-50/95"],
  ["bg-slate-800/40", "bg-slate-200/60"],
  ["bg-amber-950/20", "bg-amber-50"],
  ["bg-amber-950/25", "bg-amber-50/90"],
  ["bg-rose-950/40", "bg-rose-50"],
  ["bg-rose-950/60", "bg-rose-100"],
  ["bg-rose-950/30", "bg-rose-50/80"],
  ["border-rose-800/80", "border-rose-300"],
  ["border-rose-700/80", "border-rose-300"],
  ["border-amber-700/80", "border-amber-300"],
  ["bg-amber-950/30", "bg-amber-50"],
  ["bg-slate-950", "bg-white"],
  ["bg-slate-900", "bg-slate-50"],
  ["bg-slate-800", "bg-slate-200"],
  ["border-slate-800", "border-slate-200"],
  ["divide-slate-800", "divide-slate-200"],
  ["border-slate-700", "border-slate-300"],
  ["border-slate-600", "border-slate-300"],
  ["text-slate-100", "text-slate-900"],
  ["text-slate-200", "text-slate-800"],
  ["text-slate-300", "text-slate-700"],
  ["text-slate-400", "text-slate-600"],
  ["placeholder:text-slate-500", "placeholder:text-slate-400"],
  ["ring-slate-700", "ring-slate-300"],
  ["hover:text-sky-300", "hover:text-sky-700"],
  ["hover:text-white", "hover:text-slate-900"],
];

function collectTsx(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "api") continue;
      collectTsx(p, out);
    } else if (e.name.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

function applyFile(filePath) {
  let s = fs.readFileSync(filePath, "utf8");
  const orig = s;
  for (const [from, to] of REPLACEMENTS) {
    s = s.split(from).join(to);
  }
  if (s !== orig) {
    fs.writeFileSync(filePath, s, "utf8");
    return true;
  }
  return false;
}

const files = collectTsx(root);
let n = 0;
for (const f of files) {
  if (applyFile(f)) {
    n++;
    console.log("updated", path.relative(root, f));
  }
}
console.log(`Done. ${n} files changed.`);
