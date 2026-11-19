@echo off
rem Tryb imprezowy - uruchom dwuklikiem (omija blokade skryptow PowerShell).
cd /d "%~dp0"
if not exist "apps\web\node_modules\next" (
  echo Instaluje zaleznosci...
  call pnpm.cmd install || goto :error
)
node scripts\party.mjs %*
goto :end
:error
echo.
echo Cos poszlo nie tak - sprawdz komunikat powyzej.
:end
pause
