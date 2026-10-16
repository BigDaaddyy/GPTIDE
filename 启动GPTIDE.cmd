@echo off
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0tools\launch.cjs" %*
