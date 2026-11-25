$target = "D:\咕咕嘎嘎反重力\dist-releases\哲启明思-Windows便携版.exe"
$new = "D:\咕咕嘎嘎反重力\dist-releases\哲启明思-Windows便携版-新.exe"
for ($i = 0; $i -lt 900; $i++) {
  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target }
  if (-not $p) {
    Copy-Item -Force $new $target
    Write-Output "replaced"
    exit 0
  }
  Start-Sleep -Seconds 2
}
Write-Output "timeout"
