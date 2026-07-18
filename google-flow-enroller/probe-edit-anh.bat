@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo   PROBE: BAT REQUEST EDIT ANH GOOGLE FLOW
echo ================================================
echo.
echo Muc dich: bat shape request EDIT (imageInputs / upload)
echo de sau nay lam edit Nano Banana Pro qua bridge.
echo.
echo Buoc lam:
echo   1. Cua so Chrome se mo trang Flow
echo   2. Dang nhap neu can
echo   3. Chon Nano Banana Pro neu co
echo   4. UPLOAD / chon 1 anh + go prompt chinh sua + Generate
echo   5. KHONG chi tao anh tu text
echo.
echo Cong cu tu dong dong Chrome khi bat duoc.
echo File ket qua (da che secret):
echo   state\flow-image-edit-request-meta.json
echo.
echo Timeout mac dinh 15 phut.
echo.
call npm run --silent probe:image-edit-meta
echo.
pause
