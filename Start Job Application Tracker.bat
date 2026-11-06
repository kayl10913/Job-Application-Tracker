@echo off
cd /d "%~dp0"
title Job Application Tracker
echo Starting Job Application Tracker...
call npm run app
if errorlevel 1 pause
