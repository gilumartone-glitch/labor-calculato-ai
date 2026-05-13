@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo  RIPARTENZA PULITA DESKTOP - Tecnofra Lab
echo ============================================
echo.
echo Questo script NON cancella il progetto web e NON cancella i dati cloud.
echo Pulisce solo file locali pesanti/temporanei sul tuo PC:
echo - node_modules
echo - dist / build desktop
echo - electron-release / release / out
echo - installer .exe/.msi/.dmg/.AppImage/.deb/.rpm nella cartella progetto
echo.
echo IMPORTANTE: eseguilo dentro la cartella del progetto clonato sul PC.
echo.
pause

set REPO_ROOT=
for /f "delims=" %%r in ('git rev-parse --show-toplevel 2^>nul') do set REPO_ROOT=%%r
if "%REPO_ROOT%"=="" (
  echo.
  echo ERRORE: questa cartella non sembra un repository Git.
  echo Se vuoi ripartire davvero da zero, rinomina questa cartella e clona di nuovo da GitHub.
  pause
  exit /b 1
)
cd /d "%REPO_ROOT%"

if not exist package.json (
  echo ERRORE: manca package.json. Non sono nella cartella principale del progetto.
  pause
  exit /b 1
)

echo.
echo === Controllo file grandi tracciati da Git ===
git ls-files -z | powershell -NoProfile -Command "$inputBytes=[Console]::OpenStandardInput(); $bytes=New-Object byte[] 10485760; $ms=New-Object IO.MemoryStream; while(($n=$inputBytes.Read($bytes,0,$bytes.Length)) -gt 0){$ms.Write($bytes,0,$n)}; $files=[Text.Encoding]::UTF8.GetString($ms.ToArray()).Split([char]0,[StringSplitOptions]::RemoveEmptyEntries); foreach($f in $files){ if(Test-Path $f -PathType Leaf){ $len=(Get-Item $f).Length; if($len -gt 50000000){ Write-Host (($len/1MB).ToString('0.0') + ' MB`t' + $f) } } }"

echo.
echo === Pulisco file locali pesanti ===
if exist node_modules rmdir /s /q node_modules
if exist dist rmdir /s /q dist
if exist dist-ssr rmdir /s /q dist-ssr
if exist electron-release rmdir /s /q electron-release
if exist release rmdir /s /q release
if exist out rmdir /s /q out
del /q *.exe *.msi *.dmg *.AppImage *.deb *.rpm 2>nul
del /q tsconfig.*.tsbuildinfo 2>nul

echo.
echo === Reimposto Git sulla versione online ===
git fetch origin
if errorlevel 1 (
  echo ERRORE: non riesco a contattare GitHub. Controlla internet/accesso repository.
  pause
  exit /b 1
)
git reset --hard origin/main
if errorlevel 1 (
  echo ERRORE: reset Git fallito.
  pause
  exit /b 1
)

echo.
echo === Creo configurazione locale desktop ===
> .env.local echo VITE_SUPABASE_URL=https://oylveuwfvsijguwzlauw.supabase.co
>> .env.local echo VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95bHZldXdmdnNpamd1d3psYXV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1OTU4NjMsImV4cCI6MjA5NDE3MTg2M30.lSrUmQLS1ilqPKwdUoCZwZslnai_Z8BIqODm02C92MI
>> .env.local echo VITE_SUPABASE_PROJECT_ID=oylveuwfvsijguwzlauw

echo.
echo ============================================
echo  PULIZIA COMPLETATA.
echo  Ora esegui: aggiorna.bat
echo ============================================
echo.
pause
exit /b 0
