@echo off
REM Starts a small local web server for Lamp Tinder and opens it in your browser.
REM Close this window to stop the site.
cd /d "%~dp0"
set PY="C:\Program Files\Blender Foundation\Blender 5.2\5.2\python\bin\python.exe"
if not exist %PY% set PY=python
echo Lamp Tinder running at http://localhost:8000/  (close this window to stop)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000/"
%PY% -m http.server 8000 --bind 127.0.0.1
pause
