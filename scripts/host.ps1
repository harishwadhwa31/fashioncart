<#
.SYNOPSIS
    Launches the vendored MCP Apps basic-host harness on Windows PowerShell.

.DESCRIPTION
    The upstream harness (modelcontextprotocol/ext-apps examples/basic-host) is documented for
    bash and runs its dev server under Bun. Neither is required: serve.ts is shebanged
    "#!/usr/bin/env npx tsx" and uses only Express and Node APIs, so tsx runs it unmodified.

    This script wraps the harness so it can be started with one command and no bash-isms:
      - no `SERVERS='[...]' npm start` env prefix (a parse error in PowerShell)
      - no Bun
      - installs and builds on first run only

    Two upstream packaging gaps are already patched in packages/host-harness/package.json:
    @types/cors and cross-env are both used by basic-host but missing from its devDependencies;
    they only resolve upstream because the monorepo root hoists them.

.PARAMETER Servers
    One or more MCP server endpoint URLs for the harness to connect to.
    Defaults to the FashionCart dev server.

.PARAMETER HostPort
    Port for the host UI. Default 8080.

.PARAMETER SandboxPort
    Port for the sandbox proxy origin. Default 8081. The widget executes on THIS origin, not on
    the MCP server's, which is why 'self' in the enforced CSP never means your deployment.

.PARAMETER Rebuild
    Force a rebuild even if dist/ already exists.

.EXAMPLE
    .\scripts\host.ps1

.EXAMPLE
    .\scripts\host.ps1 -Servers "http://localhost:3001/mcp","http://localhost:3002/mcp"

.EXAMPLE
    .\scripts\host.ps1 -Rebuild -HostPort 8090
#>
[CmdletBinding()]
param(
    [string[]] $Servers = @("http://localhost:3001/mcp"),
    [int]      $HostPort = 8080,
    [int]      $SandboxPort = 8081,
    [switch]   $Rebuild
)

$ErrorActionPreference = "Stop"

$HarnessDir = Join-Path $PSScriptRoot "..\packages\host-harness"
$HarnessDir = (Resolve-Path $HarnessDir).Path

if (-not (Test-Path (Join-Path $HarnessDir "serve.ts"))) {
    throw "Harness not found at $HarnessDir. Expected the vendored basic-host copy."
}

Push-Location $HarnessDir
try {
    if (-not (Test-Path (Join-Path $HarnessDir "node_modules"))) {
        Write-Host "[host.ps1] Installing harness dependencies (first run only)..." -ForegroundColor Cyan
        npm install --no-audit --no-fund
        if (-not $?) { throw "npm install failed" }
    }

    $distIndex = Join-Path $HarnessDir "dist\index.html"
    if ($Rebuild -or -not (Test-Path $distIndex)) {
        Write-Host "[host.ps1] Building harness bundles..." -ForegroundColor Cyan
        npm run build
        if (-not $?) { throw "npm run build failed" }
    }

    # PowerShell-native env assignment. The upstream README's bash prefix form
    #   SERVERS='["http://localhost:3001/mcp"]' npm start
    # is a parse error here; these three lines are the equivalent.
    # Built by hand rather than with ConvertTo-Json: -AsArray does not exist in Windows
    # PowerShell 5.1, and without it a single-element array serialises to a bare string, which
    # serve.ts would JSON.parse into a string instead of an array.
    $env:SERVERS = '[' + (($Servers | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'
    $env:HOST_PORT = "$HostPort"
    $env:SANDBOX_PORT = "$SandboxPort"

    Write-Host ""
    Write-Host "[host.ps1] SERVERS        = $($env:SERVERS)" -ForegroundColor Green
    Write-Host "[host.ps1] Host UI        = http://localhost:$HostPort" -ForegroundColor Green
    Write-Host "[host.ps1] Sandbox origin = http://localhost:$SandboxPort" -ForegroundColor Green
    Write-Host "[host.ps1] Widget console events are prefixed [HOST]." -ForegroundColor DarkGray
    Write-Host ""

    npx tsx serve.ts
}
finally {
    Pop-Location
}
