@echo off
rem Fast mode: runs the CRM as a production build. Pages load about 6x quicker than with start-crm.bat
rem and there are no compile pauses. It rebuilds (about a minute) only when the code has changed.
rem Close the normal CRM window first: both use port 3001 and the same .next folder.
rem
rem Fast mode differences: admins need two-step verification turned on (otherwise they get a Sales-only
rem view), and emails (invitations, password resets, reminders) are not sent because no email provider is
rem set. Use start-crm.bat for those. Optional: set CRM_PORT to use another port, CRM_NO_BROWSER=1 to not
rem open the browser.
setlocal
cd /d "%~dp0"
if "%CRM_PORT%"=="" set CRM_PORT=3001

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %CRM_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo.
  echo Port %CRM_PORT% is already in use. Close the other CRM window first, then run this again.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\needs-build.ps1"
if errorlevel 1 (
  echo Building the CRM for fast mode. This takes about a minute...
  call npx next build
  if errorlevel 1 (
    echo.
    echo The build failed. Read the error above. start-crm.bat still works.
    pause
    exit /b 1
  )
  echo built> ".next\fast-build-done"
)

rem Local use: trust localhost, and skip the checks that only matter for a public deployment.
set AUTH_TRUST_HOST=true
set NEXTAUTH_URL=http://localhost:%CRM_PORT%
set SKIP_ENV_VALIDATION=1

if "%CRM_NO_BROWSER%"=="" start "" powershell -NoProfile -Command "while(-not (Test-NetConnection localhost -Port %CRM_PORT% -InformationLevel Quiet -WarningAction SilentlyContinue)){Start-Sleep 1}; Start-Process http://localhost:%CRM_PORT%"
echo.
echo CRM fast mode on http://localhost:%CRM_PORT%  - close this window to stop it.
call npx next start -p %CRM_PORT%
echo.
echo The CRM server stopped. Read any error above.
pause
