@echo off
title POS-80C Print Listener
echo ============================================
echo  Iniciando listener de impresion POS-80C...
echo  Puerto: 9100
echo  NO CIERRES ESTA VENTANA
echo ============================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0print_listener.ps1"
pause
