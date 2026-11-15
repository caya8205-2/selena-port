<#
Selena-port control centre.

One window that prepares dependencies and runs the stack, so starting the server is
a button instead of a sequence of terminal commands. It does four things:

    prepare  - check the runtime, fetch the portable MongoDB if missing, build the
               server and the panel from this repo
    start    - mongod, AscNet (SDK + game), and the web panel, each with its log
    stop     - stop exactly the processes this tool started, by recorded pid
    game     - launch the patched client with ASCNET_PATCH_ORIGIN pointed at the
               panel's SDK port, which is what makes the client talk to us

Everything is also available headless, which is how it gets tested:

    powershell -File SelenaPort-ControlCenter.ps1 -Action status
    powershell -File SelenaPort-ControlCenter.ps1 -Action start|stop|prepare|game
#>

param(
    [ValidateSet('gui', 'status', 'prepare', 'start', 'stop', 'game')]
    [string]$Action = 'gui'
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------ settings

$Repo = Split-Path -Parent $PSScriptRoot          # ...\selena-port
$MongoRoot = 'D:\mongo'
$MongoBin = Join-Path $MongoRoot 'mongodb-win32-x86_64-windows-7.0.48\bin\mongod.exe'
$MongoData = Join-Path $MongoRoot 'data'
$MongoZip = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.48.zip'

$GameDir = 'D:\gemink\Punishing Gray Raven\Punishing Gray Raven Game'
$ServerDir = Join-Path $Repo 'AscNet\bin\Debug\net8.0'
$PanelDir = Join-Path $Repo 'AscNet.WebPanel'

$SdkPort = 8085
$GamePort = 2335
$PanelPort = 8081
$MongoPort = 27017

$RunDir = Join-Path $Repo 'tools\.run'
$LogDir = Join-Path $RunDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Dotnet = (Get-Command dotnet -ErrorAction SilentlyContinue).Source
if (-not $Dotnet) {
    $candidate = Join-Path $env:LOCALAPPDATA 'Microsoft\dotnet\dotnet.exe'
    if (Test-Path $candidate) { $Dotnet = $candidate }
}

# ------------------------------------------------------------------ helpers

function Test-Port([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

# Wait for a listener instead of sleeping a fixed amount: the server loads its
# tables before it binds, so a fixed sleep either lies or wastes time.
function Wait-Port([int]$Port, [int]$Seconds = 60) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $Port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Get-PortOwner([int]$Port) {
    $line = netstat -ano | Select-String ":$Port\s+.*LISTENING" | Select-Object -First 1
    if (-not $line) { return $null }
    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }
    return [int]$parts[-1]
}


# Launch detached with no console window: wscript runs the command with window
# style 0 and returns at once, so neither a stray terminal appears nor a redirect
# pipe keeps this script waiting.
function Start-Detached([string]$CommandLine, [string]$WorkingDirectory) {
    $launcher = Join-Path $PSScriptRoot 'hidden-launch.vbs'
    if (-not (Test-Path $launcher)) { throw "hidden launcher missing: $launcher" }
    Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$launcher`"", "`"$WorkingDirectory`"", "`"$CommandLine`"" -WindowStyle Hidden | Out-Null
    return $null
}

# The listener can answer before netstat shows it, so wait for the owner briefly.
function Wait-Owner([int]$Port, [int]$Seconds = 10) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        $owner = Get-PortOwner $Port
        if ($owner) { return $owner }
        Start-Sleep -Milliseconds 300
    }
    return $null
}

function Get-Recorded([string]$Name) {
    $file = Join-Path $RunDir "$Name.pid"
    if (-not (Test-Path $file)) { return $null }
    $pidValue = (Get-Content $file -Raw).Trim()
    if (-not $pidValue) { return $null }
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($process) { return [int]$pidValue }
    Remove-Item $file -ErrorAction SilentlyContinue
    return $null
}

function Stop-Recorded([string]$Name) {
    $processId = Get-Recorded $Name
    if ($processId) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        Write-Host "stopped $Name (pid $processId)"
    } else {
        Write-Host "$Name was not running"
    }
    Remove-Item (Join-Path $RunDir "$Name.pid") -ErrorAction SilentlyContinue
}

function Get-Status {
    [pscustomobject]@{
        Mongo = Test-Port $MongoPort
        Sdk = Test-Port $SdkPort
        # A TCP probe makes the game server open a session and save state on every refresh,
        # which floods its log and touches player documents. The process is the honest signal.
        Game = (Get-Process -Name AscNet -ErrorAction SilentlyContinue) -ne $null
        Panel = Test-Port $PanelPort
    }
}

# ------------------------------------------------------------------ prepare

function Invoke-Prepare {
    if (-not $Dotnet) { throw 'dotnet was not found. Install the .NET SDK or set DOTNET_ROOT.' }
    $env:DOTNET_ROOT = Split-Path -Parent $Dotnet
    $env:PATH = "$($env:DOTNET_ROOT);$($env:PATH)"

    if (-not (Test-Path $MongoBin)) {
        Write-Host "MongoDB is missing; fetching the portable build..."
        New-Item -ItemType Directory -Force -Path $MongoRoot | Out-Null
        $zip = Join-Path $MongoRoot 'mongodb.zip'
        Invoke-WebRequest -Uri $MongoZip -OutFile $zip
        Expand-Archive -Path $zip -DestinationPath $MongoRoot -Force
        Remove-Item $zip -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $MongoData | Out-Null

    Write-Host 'building server...'
    & $Dotnet build (Join-Path $Repo 'AscNet\AscNet.csproj') -v q --nologo | Out-Null
    Write-Host 'building panel...'
    & $Dotnet build (Join-Path $PanelDir 'AscNet.WebPanel.csproj') -v q --nologo | Out-Null
    Write-Host 'prepare done'
}

# ------------------------------------------------------------------ start / stop

function Invoke-Start {
    $status = Get-Status

    if (-not $status.Mongo) {
        if (-not (Test-Path $MongoBin)) { throw 'mongod.exe is missing; run prepare first.' }
        $mongoLine = "`"$MongoBin`" --dbpath `"$MongoData`" --port $MongoPort --bind_ip 127.0.0.1 --logpath `"$(Join-Path $LogDir 'mongod.log')`" --logappend"
        Start-Detached $mongoLine $MongoRoot | Out-Null
        $mongoPid = Wait-Owner $MongoPort
        if ($mongoPid) { Set-Content (Join-Path $RunDir 'mongo.pid') $mongoPid }
        if (-not (Wait-Port $MongoPort 60)) { throw 'mongod did not start listening' }
        Write-Host "mongod started (pid $mongoPid)"
    } else {
        Write-Host 'mongod already listening'
    }

    if (-not (Get-Status).Sdk) {
        if (-not (Test-Path (Join-Path $ServerDir 'AscNet.dll'))) { throw 'server build missing; run prepare first.' }
        if (-not $Dotnet) { throw 'dotnet was not found.' }
        # Redirect inside the detached command line; DOTNET_ROOT rides along because a
        # WMI child does not inherit this session's environment.
        $dotnetRoot = Split-Path -Parent $Dotnet
        $serverLine = "cmd /c set `"DOTNET_ROOT=$dotnetRoot`" && set `"PATH=$dotnetRoot;%PATH%`" && `"$Dotnet`" AscNet.dll --urls http://127.0.0.1:$SdkPort > `"$(Join-Path $LogDir 'ascnet.out.log')`" 2> `"$(Join-Path $LogDir 'ascnet.err.log')`""
        $serverPid = Start-Detached $serverLine $ServerDir
        $serverPid = Wait-Owner $SdkPort
        if ($serverPid) { Set-Content (Join-Path $RunDir 'server.pid') $serverPid }
        if (-not (Wait-Port $SdkPort 90)) { throw 'server did not start listening on the SDK port' }
        Write-Host ("server started" + $(if ($serverPid) { " (pid $serverPid)" } else { " (pid from list)" }))
    } else {
        Write-Host 'server already listening'
    }

    if (-not (Get-Status).Panel) {
        $panelLine = "cmd /c set `"DOTNET_ROOT=$dotnetRoot`" && set `"PATH=$dotnetRoot;%PATH%`" && `"$Dotnet`" run --no-build > `"$(Join-Path $LogDir 'panel.out.log')`" 2> `"$(Join-Path $LogDir 'panel.err.log')`""
        $panelPid = Start-Detached $panelLine $PanelDir
        $panelPid = Wait-Owner $PanelPort
        if ($panelPid) { Set-Content (Join-Path $RunDir 'panel.pid') $panelPid }
        if (-not (Wait-Port $PanelPort 60)) { throw 'panel did not start listening' }
        Write-Host ("panel started" + $(if ($panelPid) { " (pid $panelPid)" } else { " (pid from list)" }))
    } else {
        Write-Host 'panel already listening'
    }

    Get-Status | Format-Table -AutoSize | Out-String | Write-Host
}

function Invoke-Stop {
    Stop-Recorded 'panel'
    Stop-Recorded 'server'
    Stop-Recorded 'mongo'

    # Adopted processes: anything still holding our ports is ours to stop.
    foreach ($port in @($PanelPort, $SdkPort, $GamePort, $MongoPort)) {
        $owner = Get-PortOwner $port
        if ($owner) {
            Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
            Write-Host "released port $port (pid $owner)"
        }
    }
}

function Invoke-Game {
    if (-not (Test-Path (Join-Path $GameDir 'PGR.exe'))) { throw "PGR.exe not found in $GameDir" }
    if (-not (Get-Status).Sdk) { throw 'the server is not running; start it first.' }

    # The client's patched libraries read this to decide where requests go.
    $env:ASCNET_PATCH_ORIGIN = "http://127.0.0.1:$SdkPort"
    Write-Host "launching client with ASCNET_PATCH_ORIGIN=$($env:ASCNET_PATCH_ORIGIN)"
    Start-Process -FilePath (Join-Path $GameDir 'PGR.exe') -WorkingDirectory $GameDir
}

# ------------------------------------------------------------------ gui

function Show-Gui {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing

    $form = New-Object Windows.Forms.Form
    $form.Text = 'Selena-port · Control Center'
    $form.Size = New-Object Drawing.Size(560, 380)
    $form.StartPosition = 'CenterScreen'
    $form.BackColor = [Drawing.Color]::FromArgb(12, 14, 22)
    $form.ForeColor = [Drawing.Color]::FromArgb(233, 236, 245)
    $form.Font = New-Object Drawing.Font('Segoe UI', 9)

    $title = New-Object Windows.Forms.Label
    $title.Text = 'SELENA-PORT'
    $title.Font = New-Object Drawing.Font('Georgia', 15, [Drawing.FontStyle]::Bold)
    $title.ForeColor = [Drawing.Color]::FromArgb(212, 175, 55)
    $title.AutoSize = $true
    $title.Location = New-Object Drawing.Point(18, 14)
    $form.Controls.Add($title)

    $subtitle = New-Object Windows.Forms.Label
    $subtitle.Text = 'start mongod, the server and the panel; launch the patched client'
    $subtitle.AutoSize = $true
    $subtitle.ForeColor = [Drawing.Color]::FromArgb(163, 170, 192)
    $subtitle.Location = New-Object Drawing.Point(20, 46)
    $form.Controls.Add($subtitle)

    $statusBox = New-Object Windows.Forms.Label
    $statusBox.Font = New-Object Drawing.Font('Consolas', 9)
    $statusBox.AutoSize = $false
    $statusBox.Size = New-Object Drawing.Size(504, 58)
    $statusBox.Location = New-Object Drawing.Point(20, 74)
    $statusBox.ForeColor = [Drawing.Color]::FromArgb(210, 216, 232)
    $form.Controls.Add($statusBox)

    function New-Button([string]$text, [int]$x, [int]$y, [int]$w, [scriptblock]$onClick) {
        $button = New-Object Windows.Forms.Button
        $button.Text = $text
        $button.Size = New-Object Drawing.Size($w, 34)
        $button.Location = New-Object Drawing.Point($x, $y)
        $button.FlatStyle = 'Flat'
        $button.BackColor = [Drawing.Color]::FromArgb(22, 26, 41)
        $button.ForeColor = [Drawing.Color]::FromArgb(233, 236, 245)
        $button.FlatAppearance.BorderColor = [Drawing.Color]::FromArgb(46, 51, 71)
        $button.Add_Click($onClick)
        $form.Controls.Add($button)
        return $button
    }

    $logBox = New-Object Windows.Forms.TextBox
    $logBox.Multiline = $true
    $logBox.ReadOnly = $true
    $logBox.ScrollBars = 'Vertical'
    $logBox.Size = New-Object Drawing.Size(504, 120)
    $logBox.Location = New-Object Drawing.Point(20, 226)
    $logBox.BackColor = [Drawing.Color]::FromArgb(17, 20, 32)
    $logBox.ForeColor = [Drawing.Color]::FromArgb(163, 170, 192)
    $logBox.BorderStyle = 'FixedSingle'
    $form.Controls.Add($logBox)

    function Write-Log([string]$message) {
        $logBox.AppendText("$(Get-Date -Format HH:mm:ss)  $message`r`n")
    }

    function Update-Status {
        $state = Get-Status
        $mark = { param($up) if ($up) { 'UP  ' } else { 'down' } }
        $statusBox.Text = @(
            "mongodb  $( & $mark $state.Mongo )   :$MongoPort",
            "server   $( & $mark $state.Sdk )   sdk :$SdkPort   game :$GamePort",
            "panel    $( & $mark $state.Panel )   http://127.0.0.1:$PanelPort"
        ) -join "`r`n"
    }

    New-Button 'Prepare' 20 140 110 {
        try { Invoke-Prepare; Write-Log 'prepare finished' } catch { Write-Log "prepare failed: $_" }
        Update-Status
    } | Out-Null

    New-Button 'Start server' 138 140 120 {
        try { Invoke-Start | Out-Null; Write-Log 'stack started' } catch { Write-Log "start failed: $_" }
        Update-Status
    } | Out-Null

    New-Button 'Stop' 266 140 90 {
        try { Invoke-Stop | Out-Null; Write-Log 'stack stopped' } catch { Write-Log "stop failed: $_" }
        Update-Status
    } | Out-Null

    New-Button 'Launch client' 364 140 160 {
        try { Invoke-Game | Out-Null; Write-Log 'client launched' } catch { Write-Log "launch failed: $_" }
    } | Out-Null

    New-Button 'GM panel' 20 182 140 {
        Start-Process "http://127.0.0.1:$PanelPort/gm"
    } | Out-Null

    New-Button 'Player panel' 168 182 140 {
        Start-Process "http://127.0.0.1:$PanelPort/player"
    } | Out-Null

    New-Button 'Open logs' 316 182 208 {
        Start-Process explorer.exe $LogDir
    } | Out-Null

    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 2000
    $timer.Add_Tick({ Update-Status })
    $timer.Start()

    Update-Status
    Write-Log 'ready'
    [void]$form.ShowDialog()
}

switch ($Action) {
    'status' { Get-Status | Format-Table -AutoSize | Out-String | Write-Host }
    'prepare' { Invoke-Prepare }
    'start' { Invoke-Start }
    'stop' { Invoke-Stop }
    'game' { Invoke-Game }
    default { Show-Gui }
}