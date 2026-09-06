@echo off
title Event QR App - Admin Scanner
echo ========================================================
echo         STARTING EVENT QR PASS & ADMIN SCANNER
echo ========================================================
cd /d "%~dp0"
node server.js
pause
