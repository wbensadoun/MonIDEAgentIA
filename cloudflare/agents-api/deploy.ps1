# Deploy complet de l'API agents/skills/workflows sur Cloudflare.
# Preconditions (AUCHOIX):
#   A) npx wrangler login   (puis ce script marche tel quel)
#   B) Creer un API Token: https://dash.cloudflare.com/profile/api-tokens
#      (permissions: Account > Cloudflare Workers Scripts: Edit, Workers KV Storage: Edit,
#       Zone > Zone: Read; + "Account Resources: Your accounts")
#      puis le coller dans cloudflare/.env.deploy  (jamais committe, gitignore deja prevu):
#        CLOUDFLARE_API_TOKEN=xxxx
#        CLOUDFLARE_ACCOUNT_ID=xxxx   (optionnel, sinon wrangler le devine)
# Usage:  powershell -File cloudflare/agents-api/deploy.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Charger cloudflare/.env.deploy si present
$envFile = Join-Path $PSScriptRoot '..\.env.deploy'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2])
    }
  }
}
if (-not $env:CLOUDFLARE_API_TOKEN -and -not (Test-Path "$env:USERPROFILE\xdg.config\.wrangler\default\.toml") -and -not (Test-Path "$env:APPDATA\xdg.config\.wrangler\default\.toml")) {
  Write-Host "Pas de session wrangler ni CLOUDFLARE_API_TOKEN. Lance 'npx wrangler login' ou renseigne cloudflare/.env.deploy." -ForegroundColor Red
  exit 1
}

Write-Host "=== 1/4 Namespace KV AGENTS_KV ===" -ForegroundColor Cyan
$existing = Select-String -Path ./wrangler.toml -Pattern '^id = "([a-f0-9]{20,})"' -ErrorAction SilentlyContinue
if (-not $existing) {
  $kvJson = (npx --yes wrangler kv namespace create AGENTS_KV --json) -join ''
  $kv = $kvJson | ConvertFrom-Json
  $toml = Get-Content ./wrangler.toml -Raw
  $toml = $toml -replace 'id = "REPLACE_WITH_KV_ID"', ('id = "{0}"' -f $kv.id)
  Set-Content -Path ./wrangler.toml -Value $toml -NoNewline
  Write-Host "KV cree: $($kv.id)"
} else {
  Write-Host "KV deja configure dans wrangler.toml."
}

Write-Host "=== 2/4 Secret AGENTS_API_TOKEN ===" -ForegroundColor Cyan
$rootEnv = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) '.env'
$existingToken = Select-String -Path $rootEnv -Pattern '^CF_AGENTS_API_TOKEN=(.+)$' -ErrorAction SilentlyContinue
if ($existingToken) {
  $bearer = $existingToken.Matches[0].Groups[1].Value
  Write-Host "Bearer deja present dans le .env racine, reuse."
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $bearer = -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
$env:NODE_OPTIONS = $env:NODE_OPTIONS  # no-op, garde la ligne propre
$bearer | npx --yes wrangler secret put AGENTS_API_TOKEN

Write-Host "=== 3/4 Deploy du worker ===" -ForegroundColor Cyan
$deployOut = (npx --yes wrangler deploy 2>&1) -join "`n"
Write-Host $deployOut
$urlMatch = [regex]::Match($deployOut, 'https://wansia-agents-api\.[a-z0-9.-]+\.workers\.dev')
if (-not $urlMatch.Success) {
  Write-Host "URL du worker non detectee dans la sortie de deploy - renseigne CF_AGENTS_API_URL a la main." -ForegroundColor Yellow
  exit 1
}
$apiUrl = $urlMatch.Value

Write-Host "=== 4/4 Cablage du .env racine ===" -ForegroundColor Cyan
$envContent = Get-Content $rootEnv -Raw
$envContent = $envContent -replace '(?m)^CF_AGENTS_API_URL=.*$', "CF_AGENTS_API_URL=$apiUrl"
if ($envContent -match '(?m)^CF_AGENTS_API_TOKEN=.*$') {
  $envContent = $envContent -replace '(?m)^CF_AGENTS_API_TOKEN=.*$', "CF_AGENTS_API_TOKEN=$bearer"
} else {
  $envContent = $envContent.TrimEnd() + "`nCF_AGENTS_API_TOKEN=$bearer`n"
}
Set-Content -Path $rootEnv -Value $envContent -NoNewline -Encoding UTF8

Write-Host ""
Write-Host "DEPLOYE: $apiUrl" -ForegroundColor Green
Write-Host "Prochaine etape manuelle (dashboard): Zero Trust -> Access -> Applications ->"
Write-Host "  Self-hosted app sur $apiUrl, policy Allow + Service Auth avec le service token"
Write-Host "  deja present dans le .env (CF_ACCESS_CLIENT_ID)."
