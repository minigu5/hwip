$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$source = Join-Path $PSScriptRoot 'HwipCompanion.cs'
$outputDir = Join-Path $projectRoot 'public\downloads'
$output = Join-Path $outputDir 'HwipCompanion.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $compiler)) {
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) {
  throw '.NET Framework C# compiler를 찾을 수 없습니다.'
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
& $compiler /nologo /target:winexe /optimize+ /platform:anycpu /out:$output `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll $source
if ($LASTEXITCODE -ne 0) { throw "컴파일 실패: $LASTEXITCODE" }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $outputDir 'HwipCompanion.sha256') -Value "$hash  HwipCompanion.exe" -Encoding ascii
Write-Host "Built $output"
Write-Host "SHA256 $hash"
