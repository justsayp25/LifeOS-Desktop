@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4100"
node server.mjs
pause
