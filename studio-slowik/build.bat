@echo off
rem Compilation de Studio SLOWIK en un seul fichier .exe
cd /d "%~dp0"

echo === Installation des dependances ===
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 goto erreur

echo === Compilation ===
python -m PyInstaller --noconfirm --clean --onefile --windowed --name StudioSlowik --collect-all customtkinter main.py
if errorlevel 1 goto erreur

echo.
echo Termine. Le logiciel est ici : dist\StudioSlowik.exe
pause
exit /b 0

:erreur
echo.
echo ERREUR pendant la compilation. Lire les messages ci-dessus.
pause
exit /b 1
