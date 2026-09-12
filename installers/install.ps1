param(
    [Parameter(Position=0)]
    [ValidatePattern('^(stable|latest|\d+\.\d+\.\d+(-[^\s]+)?)$')]
    [string]$Target = "latest"
)

# Adapted from the Claude Code native bootstrap installer for an internal mirror.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not [Environment]::Is64BitProcess) {
    throw "Claude Code requires 64-bit Windows."
}

$downloadBaseUrl = "__CLAUDE_MIRROR_BASE_URL__"
$platform = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "win32-arm64" } else { "win32-x64" }
if ($Target -eq "latest" -or $Target -eq "stable") {
    $version = ([string](Invoke-RestMethod -Uri "$downloadBaseUrl/$Target")).Trim()
} else {
    $version = $Target
}
if ($version -notmatch '^\d+\.\d+\.\d+(-[^\s]+)?$') {
    throw "The mirror returned an invalid Claude Code version."
}

$manifest = Invoke-RestMethod -Uri "$downloadBaseUrl/$version/manifest.json"
$platformProperty = $manifest.platforms.PSObject.Properties[$platform]
if ($null -eq $platformProperty) {
    throw "Claude Code $version is not available for $platform in this mirror."
}
$platformEntry = $platformProperty.Value
if ($platformEntry.checksum -notmatch '^[a-f0-9]{64}$') { throw "Invalid checksum in mirror manifest." }

$downloadDir = Join-Path $env:USERPROFILE ".claude\downloads"
$versionsDir = Join-Path $env:USERPROFILE ".local\share\claude\versions"
$binDir = Join-Path $env:USERPROFILE ".local\bin"
New-Item -ItemType Directory -Force -Path $downloadDir, $versionsDir, $binDir | Out-Null
$binaryPath = Join-Path $downloadDir "claude-$version-$platform-$PID.exe"
$versionTemp = Join-Path $versionsDir ".$version-$PID.tmp"
$versionPath = Join-Path $versionsDir $version
$launcher = Join-Path $binDir "claude.exe"
$launcherTemp = Join-Path $binDir ".claude-$PID.tmp.exe"
$launcherBackup = Join-Path $binDir ".claude-$PID.old.exe"

try {
    Write-Output "Downloading Claude Code $version from the internal mirror..."
    Invoke-WebRequest -Uri "$downloadBaseUrl/$version/$platform/claude.exe" -OutFile $binaryPath
    $actualChecksum = (Get-FileHash -Path $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualChecksum -ne $platformEntry.checksum) {
        throw "Checksum verification failed."
    }

    Copy-Item $binaryPath $versionTemp
    if (Test-Path $versionPath) { Remove-Item -Force $versionPath }
    Move-Item $versionTemp $versionPath

    Copy-Item $versionPath $launcherTemp
    if (Test-Path $launcher) { Move-Item -Force $launcher $launcherBackup }
    try {
        Move-Item $launcherTemp $launcher
    } catch {
        if (Test-Path $launcherBackup) { Move-Item $launcherBackup $launcher }
        throw
    }
    if (Test-Path $launcherBackup) { Remove-Item -Force $launcherBackup -ErrorAction SilentlyContinue }

    $bashLauncher = Join-Path $binDir "claude"
    if (Test-Path $bashLauncher) { Remove-Item -Force $bashLauncher }
    try {
        New-Item -ItemType HardLink -Path $bashLauncher -Target $versionPath | Out-Null
    } catch {
        Copy-Item $versionPath $bashLauncher
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathEntries = @($userPath -split ';' | Where-Object { $_ })
    if ($pathEntries -notcontains $binDir) {
        [Environment]::SetEnvironmentVariable("Path", (($pathEntries + $binDir) -join ';'), "User")
    }
    if (($env:Path -split ';') -notcontains $binDir) { $env:Path = "$binDir;$env:Path" }
    Write-Output "Claude Code $version installed at $launcher"
    Write-Output "Run: claude --version"
} finally {
    Remove-Item -Force $binaryPath, $versionTemp, $launcherTemp -ErrorAction SilentlyContinue
}
