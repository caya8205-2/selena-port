@echo off
rem Portable MongoDB for local AscNet testing. No service, no autostart:
rem this window is the database. Close it (or Ctrl+C) to stop.
set MONGO_ROOT=D:\mongo\mongodb-win32-x86_64-windows-7.0.48\bin
"%MONGO_ROOT%\mongod.exe" --dbpath D:\mongo\data --port 27017 --bind_ip 127.0.0.1
