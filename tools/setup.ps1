$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$downloadDir = Join-Path $projectRoot 'downloads'
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$archive = Join-Path $downloadDir 'VSCodium.zip'
$releaseBase = 'https://github.com/VSCodium/vscodium/releases/download/1.135.06055'
Invoke-WebRequest -Uri "$releaseBase/VSCodium-win32-x64-1.135.06055.zip" -OutFile $archive
$expectedHash = '0bec978f201238624bc9ad43966f5e201ed8afacc37d77035a822252d9c9c200'
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'VSCodium 下载校验失败，停止安装。'
}
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $projectRoot 'app') -Force
Push-Location $projectRoot
try {
    node tools/build.cjs
    if ($LASTEXITCODE -ne 0) { throw '构建失败' }
} finally { Pop-Location }
