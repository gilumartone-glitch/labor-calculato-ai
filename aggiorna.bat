@echo off
setlocal
cd /d "%~dp0"
REM ============================================
REM  WorkpriceBuddy - BUILD & PUBLISH
REM  Solo per l'amministratore (chi pubblica).
REM
REM  Cosa fa:
REM   1. Scarica ultime modifiche da GitHub
REM   2. Installa dipendenze
REM   3. Compila l'app
REM   4. Genera installer .exe (NSIS)
REM   5. Pubblica su GitHub Releases (auto-update)
REM
REM  PRIMA DEL PRIMO USO:
REM   - Crea un Personal Access Token GitHub con scope 'repo'
REM     https://github.com/settings/tokens
REM   - Imposta variabile d'ambiente GH_TOKEN col token
REM     (Pannello Controllo > Variabili d'ambiente utente)
REM ============================================

echo.
echo === [1/6] Riparto pulito da GitHub ===
set REPO_ROOT=
for /f "delims=" %%r in ('git rev-parse --show-toplevel 2^>nul') do set REPO_ROOT=%%r
if "%REPO_ROOT%"=="" (
  echo.
  echo ERRORE: aggiorna.bat non e' dentro una cartella Git valida.
  echo Metti questo file nella cartella principale del progetto e rilancialo.
  goto errore
)
cd /d "%REPO_ROOT%"
if not exist index.html (
  echo ERRORE: questa non sembra la cartella principale del progetto.
  goto errore
)
if not exist package.json (
  echo ERRORE: manca package.json nella cartella del progetto.
  goto errore
)

echo.
echo === Verifico repository GitHub corretto ===
set ORIGIN_URL=
for /f "delims=" %%u in ('git remote get-url origin 2^>nul') do set ORIGIN_URL=%%u
echo Repository attuale: %ORIGIN_URL%
echo %ORIGIN_URL% | findstr /i "workprice-buddy-new" >nul
if errorlevel 1 (
  echo Correggo origin verso workprice-buddy-new...
  git remote set-url origin https://github.com/gilumartone-glitch/workprice-buddy-new.git
  if errorlevel 1 goto errore
)

for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).version"`) do set VERSIONE_PRIMA=%%v
echo Versione attuale locale: %VERSIONE_PRIMA%
REM Elimina i commit locali divergenti: GitHub resta la fonte principale.
git fetch origin
if errorlevel 1 goto errore
git reset --hard origin/main
if errorlevel 1 goto errore
if not exist src\main.tsx (
  echo.
  echo ERRORE: manca src\main.tsx dopo il download da GitHub.
  echo Il repository GitHub che stai scaricando NON contiene i sorgenti dell'app.
  echo Non posso compilare finche' su GitHub non esiste la cartella src completa.
  echo Soluzione: scarica/collega il codice aggiornato da Lovable a GitHub, poi rilancia.
  goto errore
)

echo.
echo === Disattivo publisher interno di electron-builder ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-Content package.json -Raw | ConvertFrom-Json; $p.repository = @{ type = 'git'; url = 'https://github.com/gilumartone-glitch/workprice-buddy-new.git' }; if ($p.build.PSObject.Properties.Name -contains 'publish') { $p.build.PSObject.Properties.Remove('publish') }; $p | ConvertTo-Json -Depth 20 | Set-Content package.json -Encoding UTF8"
if errorlevel 1 goto errore

REM Pulisce SOLO residui pesanti di build, senza cancellare sorgenti non tracciati.
if exist node_modules rmdir /s /q node_modules
if exist dist rmdir /s /q dist
if exist dist-ssr rmdir /s /q dist-ssr
if exist electron-release rmdir /s /q electron-release
if exist release rmdir /s /q release
if exist out rmdir /s /q out
del /q *.exe *.msi *.dmg *.AppImage *.deb *.rpm 2>nul

echo.
echo === Proteggo Git da file pesanti ===
call :aggiungi_ignore "node_modules/"
call :aggiungi_ignore "dist/"
call :aggiungi_ignore "dist-ssr/"
call :aggiungi_ignore "electron-release/"
call :aggiungi_ignore "release/"
call :aggiungi_ignore "out/"
call :aggiungi_ignore "*.exe"
call :aggiungi_ignore "*.msi"
call :aggiungi_ignore ".env"
call :aggiungi_ignore ".env.local"
git rm -r --cached --ignore-unmatch node_modules dist dist-ssr electron-release release out >nul 2>nul
git rm --cached --ignore-unmatch *.exe *.msi *.dmg *.AppImage *.deb *.rpm >nul 2>nul

echo.
echo === [2/6] Aumento automaticamente la versione ===
call npm version patch --no-git-tag-version
if errorlevel 1 goto errore
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).version"`) do set VERSIONE_DOPO=%%v
echo Versione nuova: %VERSIONE_DOPO%
if "%VERSIONE_PRIMA%"=="%VERSIONE_DOPO%" (
  echo ERRORE: la versione non e' aumentata.
  goto errore
)

echo.
echo === Configuro l'app desktop per collegarsi al cloud ===
> .env.local echo VITE_SUPABASE_URL=https://nnuxzyrchpbpztohlunb.supabase.co
>> .env.local echo VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5udXh6eXJjaHBicHp0b2hsdW5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4NTk3ODEsImV4cCI6MjA5MjQzNTc4MX0.mgLS9ur46B2Sp5WrkmDNtnfs6RXimG7yolWv-LmbYG0
>> .env.local echo VITE_SUPABASE_PROJECT_ID=nnuxzyrchpbpztohlunb

echo.
echo === [3/6] Installo dipendenze ===
call npm install --legacy-peer-deps
if errorlevel 1 goto errore

echo.
echo === [4/6] Compilo frontend ===
call npm run build
if errorlevel 1 goto errore

echo.
echo === [5/6] Genero installer LOCALE ===
call npx electron-builder --win --x64 --publish never
if errorlevel 1 goto errore

if "%GH_TOKEN%"=="" (
  echo.
  echo NB: GH_TOKEN non impostata, installer creato ma pubblicazione saltata.
) else (
  echo.
  echo === Pubblico manualmente su GitHub Releases corretto ===
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-github-release.ps1 -Version "%VERSIONE_DOPO%" -Owner "gilumartone-glitch" -Repo "workprice-buddy-new" -ReleaseDir "electron-release"
  if errorlevel 1 goto errore
)

echo.
echo === [6/6] Salvo il numero versione su GitHub ===
git add .gitignore package.json package-lock.json
git commit -m "Aggiorna versione desktop"
git push

echo.
echo ============================================
echo  BUILD COMPLETATA!
echo  Installer in: electron-release\
if not "%GH_TOKEN%"=="" echo  Pubblicato su GitHub Releases.
echo ============================================
echo.
echo === Apro la cartella con l'installer ===
explorer electron-release
if not "%GH_TOKEN%"=="" start https://github.com/gilumartone-glitch/workprice-buddy-new/releases
exit /b 0

:errore
echo.
echo ============================================
echo  ERRORE durante il build.
echo  Leggi il messaggio sopra per capire cosa.
echo ============================================
pause
exit /b 1

:aggiungi_ignore
if not exist .gitignore type nul > .gitignore
findstr /x /c:%1 .gitignore >nul 2>nul
if errorlevel 1 echo %~1>>.gitignore
exit /b 0
