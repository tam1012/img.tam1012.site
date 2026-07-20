@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo   REAUTH FLOW TU PROFILE CHROME RIENG
echo ================================================
echo.
echo Can da login lan dau bang mo-profile-lan-dau.bat.
echo Cong cu se mo profile, bat session, day len VPS.
echo KHONG can dang nhap lai neu session profile con song.
echo.
echo  1^) flow-01  vantam1012@gmail.com
echo  2^) flow-02  babyinmyl0v3@gmail.com
echo  3^) flow-03  lovanmuon87@gmail.com
echo  4^) flow-04  mrvantam@gmail.com
echo  5^) flow-05  selenabk@gmail.com
echo  0^) Thoat
echo.
set /p CHOICE=Chon so (1-5):

if "%CHOICE%"=="1" set "ALIAS=flow-01"
if "%CHOICE%"=="2" set "ALIAS=flow-02"
if "%CHOICE%"=="3" set "ALIAS=flow-03"
if "%CHOICE%"=="4" set "ALIAS=flow-04"
if "%CHOICE%"=="5" set "ALIAS=flow-05"
if "%CHOICE%"=="0" exit /b 0
if not defined ALIAS (
  echo Lua chon khong hop le.
  pause
  exit /b 1
)

echo.
echo Dang reauth %ALIAS% ...
echo TAT het Chrome dang mo profile do truoc khi tiep tuc.
echo.
call npm run --silent reauth:profile -- --alias %ALIAS%
echo.
pause
endlocal
