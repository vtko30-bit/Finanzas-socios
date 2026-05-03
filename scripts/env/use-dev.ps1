$ErrorActionPreference = "Stop"

if (!(Test-Path ".\.env.local.dev")) {
  Write-Error "No existe .env.local.dev. Crea el archivo desde config/env/.env.local.dev.example"
}

Copy-Item ".\.env.local.dev" ".\.env.local" -Force
Write-Host "OK: .env.local ahora apunta a DEV"
node .\scripts\check-supabase-env.cjs
