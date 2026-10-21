@echo off
cd /d C:\Users\rigwe\Desktop\CRM
start "" powershell -NoProfile -Command "while(-not (Test-NetConnection localhost -Port 3001 -InformationLevel Quiet -WarningAction SilentlyContinue)){Start-Sleep 2}; Start-Process http://localhost:3001"
call npx next dev -p 3001
echo.
echo The CRM server stopped. Read any error above.
pause
