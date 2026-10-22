param([Parameter(Mandatory=$true)][string]$StateFile,[ValidateSet('caf','worker')][string]$Component)
$ErrorActionPreference='Stop'
$state=Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
$settings=Get-Content -LiteralPath $state.env -Raw | ConvertFrom-Json
foreach($property in $settings.PSObject.Properties){[Environment]::SetEnvironmentVariable($property.Name,[string]$property.Value,'Process')}
Set-Location -LiteralPath $state.app
$log=Join-Path (Split-Path $StateFile) ($Component+'-server.log')
$ErrorActionPreference='Continue'
if($Component -eq 'caf'){& node node_modules/next/dist/bin/next dev --port 18110 --hostname 127.0.0.1 *> $log}
else{& node scripts/radius-demo-worker.cjs *> $log}
