@echo off
REM Echo - opens the app in its own window and starts the transcriber next to it.
REM The transcriber turns recordings in OneDrive\Echo\Recordings into text on this PC.
REM The first start installs it in %LOCALAPPDATA%\Echo (5 to 15 minutes, once).
setlocal EnableExtensions
title Echo
set "URL=https://jacovanstraten-glitch.github.io/echo/"
set "HOMEDIR=%LOCALAPPDATA%\Echo"
set "VPY=%HOMEDIR%\venv\Scripts\python.exe"
if not exist "%HOMEDIR%" mkdir "%HOMEDIR%"

REM 1. Get the latest transcriber (keeps the current copy when offline).
curl.exe -fsSL --max-time 30 -o "%HOMEDIR%\echo_transcriber.new" "%URL%pc/echo_transcriber.py" >nul 2>&1 && move /y "%HOMEDIR%\echo_transcriber.new" "%HOMEDIR%\echo_transcriber.py" >nul
if not exist "%HOMEDIR%\echo_transcriber.py" (
  echo Could not download the Echo transcriber. Check your internet connection and try again.
  pause
  goto openapp
)

REM 2. First start: install Python packages and the Whisper model.
if exist "%VPY%" if exist "%HOMEDIR%\installed.txt" goto installed
call :findpython
if not defined PYBASE (
  echo Python is needed for the transcriber and is not installed yet.
  echo Installing Python 3.12 from Microsoft's package manager...
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  call :findpython
)
if not defined PYBASE (
  echo.
  echo Python could not be installed automatically.
  echo Install Python 3.12 from https://www.python.org/downloads/ and start Echo.bat again.
  pause
  goto openapp
)
%PYBASE% "%HOMEDIR%\echo_transcriber.py" --install
if errorlevel 1 (
  pause
  goto openapp
)
:installed

REM 3. Ask once for the speaker detection token, then start the transcriber minimised.
findstr /c:"asked_token" "%HOMEDIR%\config.json" >nul 2>&1 || "%VPY%" "%HOMEDIR%\echo_transcriber.py" --setup
start "Echo transcriber" /min "%VPY%" "%HOMEDIR%\echo_transcriber.py"

:openapp
REM 4. Open Echo in its own window, like a desktop app.
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --app="%URL%" --window-size=1100,900
) else (
  start "" msedge --app="%URL%" --window-size=1100,900
)
exit /b

:findpython
set "PYBASE="
for %%V in (3.12 3.11 3.13 3.10) do if not defined PYBASE (py -%%V -c "import sys" >nul 2>&1 && set "PYBASE=py -%%V")
if not defined PYBASE if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PYBASE="%LOCALAPPDATA%\Programs\Python\Python312\python.exe""
if not defined PYBASE (python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>&1 && set "PYBASE=python")
exit /b
