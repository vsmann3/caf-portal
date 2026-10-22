param([string]$PeerStatus='E:\Netloom\Netloom-Radius\.tools\integration-demo\peer-status.json',[switch]$SkipPrepare)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot
if(-not $SkipPrepare){& python -X utf8 (Join-Path $PSScriptRoot 'prepare-local-caf-demo.py') --peer-status $PeerStatus;if($LASTEXITCODE -ne 0){throw 'Demo preparation failed'}}
$state=Join-Path $repo '.tools\working-demo\state.json'
$pidsPath=Join-Path $repo '.tools\working-demo\processes.json'
$owned=@{}
if(Test-Path -LiteralPath $pidsPath){$old=Get-Content -LiteralPath $pidsPath -Raw|ConvertFrom-Json;foreach($p in $old.PSObject.Properties){$owned[$p.Name]=[int]$p.Value}}
foreach($component in @('caf','worker')){
 $running=$null
 if($owned.ContainsKey($component)){$running=Get-CimInstance Win32_Process -Filter "ProcessId = $($owned[$component])"}
 if($running -and $running.CommandLine -like '*run-caf-demo-component.ps1*'){continue}
 $process=Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-File',(Join-Path $PSScriptRoot 'run-caf-demo-component.ps1'),'-StateFile',$state,'-Component',$component) -PassThru
 $owned[$component]=$process.Id
}
$owned|ConvertTo-Json|Set-Content -LiteralPath $pidsPath -Encoding utf8
Write-Output 'CAF starting: http://127.0.0.1:18110 ; Radius: http://127.0.0.1:18120'
Write-Output ('Private demo logins: '+(Join-Path $repo '.tools\working-demo\access.txt'))
