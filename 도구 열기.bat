@echo off
cd /d "%~dp0"

echo.
echo   fromis_9 TYPING - 가사 도구
echo   ================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo   [오류] Python 을 찾을 수 없습니다.
  echo   Python 을 설치한 뒤 다시 실행해 주세요.
  echo.
  pause
  exit /b
)

echo   서버를 켜는 중입니다...
start "fromis9-tools-server" /min cmd /c "python -m http.server 5661"

timeout /t 2 /nobreak >nul
start "" "http://localhost:5661/tools.html"

echo.
echo   브라우저가 열렸습니다.
echo.
echo   * 작업이 끝나면 이 창에서 아무 키나 누르세요.
echo     (서버가 꺼집니다)
echo.
pause >nul

taskkill /fi "WINDOWTITLE eq fromis9-tools-server*" /f >nul 2>nul
echo   서버를 껐습니다.
timeout /t 1 /nobreak >nul