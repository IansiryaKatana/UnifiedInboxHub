# Sets VAPID keys on your linked Supabase project.
# Prerequisites: supabase login && supabase link
# Reads keys from .env.vapid (gitignored).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.vapid"
if (-not (Test-Path $envFile)) {
  Write-Error "Missing .env.vapid — run: npx web-push generate-vapid-keys and save keys there."
}

Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    Set-Item -Path "env:$($Matches[1].Trim())" -Value $Matches[2].Trim().Trim('"')
  }
}

if (-not $env:VAPID_PUBLIC_KEY -or -not $env:VAPID_PRIVATE_KEY) {
  Write-Error ".env.vapid must define VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY"
}

$subject = if ($env:VAPID_SUBJECT) { $env:VAPID_SUBJECT } else { "mailto:support@unifiedinboxhub.com" }

supabase secrets set `
  "VAPID_PUBLIC_KEY=$($env:VAPID_PUBLIC_KEY)" `
  "VAPID_PRIVATE_KEY=$($env:VAPID_PRIVATE_KEY)" `
  "VAPID_SUBJECT=$subject"

Write-Host "VAPID secrets set. Redeploy imap-sync and gmail-sync if already live."
