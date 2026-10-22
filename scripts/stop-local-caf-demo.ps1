$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$pidsPath = Join-Path $repo '.tools\working-demo\processes.json'
if (-not (Test-Path -LiteralPath $pidsPath)) { Write-Output 'No CAF demo process record.'; return }
$owned = Get-Content -LiteralPath $pidsPath -Raw | ConvertFrom-Json
foreach ($property in $owned.PSObject.Properties) {
    if ($property.Name -notin @('caf', 'worker')) { continue }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$property.Value)"
    # Never stop a reused PID or any peer RADIUS/PostgreSQL process.
    if ($process -and $process.CommandLine.Contains((Join-Path $PSScriptRoot 'run-caf-demo-component.ps1')) -and $process.CommandLine.Contains('-Component ' + $property.Name)) {
        & taskkill.exe /PID $process.ProcessId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop an owned CAF demo process tree' }
    }
}
Remove-Item -LiteralPath $pidsPath
Write-Output 'CAF demo processes stopped. Database, uploads and peer services preserved.'
