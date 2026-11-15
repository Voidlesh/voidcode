@echo off
rem Startet den voidcode-Fork (T3 Code) aus dem Quellcode.
rem Doppelklick genuegt. Beim ersten Start installiert er die Abhaengigkeiten.

setlocal
cd /d "%~dp0"

where vp >nul 2>nul
if errorlevel 1 (
  echo [voidcode] "vp" wurde nicht gefunden. Installiere Vite+ mit:
  echo   irm https://vite.plus/ps1 ^| iex
  pause
  exit /b 1
)

echo [voidcode] Abhaengigkeiten pruefen...
call vp i
if errorlevel 1 (
  echo [voidcode] vp i ist fehlgeschlagen.
  pause
  exit /b 1
)

echo [voidcode] Starte Server und Web-Oberflaeche...
echo [voidcode] Die pairingUrl im Log oeffnen. Die nackte localhost-Adresse authentifiziert nicht.
call vp run dev %*
pause
endlocal
