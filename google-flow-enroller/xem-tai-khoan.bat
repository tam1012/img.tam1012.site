@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   TRANG THAI TAI KHOAN GOOGLE FLOW
echo ================================================
echo.
call npm run --silent status
echo.
pause
