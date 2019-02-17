
$logs = Join-Path $PSScriptRoot .\..\logs

node.exe .\test\http-events36-post.self-test.js > "$logs\http-events36-post.self-test.log" 2>&1

node.exe .\test\http-events36-get.self-test.js > "$logs\http-events36-get.self-test.log" 2>&1

Start-Process -FilePath "C:\Program Files\WinMerge\WinMergeU.exe" -ArgumentList "$logs\http-events36-get.self-test.log", "$logs\http-events36-post.self-test.log"
