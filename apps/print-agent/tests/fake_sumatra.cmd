@echo off
"%FAKE_PY%" "%~dp0fake_sumatra.py" %*
exit /b %ERRORLEVEL%
