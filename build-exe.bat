@echo off
setlocal
title Tecnofra Lab - Build EXE
cd /d "%~dp0"

echo ================================================
echo   GENERAZIONE INSTALLER TECNOFRA LAB (.exe)
echo ================================================
echo.

REM --- 1. Verifica Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRORE] Node.js non e' installato.
  echo Scaricalo da: https://nodejs.org  ^(versione LTS^)
  echo Poi riavvia questo file.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo Node.js trovato: %%v
echo.

REM --- 2. Installazione dipendenze ---
if not exist "node_modules" (
  echo [1/3] Installazione dipendenze ^(prima volta, ~5 minuti^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [ERRORE] npm install fallito.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Dipendenze gia' installate, salto npm install.
)
echo.

REM --- 3. Build frontend ---
echo [2/3] Compilazione frontend...
call npx vite build
if errorlevel 1 (
  echo.
  echo [ERRORE] Build frontend fallito.
  pause
  exit /b 1
)
echo.

REM --- 4. Generazione installer .exe ---
echo [3/3] Creazione installer .exe ^(puo' richiedere qualche minuto^)...
call npx electron-builder --win --x64 --publish never
if errorlevel 1 (
  echo.
  echo [ERRORE] Generazione .exe fallita.
  pause
  exit /b 1
)
echo.

echo ================================================
echo   FATTO!
echo ================================================
echo.
echo L'installer si trova nella cartella:
echo   %~dp0electron-release
echo.
echo Cerca un file tipo:  Tecnofra Lab Setup X.X.X.exe
echo Copialo nella cartella OneDrive condivisa con gli utenti.
echo.

REM Apri la cartella di output
if exist "electron-release" start "" "electron-release"

pause
endlocal