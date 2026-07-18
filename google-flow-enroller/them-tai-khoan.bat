@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   THEM / DANG NHAP LAI TAI KHOAN GOOGLE FLOW
echo ================================================
echo.
echo Cua so Chrome se mo ra. Hay dang nhap tai khoan Google.
echo Dung dong Chrome cho den khi cong cu bao XONG.
echo.
set FLOW_PROXY_URL=http://plol8o2q:ePXR4b2y@14.225.59.44:12345
call npm run --silent enroll
echo.
pause
