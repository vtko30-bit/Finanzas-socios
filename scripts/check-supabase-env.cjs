#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function readDotEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const text = fs.readFileSync(envPath, "utf8");
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function getProjectRef(url) {
  if (!url) return "";
  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match ? match[1] : "";
}

const dotEnvLocal = readDotEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || dotEnvLocal.NEXT_PUBLIC_SUPABASE_URL || "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || dotEnvLocal.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || dotEnvLocal.SUPABASE_SERVICE_ROLE_KEY || "";

const ref = getProjectRef(url);
const anonMasked = anon ? `${anon.slice(0, 8)}...` : "(vacio)";
const serviceMasked = serviceRole ? `${serviceRole.slice(0, 8)}...` : "(vacio)";

console.log("Entorno Supabase actual");
console.log("-----------------------");
console.log(`URL: ${url || "(vacia)"}`);
console.log(`Project ref: ${ref || "(no detectable)"}`);
console.log(`Anon key: ${anonMasked}`);
console.log(`Service role key: ${serviceMasked}`);

if (!url) {
  console.log("\nFalta NEXT_PUBLIC_SUPABASE_URL en .env.local");
  process.exit(1);
}

console.log("\nTip: usa un project ref distinto para DEV y PROD.");
