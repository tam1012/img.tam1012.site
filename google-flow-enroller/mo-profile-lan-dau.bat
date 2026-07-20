@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

set "PROFILES_ROOT=D:\flow-profiles"
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Khong tim thay chrome.exe
  pause
  exit /b 1
)

echo ================================================
echo   MO PROFILE CHROME LAN DAU - LOGIN GOOGLE FLOW
echo ================================================
echo.
echo Moi account co 1 folder rieng o %PROFILES_ROOT%
echo Lan dau: mo profile -^> dang nhap Google + vao Flow 1 lan.
echo Sau do:  chay reauth-tu-profile.bat khi VPS bao reauth.
echo.
echo  1^) flow-01  vantam1012@gmail.com
echo  2^) flow-02  babyinmyl0v3@gmail.com
echo  3^) flow-03  lovanmuon87@gmail.com
echo  4^) flow-04  mrvantam@gmail.com
echo  5^) flow-05  selenabk@gmail.com
echo  0^) Thoat
echo.
set /p CHOICE=Chon so (1-5):

if "%CHOICE%"=="1" set "FOLDER=flow-01-vantam1012" & set "EMAIL=vantam1012@gmail.com"
if "%CHOICE%"=="2" set "FOLDER=flow-02-babyinmyl0v3" & set "EMAIL=babyinmyl0v3@gmail.com"
if "%CHOICE%"=="3" set "FOLDER=flow-03-lovanmuon87" & set "EMAIL=lovanmuon87@gmail.com"
if "%CHOICE%"=="4" set "FOLDER=flow-04-mrvantam" & set "EMAIL=mrvantam@gmail.com"
if "%CHOICE%"=="5" set "FOLDER=flow-05-selenabk" & set "EMAIL=selenabk@gmail.com"
if "%CHOICE%"=="0" exit /b 0
if not defined FOLDER (
  echo Lua chon khong hop le.
  pause
  exit /b 1
)

set "UD=%PROFILES_ROOT%\%FOLDER%"
if not exist "%UD%" mkdir "%UD%"

echo.
echo Mo Chrome:
echo   Email can login: %EMAIL%
echo   user-data-dir:   %UD%
echo.
echo Huong dan:
echo   1. Dang nhap DUNG email %EMAIL%
echo   2. Vao https://labs.google/fx/tools/flow  - dam bao vao duoc
echo   3. Dong Chrome sau khi xong
echo   4. Khi can reauth: chay reauth-tu-profile.bat chon cung so
echo.

start "" "%CHROME%" --user-data-dir="%UD%" --no-first-run --no-default-browser-check "https://labs.google/fx/tools/flow"
echo Da mo Chrome. Cua so nay co the dong.
pause
endlocal
