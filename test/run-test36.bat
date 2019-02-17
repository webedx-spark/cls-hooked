@ECHO OFF
cls

ECHO "%~dp0"
PUSHD %~dp0..

ECHO %CD%

node .\test\http-events36-post.self-test.js > "%CD%\logs\http-events36-post.self-test.log" 2>&1

node .\test\http-events36-get.self-test.js > "%CD%\logs\http-events36-get.self-test.log" 2>&1

"C:\Program Files\WinMerge\WinMergeU.exe" "%CD%\logs\http-events36-get.self-test.log" "%CD%\logs\http-events36-post.self-test.log"

POPD
