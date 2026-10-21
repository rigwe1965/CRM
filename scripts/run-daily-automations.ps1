# Triggers the CRM's daily run: task and instalment reminder emails plus the automations (quiet leads,
# customer payment reminders). Meant for a Windows scheduled task on the computer that runs the CRM.
# The CRM must be running (start-crm.bat or start-crm-fast.bat). It is safe to run twice: every reminder
# is sent once.
#
#   -DryRun  only checks that CRON_SECRET can be read and prints what it would call. Changes nothing.
#
# CRON_SECRET is read from .env each time, so the secret is never stored inside the scheduled task.
param([switch]$DryRun)

$root = Split-Path $PSScriptRoot -Parent
$log = Join-Path $env:LOCALAPPDATA "CRM\daily-run.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($msg) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg) }

$line = Select-String -Path (Join-Path $root ".env") -Pattern '^\s*CRON_SECRET\s*=\s*"?([^"\r\n]+)"?' | Select-Object -First 1
$secret = if ($line) { $line.Matches[0].Groups[1].Value } else { "" }
if ($secret.Length -lt 16) { Log "FAILED: CRON_SECRET missing or shorter than 16 characters in .env"; Write-Error "CRON_SECRET missing or too short"; exit 1 }

$port = if ($env:CRM_PORT) { $env:CRM_PORT } else { "3001" }
$url = "http://localhost:$port/api/cron/task-reminders"
if ($DryRun) { "Ready: would call $url with a $($secret.Length)-character secret. Nothing was sent."; exit 0 }

try {
  $res = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 120
  Log "OK ($($res.StatusCode)): $($res.Content)"
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "no response (is the CRM running?)" }
  Log "FAILED: $status - $($_.Exception.Message)"
  exit 1
}
