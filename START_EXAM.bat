@echo off
title BeSchool C++ Final Exam
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 18 or newer from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm included.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing project dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection.
    pause
    exit /b 1
  )
)

echo.
echo Starting BeSchool C++ Exam...
echo Keep this window open while the exam is running.
echo Open http://localhost:3000 in your browser.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
