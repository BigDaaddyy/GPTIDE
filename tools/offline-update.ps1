param([string]$InstallPath)
$ErrorActionPreference = 'Stop'
try {
  if (-not $InstallPath) {
    $registered = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE' -ErrorAction SilentlyContinue
    $InstallPath = $registered.InstallLocation
  }
  if (-not $InstallPath) { $InstallPath = Join-Path $env:LOCALAPPDATA 'Programs\GPTIDE' }
  $InstallPath = [IO.Path]::GetFullPath($InstallPath)
  $nodePath = Join-Path $InstallPath 'runtime\node.exe'
  if (-not (Test-Path -LiteralPath $nodePath)) { throw 'GPTIDE installation was not found. Pass its folder as the first argument.' }
  $exePath = Join-Path $InstallPath 'app\GPTIDE.exe'
  $probe = [IO.File]::Open($exePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  $probe.Dispose()
  & $nodePath (Join-Path $PSScriptRoot 'offline-update.cjs') $InstallPath
  if ($LASTEXITCODE -ne 0) { throw 'Update failed. Your personal data was kept.' }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Close ALL GPTIDE windows before updating, then retry.'
  Read-Host 'Press Enter to close'
  exit 1
}
