$ErrorActionPreference = "Stop"

if (!(Test-Path ".\.env.local.prod")) {
  Write-Error "No existe .env.local.prod. Crea el archivo desde config/env/.env.local.prod.example"
}

Copy-Item ".\.env.local.prod" ".\.env.local" -Force
Write-Host "OK: .env.local ahora apunta a PROD"
node .\scripts\check-supabase-env.cjs
