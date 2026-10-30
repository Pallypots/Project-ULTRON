@echo off
REM Double-click to start ULTRON on Windows.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-ultron.ps1"
if errorlevel 1 pause
