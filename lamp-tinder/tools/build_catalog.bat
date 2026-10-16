@echo off
REM Pull real lamps (photos, prices, links) from store feeds into data\catalog.json
cd /d "%~dp0\.."
set PY="C:\Program Files\Blender Foundation\Blender 5.2\5.2\python\bin\python.exe"
if not exist %PY% set PY=python
%PY% tools\build_catalog.py
