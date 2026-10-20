@echo off
rem Lance Studio SLOWIK Detourage. Premier lancement : installe le moteur d'IA (fenetre de progression).
set APP=%~dp0
if not exist "%APP%python\dependances-ok.txt" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%APP%moteur\installation\dependances.ps1" -App "%APP%."
  if errorlevel 1 (
    echo.
    echo L'installation du moteur a echoue. Verifiez la connexion Internet puis relancez le logiciel.
    pause
    exit /b 1
  )
)
start "" "%APP%python\pythonw.exe" "%APP%moteur\lancer.py"
