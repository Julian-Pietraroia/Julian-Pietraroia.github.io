@echo off
REM Computes image fingerprints (CLIP) for lamp renders + catalog photos in your browser.
cd /d "%~dp0\.."
set PY="C:\Program Files\Blender Foundation\Blender 5.2\5.2\python\bin\python.exe"
if not exist %PY% set PY=python
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000/tools/embed.html"
%PY% tools\server.py 8000
