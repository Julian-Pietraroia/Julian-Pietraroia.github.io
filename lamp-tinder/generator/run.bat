@echo off
REM Lamp Tinder generator.
REM   double-click                   generate 300 lamps into out\
REM   run.bat --count 500            generate 500 lamps
REM   run.bat --combine liked.json   blend the liked lamps into one (out\combined.jpg)
set BLENDER="C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
cd /d "%~dp0"
if "%~1"=="" (
  %BLENDER% -b -P gen_lamps.py -- --count 300
) else (
  %BLENDER% -b -P gen_lamps.py -- %*
)
pause
