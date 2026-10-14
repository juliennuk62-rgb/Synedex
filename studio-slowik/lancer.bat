@echo off
rem Lance le logiciel sans compiler (pour tester)
cd /d "%~dp0"
python main.py
if errorlevel 1 pause
