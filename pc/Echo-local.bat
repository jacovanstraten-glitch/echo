@echo off
REM Echo - runs locally from this OneDrive folder. No website and no sign-in on the PC.
REM   1. starts a small local server (Python) that shows the app from the App folder
REM      and reads and writes this Echo folder directly,
REM   2. opens Echo in its own window,
REM   3. starts the transcriber, which turns recordings into text on this PC.
setlocal EnableExtensions
title Echo
set "ECHODIR=%~dp0"
if "%ECHODIR:~-1%"=="\" set "ECHODIR=%ECHODIR:~0,-1%"
set "APPDIR=%ECHODIR%\App"
set "URL=http://127.0.0.1:47824/"
set "HOMEDIR=%LOCALAPPDATA%\Echo"
set "VPY=%HOMEDIR%\venv\Scripts\python.exe"
if /i "%~1"=="transcriber" goto transcriber

if not exist "%APPDIR%\index.html" (
  echo The Echo app files are missing in "%APPDIR%".
  pause
  exit /b 1
)

REM 1. Python (needed for the local server and the transcriber).
call :findpython
if not defined PYBASE (
  echo Python is needed to run Echo on this PC and is not installed yet.
  echo Installing Python 3.12 from Microsoft's package manager...
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  call :findpython
)
if not defined PYBASE (
  echo.
  echo Python could not be installed automatically.
  echo Install Python 3.12 from https://www.python.org/downloads/ and start Echo.bat again.
  pause
  exit /b 1
)

REM 2. Local server, without a window. Skipped when it is already running.
curl.exe -fs --max-time 2 "%URL%health" >nul 2>&1 && goto open
start "" %PYWBASE% "%APPDIR%\pc\echo_server.py"
for /l %%i in (1,1,20) do (
  curl.exe -fs --max-time 1 "%URL%health" >nul 2>&1 && goto open
  >nul ping -n 2 127.0.0.1
)
echo The Echo server did not start. Run this to see why:
echo   %PYBASE% "%APPDIR%\pc\echo_server.py"
pause
exit /b 1

:open
REM 3. Echo in its own window, like a desktop app.
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --app="%URL%" --window-size=1100,900
) else (
  start "" msedge --app="%URL%" --window-size=1100,900
)

REM 4. Transcriber, in its own window (minimised once it is installed).
if exist "%VPY%" if exist "%HOMEDIR%\installed.txt" if exist "%HOMEDIR%\config.json" (
  start "Echo transcriber" /min cmd /c ""%~f0" transcriber"
  exit /b
)
start "Echo transcriber" cmd /c ""%~f0" transcriber"
exit /b

:transcriber
title Echo transcriber
if not exist "%HOMEDIR%" mkdir "%HOMEDIR%"
if exist "%VPY%" if exist "%HOMEDIR%\installed.txt" goto run
call :findpython
%PYBASE% "%APPDIR%\pc\echo_transcriber.py" --install
if errorlevel 1 (
  pause
  exit /b 1
)
:run
"%VPY%" "%APPDIR%\pc\echo_transcriber.py" --folder "%ECHODIR%"
exit /b

:findpython
set "PYBASE="
set "PYWBASE="
for %%V in (3.12 3.11 3.13 3.10) do if not defined PYBASE (py -%%V -c "import sys" >nul 2>&1 && set "PYBASE=py -%%V" && set "PYWBASE=pyw -%%V")
if not defined PYBASE if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
  set "PYBASE="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
  set "PYWBASE="%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe""
)
if not defined PYBASE (python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>&1 && set "PYBASE=python" && set "PYWBASE=pythonw")
exit /b
