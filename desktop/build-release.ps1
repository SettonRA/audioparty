<#
.SYNOPSIS
    Builds the portable AudioParty desktop app: a single self-contained AudioParty.exe.

.DESCRIPTION
    Output: desktop\dist\AudioParty.exe. It needs nothing installed on the user's PC (the .NET
    runtime is bundled), so it can be double-clicked, run from a USB stick, or put anywhere.
    The build machine needs the .NET 10 SDK.

.PARAMETER Destination
    Optional scp destination to upload the finished exe to the web server, e.g.
    "user@server:~/audioparty/downloads/AudioParty.exe". The web UI serves that file
    (see DESKTOP_DOWNLOAD_FILE in the server's .env).

.EXAMPLE
    ./build-release.ps1
    ./build-release.ps1 -Destination "user@server:~/audioparty/downloads/AudioParty.exe"
#>
param(
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $exe = Join-Path $PSScriptRoot 'dist\AudioParty.exe'
    Remove-Item $exe -ErrorAction SilentlyContinue

    dotnet publish -p:PublishProfile=portable-win-x64 -nologo
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (exit code $LASTEXITCODE)" }
    if (-not (Test-Path $exe)) { throw "Expected output not found: $exe" }

    $item = Get-Item $exe
    $hash = (Get-FileHash $exe -Algorithm SHA256).Hash
    $version = $item.VersionInfo.ProductVersion
    Write-Host ""
    Write-Host "Built $($item.FullName)"
    Write-Host ("  Version : {0}" -f $version)
    Write-Host ("  Size    : {0:N1} MB" -f ($item.Length / 1MB))
    Write-Host ("  SHA-256 : {0}" -f $hash)

    if ($Destination) {
        Write-Host ""
        Write-Host "Uploading to $Destination ..."
        scp $exe $Destination
        if ($LASTEXITCODE -ne 0) { throw "scp failed (exit code $LASTEXITCODE)" }
        Write-Host "Uploaded."
    }
}
finally {
    Pop-Location
}
