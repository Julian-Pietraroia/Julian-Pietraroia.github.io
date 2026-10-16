@echo off
REM Starts a small local web server for Lamp Tinder and opens it in your browser.
REM Close this window to stop the site.
cd /d "%~dp0"
set PY="C:\Program Files\Blender Foundation\Blender 5.2\5.2\python\bin\python.exe"
if not exist %PY% set PY=python
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000/"
%PY% tools\server.py 8000
pause
