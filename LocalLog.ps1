# Copyright (c) 2026 Dominic Jäger
# SPDX-License-Identifier: MIT
#requires -Version 5.1

<#
.SYNOPSIS
    LocalLog - Lightweight, Local-First Project Time Tracker for Windows 10/11 (CSV Edition)
.DESCRIPTION
    Self-contained PowerShell 5.1 + WPF desktop time tracker using plain UTF-8 CSV files:
    - 100% local storage, zero network traffic, zero database drivers, zero registry writes
    - Zero C# compilation (100% pure PowerShell 5.1 + WPF/.NET) for maximum corporate security
    - Atomic CSV writes with automatic schema-upgrade backups
    - Project-only hierarchy (add, color-code, activate/deactivate)
    - Copyable TSV table view for Excel with formula-injection protection & optional internal EUR rates
    - Corner Breathing Status Orb, Lock/Unlock hook, 60s Mic call-end watcher, and 30-min WPF corner card
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ==============================================================================
# 1. APP METADATA & SINGLE-INSTANCE GUARD
# ==============================================================================
$Script:AppName = "LocalLog"
$Script:AppVersion = "1.2.0"
$Script:SchemaVersion = 1
$Script:Disclaimer = "Unofficial personal side project - not an official company-supported tool. Provided 'as is' without warranties, guarantees, or IT support. Please back up your local CSV files regularly."

$createdNew = $false
$Script:Mutex = New-Object System.Threading.Mutex($true, "Local\LocalLog_SingleInstance_Mutex", [ref]$createdNew)
if (-not $createdNew) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("LocalLog v$($Script:AppVersion) is already running in your system tray.", $Script:AppName, "OK", "Information") | Out-Null
    exit
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Script:CultureAT = [System.Globalization.CultureInfo]::GetCultureInfo("de-AT")
$Script:DataDir = Join-Path $env:LOCALAPPDATA "LocalLog"
if (-not (Test-Path $Script:DataDir)) { New-Item -ItemType Directory -Path $Script:DataDir -Force | Out-Null }

$Script:MetaCsv = Join-Path $Script:DataDir "meta.csv"
$Script:ProjectsCsv = Join-Path $Script:DataDir "projects.csv"
$Script:EntriesCsv = Join-Path $Script:DataDir "entries.csv"

# ==============================================================================
# 2. ATOMIC & FORWARD-COMPATIBLE CSV STORAGE ENGINE
# ==============================================================================
function Get-SafeProp {
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop -or $null -eq $prop.Value -or $prop.Value -eq "") { return $Default }
    return $prop.Value
}

function Protect-SpreadsheetCell {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return "" }
    # Prevent Excel formula injection if a note starts with =, +, -, or @
    if ($Text -match '^[=+\-@]') { return "'" + $Text }
    return ($Text -replace "`r|`n|`t", " ")
}

$Script:FileLockActive = $false
$Script:LockedFilePath = ""

function Show-FileLockBanner {
    param([string]$Path)
    $fileName = [System.IO.Path]::GetFileName($Path)
    $Script:FileLockActive = $true
    $Script:LockedFilePath = $Path

    if ($null -ne (Get-Variable -Name "BannerFileLock" -Scope Script -ErrorAction SilentlyContinue) -and $null -ne $Script:BannerFileLock) {
        $Script:TxtBannerFileLock.Text = "File locked: '$fileName' is currently open in Microsoft Excel or another program. Please save and close it in Excel so LocalLog can save your logs."
        $Script:BannerFileLock.Visibility = [System.Windows.Visibility]::Visible
    }

    if ($null -ne (Get-Variable -Name "MainWindow" -Scope Script -ErrorAction SilentlyContinue) -and $null -ne $Script:MainWindow) {
        if (-not $Script:MainWindow.IsVisible -and (Get-Command Show-CornerPromptCard -ErrorAction SilentlyContinue)) {
            Show-CornerPromptCard -Title "CSV File Locked in Excel" `
                -Message "'$fileName' is open in Excel. Close it in Excel so LocalLog can save your logs." `
                -PrimaryLabel "Open LocalLog" -PrimaryAction { Show-MainWindow } `
                -SecondaryLabel "Dismiss" -SecondaryAction { }
        }
    }
}

function Hide-FileLockBanner {
    if ($Script:FileLockActive) {
        $Script:FileLockActive = $false
        $Script:LockedFilePath = ""
        if ($null -ne (Get-Variable -Name "BannerFileLock" -Scope Script -ErrorAction SilentlyContinue) -and $null -ne $Script:BannerFileLock) {
            $Script:BannerFileLock.Visibility = [System.Windows.Visibility]::Collapsed
        }
    }
}

function Save-CsvAtomic {
    param(
        [Parameter(Mandatory)][string]$Path,
        [AllowEmptyCollection()][array]$Rows,
        [Parameter(Mandatory)][string[]]$Headers
    )
    $tmpPath = "$Path.tmp"
    if ($null -eq $Rows -or $Rows.Count -eq 0) {
        $headerLine = ($Headers | ForEach-Object { '"' + $_ + '"' }) -join ","
        [System.IO.File]::WriteAllText($tmpPath, $headerLine + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
    }
    else {
        $Rows | Select-Object -Property $Headers | Export-Csv -Path $tmpPath -NoTypeInformation -Encoding UTF8
    }

    $maxAttempts = 4
    $retryDelayMs = 250
    $success = $false

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            Move-Item -Path $tmpPath -Destination $Path -Force -ErrorAction Stop
            $success = $true
            break
        }
        catch [System.IO.IOException], [System.UnauthorizedAccessException] {
            if ($attempt -lt $maxAttempts) {
                Start-Sleep -Milliseconds $retryDelayMs
            }
        }
    }

    if ($success) {
        Hide-FileLockBanner
    }
    else {
        Show-FileLockBanner -Path $Path
    }
}


function Initialize-CsvStorage {
    $projHeaders = @("Id", "Name", "ColorHex", "HourlyRate", "IsActive", "CreatedAt")
    $entryHeaders = @("Id", "ProjectId", "ProjectName", "StartTime", "EndTime", "DurationSeconds", "Note")
    $metaHeaders = @("Key", "Value")

    $existingSchema = 0
    if (Test-Path $Script:MetaCsv) {
        $metaRows = @(Import-Csv -Path $Script:MetaCsv -Encoding UTF8)
        $schemaRow = $metaRows | Where-Object { (Get-SafeProp $_ "Key") -eq "SchemaVersion" } | Select-Object -First 1
        if ($schemaRow) { $existingSchema = [int](Get-SafeProp $schemaRow "Value" 0) }
    }

    # Automatic pre-upgrade backup when opening CSV files from an older schema version
    if ($existingSchema -gt 0 -and $existingSchema -lt $Script:SchemaVersion) {
        foreach ($f in @($Script:ProjectsCsv, $Script:EntriesCsv, $Script:MetaCsv)) {
            if (Test-Path $f) { Copy-Item -Path $f -Destination "$f.v$existingSchema.bak" -Force }
        }
    }

    if (-not (Test-Path $Script:ProjectsCsv)) {
        $nowIso = (Get-Date).ToString("o")
        $seedProjects = @(
            [PSCustomObject]@{ Id = "1"; Name = "Project Alpha"; ColorHex = "#0078D4"; HourlyRate = "85.0"; IsActive = "1"; CreatedAt = $nowIso },
            [PSCustomObject]@{ Id = "2"; Name = "Client Advisory & Workshops"; ColorHex = "#107C10"; HourlyRate = "95.0"; IsActive = "1"; CreatedAt = $nowIso },
            [PSCustomObject]@{ Id = "3"; Name = "General Operations & Admin"; ColorHex = "#8764B8"; HourlyRate = "75.0"; IsActive = "1"; CreatedAt = $nowIso }
        )
        Save-CsvAtomic -Path $Script:ProjectsCsv -Rows $seedProjects -Headers $projHeaders
    }

    if (-not (Test-Path $Script:EntriesCsv)) {
        Save-CsvAtomic -Path $Script:EntriesCsv -Rows @() -Headers $entryHeaders
    }

    $metaOut = @(
        [PSCustomObject]@{ Key = "AppName"; Value = $Script:AppName },
        [PSCustomObject]@{ Key = "AppVersion"; Value = $Script:AppVersion },
        [PSCustomObject]@{ Key = "SchemaVersion"; Value = "$($Script:SchemaVersion)" },
        [PSCustomObject]@{ Key = "LastStarted"; Value = (Get-Date).ToString("o") }
    )
    Save-CsvAtomic -Path $Script:MetaCsv -Rows $metaOut -Headers $metaHeaders
}

Initialize-CsvStorage

# ==============================================================================
# 4. APPLICATION STATE & CSV DATA OPERATIONS
# ==============================================================================
$Script:State = [hashtable]::Synchronized(@{
        IsRunning          = $false
        IsPaused           = $false
        ActiveProjectId    = $null
        ActiveProjectCache = $null
        ActiveEntryId      = $null
        SegmentStartTime   = $null
        AccumulatedSeconds = 0
        LastCheckInTime    = $null
        LastCheckpointTime = $null
        LastMicPollTime    = (Get-Date).AddSeconds(-60)
        MicPromptOpen      = $false
        WasMicInUse        = $false
        IncludeRatesInCopy = $false
    })

function Get-Projects {
    param([switch]$ActiveOnly)
    $raw = @(Import-Csv -Path $Script:ProjectsCsv -Encoding UTF8)
    $list = @()
    foreach ($r in $raw) {
        $isAct = ((Get-SafeProp $r "IsActive" "1") -eq "1")
        if ($ActiveOnly -and -not $isAct) { continue }
        $rateVal = 0.0
        [double]::TryParse((Get-SafeProp $r "HourlyRate" "0"), [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$rateVal) | Out-Null
        $list += [PSCustomObject]@{
            Id          = [int](Get-SafeProp $r "Id" 0)
            Name        = Get-SafeProp $r "Name" "Unnamed"
            ColorHex    = Get-SafeProp $r "ColorHex" "#0078D4"
            HourlyRate  = $rateVal
            RateDisplay = [string]::Format($Script:CultureAT, "€ {0:N2}/h", $rateVal)
            IsActive    = $isAct
            StatusLabel = if ($isAct) { "Active" } else { "Deactivated" }
            CreatedAt   = Get-SafeProp $r "CreatedAt" ""
        }
    }
    return @($list | Sort-Object @{Expression = "IsActive"; Descending = $true }, @{Expression = "Name"; Ascending = $true })
}

function Get-Entries {
    $projectsById = @{}
    foreach ($p in (Get-Projects)) { $projectsById[$p.Id] = $p }

    $raw = @(Import-Csv -Path $Script:EntriesCsv -Encoding UTF8)
    $list = @()
    foreach ($r in $raw) {
        $endStr = Get-SafeProp $r "EndTime" ""
        if ([string]::IsNullOrWhiteSpace($endStr)) { continue }

        $startDt = [DateTime]::Parse((Get-SafeProp $r "StartTime"))
        $endDt = [DateTime]::Parse($endStr)
        $secs = [int](Get-SafeProp $r "DurationSeconds" "0")
        $hours = [Math]::Round($secs / 3600.0, 2)
        $projId = [int](Get-SafeProp $r "ProjectId" "0")
        $proj = $projectsById[$projId]

        $pName = if ($proj) { $proj.Name } else { Get-SafeProp $r "ProjectName" "Unknown Project" }
        $rate = if ($proj) { $proj.HourlyRate } else { 0.0 }
        $valEur = [Math]::Round($hours * $rate, 2)

        $list += [PSCustomObject]@{
            Id              = [int](Get-SafeProp $r "Id" 0)
            StartSort       = $startDt
            DateDisplay     = $startDt.ToString("dd.MM.yyyy")
            TimeRange       = "$($startDt.ToString('HH:mm')) - $($endDt.ToString('HH:mm'))"
            ProjectName     = $pName
            DurationDisplay = [TimeSpan]::FromSeconds($secs).ToString("hh\:mm\:ss")
            HoursDecimal    = $hours
            HoursDisplay    = [string]::Format($Script:CultureAT, "{0:N2}", $hours)
            RateDisplay     = [string]::Format($Script:CultureAT, "€ {0:N2}/h", $rate)
            ValueDisplay    = [string]::Format($Script:CultureAT, "€ {0:N2}", $valEur)
            Note            = Get-SafeProp $r "Note" ""
        }
    }
    return @($list | Sort-Object -Property StartSort -Descending | Select-Object -First 250)
}

function Update-ActiveEntryCsv {
    param([int]$EntryId, [string]$EndTimeIso, [int]$DurationSeconds)
    if ($EntryId -le 0) { return }
    $entryHeaders = @("Id", "ProjectId", "ProjectName", "StartTime", "EndTime", "DurationSeconds", "Note")
    $raw = @(Import-Csv -Path $Script:EntriesCsv -Encoding UTF8)
    foreach ($r in $raw) {
        if ([int](Get-SafeProp $r "Id" 0) -eq $EntryId) {
            $r.DurationSeconds = "$DurationSeconds"
            if ($EndTimeIso) { $r.EndTime = $EndTimeIso }
            break
        }
    }
    Save-CsvAtomic -Path $Script:EntriesCsv -Rows $raw -Headers $entryHeaders
}

function Start-ProjectTimer {
    param([int]$ProjectId, [string]$Note = "")
    if ($Script:State.IsRunning -or $Script:State.IsPaused) {
        Stop-ProjectTimer
    }

    $proj = Get-Projects | Where-Object { $_.Id -eq $ProjectId } | Select-Object -First 1
    if (-not $proj) { return }

    $entryHeaders = @("Id", "ProjectId", "ProjectName", "StartTime", "EndTime", "DurationSeconds", "Note")
    $raw = @(Import-Csv -Path $Script:EntriesCsv -Encoding UTF8)
    $maxId = 0
    foreach ($r in $raw) {
        $rid = [int](Get-SafeProp $r "Id" 0)
        if ($rid -gt $maxId) { $maxId = $rid }
    }
    $newId = $maxId + 1
    $now = Get-Date

    $newRow = [PSCustomObject]@{
        Id              = "$newId"
        ProjectId       = "$($proj.Id)"
        ProjectName     = $proj.Name
        StartTime       = $now.ToString("o")
        EndTime         = ""
        DurationSeconds = "0"
        Note            = ($Note -replace "`r|`n", " ")
    }
    $raw += $newRow
    Save-CsvAtomic -Path $Script:EntriesCsv -Rows $raw -Headers $entryHeaders

    $Script:State.ActiveEntryId = $newId
    $Script:State.ActiveProjectId = $proj.Id
    $Script:State.ActiveProjectCache = $proj
    $Script:State.SegmentStartTime = $now
    $Script:State.AccumulatedSeconds = 0
    $Script:State.LastCheckInTime = $now
    $Script:State.LastCheckpointTime = $now
    $Script:State.IsRunning = $true
    $Script:State.IsPaused = $false
    Update-AllVisuals
    Refresh-UiData
}

function Pause-ProjectTimer {
    if (-not $Script:State.IsRunning) { return }
    $elapsed = [int]((Get-Date) - $Script:State.SegmentStartTime).TotalSeconds
    $Script:State.AccumulatedSeconds += [Math]::Max(0, $elapsed)
    $Script:State.IsRunning = $false
    $Script:State.IsPaused = $true
    Update-ActiveEntryCsv -EntryId $Script:State.ActiveEntryId -EndTimeIso "" -DurationSeconds $Script:State.AccumulatedSeconds
    Update-AllVisuals
}

function Resume-ProjectTimer {
    if (-not $Script:State.IsPaused -or -not $Script:State.ActiveProjectId) { return }
    $now = Get-Date
    $Script:State.SegmentStartTime = $now
    $Script:State.LastCheckInTime = $now
    $Script:State.LastCheckpointTime = $now
    $Script:State.IsRunning = $true
    $Script:State.IsPaused = $false
    Update-AllVisuals
}

function Stop-ProjectTimer {
    param([int]$AdjustSeconds = 0)
    if (-not $Script:State.IsRunning -and -not $Script:State.IsPaused) { return }
    $totalSecs = $Script:State.AccumulatedSeconds
    if ($Script:State.IsRunning -and $Script:State.SegmentStartTime) {
        $totalSecs += [int]((Get-Date) - $Script:State.SegmentStartTime).TotalSeconds
    }
    $totalSecs = [Math]::Max(1, $totalSecs + $AdjustSeconds)
    Update-ActiveEntryCsv -EntryId $Script:State.ActiveEntryId -EndTimeIso (Get-Date).ToString("o") -DurationSeconds $totalSecs

    $Script:State.IsRunning = $false
    $Script:State.IsPaused = $false
    $Script:State.ActiveEntryId = $null
    $Script:State.ActiveProjectCache = $null
    $Script:State.SegmentStartTime = $null
    $Script:State.AccumulatedSeconds = 0
    $Script:State.LastCheckInTime = $null
    $Script:State.LastCheckpointTime = $null
    Update-AllVisuals
    Refresh-UiData
}

function Get-CurrentElapsedSeconds {
    $secs = $Script:State.AccumulatedSeconds
    if ($Script:State.IsRunning -and $Script:State.SegmentStartTime) {
        $secs += [int]((Get-Date) - $Script:State.SegmentStartTime).TotalSeconds
    }
    return [Math]::Max(0, $secs)
}

function Recover-UnclosedEntries {
    $entryHeaders = @("Id", "ProjectId", "ProjectName", "StartTime", "EndTime", "DurationSeconds", "Note")
    $raw = @(Import-Csv -Path $Script:EntriesCsv -Encoding UTF8)
    $dirty = $false
    foreach ($r in $raw) {
        if ([string]::IsNullOrWhiteSpace((Get-SafeProp $r "EndTime" ""))) {
            $startDt = [DateTime]::Parse((Get-SafeProp $r "StartTime"))
            $savedSecs = [int](Get-SafeProp $r "DurationSeconds" "60")
            if ($savedSecs -lt 60) { $savedSecs = 60 }
            $r.DurationSeconds = "$savedSecs"
            $r.EndTime = $startDt.AddSeconds($savedSecs).ToString("o")
            $dirty = $true
        }
    }
    if ($dirty) {
        Save-CsvAtomic -Path $Script:EntriesCsv -Rows $raw -Headers $entryHeaders
    }
}

Recover-UnclosedEntries

# ==============================================================================
# 4. AMBIENT STATUS OVERLAY (BREATHING CORNER ORB - PURE WPF)
# ==============================================================================
$workArea = [System.Windows.SystemParameters]::WorkArea

# 16x16 Corner Breathing Status Orb (pure WPF)
$orbLeft = $workArea.Right - 26
$orbTop = $workArea.Bottom - 26
[xml]$orbXaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" Cursor="Hand"
        Left="$orbLeft" Top="$orbTop" Width="18" Height="18"
        ToolTip="LocalLog v$($Script:AppVersion) - Click to open">
    <Grid>
        <Ellipse x:Name="OrbDot" Width="12" Height="12" Fill="#F59E0B" Stroke="#FFFFFF" StrokeThickness="1.5">
            <Ellipse.Effect>
                <DropShadowEffect BlurRadius="6" ShadowDepth="0" Color="#88000000"/>
            </Ellipse.Effect>
        </Ellipse>
    </Grid>
</Window>
"@
$Script:OrbWindow = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $orbXaml))
$Script:OrbDot = $Script:OrbWindow.FindName("OrbDot")
$Script:OrbWindow.Add_MouseLeftButtonUp({ Show-MainWindow })
$Script:OrbWindow.Show()

# Recalculate overlay positions when docking/undocking or changing display resolution
$Script:DisplayHandler = [System.EventHandler] {
    $wa = [System.Windows.SystemParameters]::WorkArea
    $Script:OrbWindow.Left = $wa.Right - 26
    $Script:OrbWindow.Top = $wa.Bottom - 26
}
[Microsoft.Win32.SystemEvents]::add_DisplaySettingsChanged($Script:DisplayHandler)

# ==============================================================================
# 6. MAIN WPF WINDOW (FLUENT-INSPIRED UI, COPYABLE TABLE, PROJECTS, DISCLAIMER)
# ==============================================================================
[xml]$mainXaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="$($Script:AppName) v$($Script:AppVersion)"
        Width="740" Height="560" WindowStartupLocation="CenterScreen"
        Background="#F3F3F3" Foreground="#1B1B1B" FontFamily="Segoe UI">
    <Grid Margin="14">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <!-- Header -->
        <DockPanel Grid.Row="0" Margin="0,0,0,10">
            <StackPanel Orientation="Horizontal" DockPanel.Dock="Left" VerticalAlignment="Center">
                <TextBlock Text="LocalLog" FontSize="18" FontWeight="SemiBold"/>
                <Border Background="#E5E7EB" CornerRadius="4" Padding="6,2" Margin="8,0,0,0" VerticalAlignment="Center">
                    <TextBlock Text="v$($Script:AppVersion)" FontSize="11" Foreground="#4B5563" FontWeight="SemiBold"/>
                </Border>
                <TextBlock Text="100% Local CSV Storage (AT / EUR)" FontSize="12" Foreground="#6B7280" Margin="10,0,0,0" VerticalAlignment="Center"/>
            </StackPanel>
            <TextBlock x:Name="TxtTodaySummary" DockPanel.Dock="Right" HorizontalAlignment="Right" VerticalAlignment="Center"
                       FontSize="12" FontWeight="SemiBold" Foreground="#374151" Text="Today: 0,00 h"/>
        </DockPanel>

        <!-- Active Timer Control Card -->
        <Border Grid.Row="1" Background="#FFFFFF" BorderBrush="#E5E7EB" BorderThickness="1" CornerRadius="8" Padding="14" Margin="0,0,0,10">
            <Grid>
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="Auto"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>

                <StackPanel Grid.Column="0" VerticalAlignment="Center" Margin="0,0,16,0">
                    <TextBlock x:Name="TxtStopwatch" Text="00:00:00" FontSize="28" FontWeight="Bold" FontFamily="Consolas" Foreground="#111827"/>
                    <TextBlock x:Name="TxtActiveRateHint" Text="No timer active" FontSize="11" Foreground="#6B7280"/>
                </StackPanel>

                <StackPanel Grid.Column="1" VerticalAlignment="Center" Margin="0,0,12,0">
                    <ComboBox x:Name="CmbActiveProjects" DisplayMemberPath="Name" SelectedValuePath="Id" Height="30" FontSize="13"/>
                    <TextBox x:Name="TxtQuickNote" Height="26" Margin="0,6,0,0" Padding="6,3" FontSize="12"
                             ToolTip="Optional brief note for this block"/>
                </StackPanel>

                <StackPanel Grid.Column="2" Orientation="Horizontal" VerticalAlignment="Center">
                    <Button x:Name="BtnStartPause" Content="Start" Width="84" Height="34" Margin="0,0,6,0"
                            Background="#0078D4" Foreground="#FFFFFF" FontWeight="SemiBold" BorderThickness="0"/>
                    <Button x:Name="BtnStop" Content="Stop &amp; Log" Width="88" Height="34" IsEnabled="False"
                            Background="#E5E7EB" Foreground="#1F2937" FontWeight="SemiBold" BorderThickness="0"/>
                </StackPanel>
            </Grid>
        </Border>

        <!-- Excel File-Lock Warning Banner -->
        <Border x:Name="BannerFileLock" Grid.Row="2" Background="#FEF2F2" BorderBrush="#F87171"
                BorderThickness="1" CornerRadius="6" Padding="10,8" Margin="0,0,0,10" Visibility="Collapsed">
            <DockPanel>
                <TextBlock Text="[!] " FontSize="13" FontWeight="Bold" Foreground="#DC2626" VerticalAlignment="Center" Margin="0,0,4,0"/>
                <StackPanel Orientation="Horizontal" DockPanel.Dock="Right" VerticalAlignment="Center">
                    <Button x:Name="BtnRetryFileLock" Content="Retry Save" Padding="8,3" Margin="0,0,8,0"
                            Background="#DC2626" Foreground="#FFFFFF" FontSize="11" FontWeight="SemiBold" BorderThickness="0" Cursor="Hand"/>
                    <Button x:Name="BtnDismissFileLock" Content="X" Width="20" Height="20"
                            Background="Transparent" BorderThickness="0" Foreground="#991B1B"
                            FontWeight="Bold" Cursor="Hand" ToolTip="Dismiss warning"/>
                </StackPanel>
                <TextBlock x:Name="TxtBannerFileLock"
                           Text="File locked: A CSV file is open in Microsoft Excel or another program. Please save and close it in Excel so LocalLog can save your changes."
                           FontSize="12" Foreground="#991B1B" TextWrapping="Wrap" VerticalAlignment="Center"/>
            </DockPanel>
        </Border>

        <!-- Tabs: Copyable Entries Table | Projects | About & Disclaimer -->
        <TabControl Grid.Row="3" Background="#FFFFFF" BorderBrush="#E5E7EB">
            <!-- TAB 1: Entries Table -->
            <TabItem Header="Entries (Copy Table)">
                <Grid Margin="10">
                    <Grid.RowDefinitions>
                        <RowDefinition Height="Auto"/>
                        <RowDefinition Height="*"/>
                    </Grid.RowDefinitions>
                    <DockPanel Grid.Row="0" Margin="0,0,0,8">
                        <StackPanel Orientation="Horizontal" DockPanel.Dock="Left">
                            <Button x:Name="BtnCopyTsv" Content="Copy Table for Excel" Padding="12,5"
                                    Background="#107C10" Foreground="#FFFFFF" FontWeight="SemiBold" BorderThickness="0"/>
                            <CheckBox x:Name="ChkIncludeRates" Content="Include internal EUR rate &amp; value columns"
                                      VerticalAlignment="Center" Margin="12,0,0,0" FontSize="11" Foreground="#6B7280"/>
                        </StackPanel>
                        <TextBlock x:Name="TxtCopyFeedback" DockPanel.Dock="Right" HorizontalAlignment="Right"
                                   VerticalAlignment="Center" FontSize="11" Foreground="#107C10" FontWeight="SemiBold"/>
                    </DockPanel>

                    <DataGrid x:Name="GridEntries" Grid.Row="1" AutoGenerateColumns="False" IsReadOnly="True"
                              SelectionMode="Extended" SelectionUnit="CellOrRowHeader"
                              GridLinesVisibility="Horizontal" HorizontalGridLinesBrush="#F3F4F6"
                              HeadersVisibility="Column" RowHeight="28" FontSize="12">
                        <DataGrid.Columns>
                            <DataGridTextColumn Header="Date" Binding="{Binding DateDisplay}" Width="88"/>
                            <DataGridTextColumn Header="Time" Binding="{Binding TimeRange}" Width="96"/>
                            <DataGridTextColumn Header="Project / Work Block" Binding="{Binding ProjectName}" Width="180"/>
                            <DataGridTextColumn Header="Duration" Binding="{Binding DurationDisplay}" Width="76"/>
                            <DataGridTextColumn Header="Hours (h)" Binding="{Binding HoursDisplay}" Width="72"/>
                            <DataGridTextColumn x:Name="ColRate" Header="Rate (EUR/h)" Binding="{Binding RateDisplay}" Width="84" Visibility="Collapsed">
                                <DataGridTextColumn.ElementStyle>
                                    <Style TargetType="TextBlock">
                                        <Setter Property="Foreground" Value="#9CA3AF"/>
                                        <Setter Property="FontSize" Value="11"/>
                                    </Style>
                                </DataGridTextColumn.ElementStyle>
                            </DataGridTextColumn>
                            <DataGridTextColumn x:Name="ColValue" Header="Value (EUR)" Binding="{Binding ValueDisplay}" Width="84" Visibility="Collapsed">
                                <DataGridTextColumn.ElementStyle>
                                    <Style TargetType="TextBlock">
                                        <Setter Property="Foreground" Value="#9CA3AF"/>
                                        <Setter Property="FontSize" Value="11"/>
                                    </Style>
                                </DataGridTextColumn.ElementStyle>
                            </DataGridTextColumn>
                            <DataGridTextColumn Header="Note" Binding="{Binding Note}" Width="*"/>
                        </DataGrid.Columns>
                    </DataGrid>
                </Grid>
            </TabItem>

            <!-- TAB 2: Projects Management -->
            <TabItem Header="Projects">
                <Grid Margin="10">
                    <Grid.RowDefinitions>
                        <RowDefinition Height="Auto"/>
                        <RowDefinition Height="*"/>
                    </Grid.RowDefinitions>

                    <!-- Add Project Bar -->
                    <StackPanel Grid.Row="0" Orientation="Horizontal" Margin="0,0,0,10">
                        <TextBox x:Name="TxtNewProjectName" Width="210" Height="28" Padding="6,4" Margin="0,0,6,0" ToolTip="Project or work category name"/>
                        <ComboBox x:Name="CmbNewProjectColor" Width="110" Height="28" Margin="0,0,6,0" SelectedIndex="0">
                            <ComboBoxItem Content="Blue" Tag="#0078D4"/>
                            <ComboBoxItem Content="Green" Tag="#107C10"/>
                            <ComboBoxItem Content="Purple" Tag="#8764B8"/>
                            <ComboBoxItem Content="Teal" Tag="#038387"/>
                            <ComboBoxItem Content="Orange" Tag="#CA5010"/>
                            <ComboBoxItem Content="Crimson" Tag="#C50F1F"/>
                        </ComboBox>
                        <TextBox x:Name="TxtNewProjectRate" Width="70" Height="28" Padding="6,4" Margin="0,0,4,0" Text="85,00"
                                 Foreground="#6B7280" ToolTip="Subtle internal rate in EUR/h"/>
                        <TextBlock Text="EUR/h" VerticalAlignment="Center" FontSize="11" Foreground="#9CA3AF" Margin="0,0,10,0"/>
                        <Button x:Name="BtnAddProject" Content="Add Project" Padding="12,4" Height="28"
                                Background="#0078D4" Foreground="#FFFFFF" FontWeight="SemiBold" BorderThickness="0"/>
                    </StackPanel>

                    <DataGrid x:Name="GridProjects" Grid.Row="1" AutoGenerateColumns="False" IsReadOnly="True"
                              HeadersVisibility="Column" RowHeight="32" FontSize="12" GridLinesVisibility="Horizontal" HorizontalGridLinesBrush="#F3F4F6">
                        <DataGrid.Columns>
                            <DataGridTextColumn Header="Project / Work Block" Binding="{Binding Name}" Width="240"/>
                            <DataGridTextColumn Header="Color" Binding="{Binding ColorHex}" Width="80"/>
                            <DataGridTextColumn Header="Internal Rate" Binding="{Binding RateDisplay}" Width="105">
                                <DataGridTextColumn.ElementStyle>
                                    <Style TargetType="TextBlock">
                                        <Setter Property="Foreground" Value="#9CA3AF"/>
                                        <Setter Property="FontSize" Value="11"/>
                                    </Style>
                                </DataGridTextColumn.ElementStyle>
                            </DataGridTextColumn>
                            <DataGridTextColumn Header="Status" Binding="{Binding StatusLabel}" Width="95"/>
                            <DataGridTemplateColumn Header="Actions" Width="*">
                                <DataGridTemplateColumn.CellTemplate>
                                    <DataTemplate>
                                        <StackPanel Orientation="Horizontal">
                                            <Button Content="Toggle Active" Padding="8,2" Margin="0,0,6,0" FontSize="11"
                                                    CommandParameter="Toggle" Tag="{Binding Id}"/>
                                            <Button Content="Delete" Padding="8,2" FontSize="11" Foreground="#B91C1C"
                                                    CommandParameter="Delete" Tag="{Binding Id}"/>
                                        </StackPanel>
                                    </DataTemplate>
                                </DataGridTemplateColumn.CellTemplate>
                            </DataGridTemplateColumn>
                        </DataGrid.Columns>
                    </DataGrid>
                </Grid>
            </TabItem>

            <!-- TAB 3: Version, Privacy & Disclaimer -->
            <TabItem Header="About &amp; Disclaimer">
                <StackPanel Margin="14">
                    <TextBlock Text="Version, Privacy &amp; Local CSV Storage" FontSize="14" FontWeight="SemiBold" Margin="0,0,0,6"/>
                    <TextBlock x:Name="TxtVersionDetails" FontSize="12" Foreground="#374151" Margin="0,0,0,12"/>

                    <Border Background="#FEF3C7" BorderBrush="#F59E0B" BorderThickness="1" CornerRadius="6" Padding="12" Margin="0,0,0,12">
                        <StackPanel>
                            <TextBlock Text="Unofficial Personal Tool &amp; No-Warranty Disclaimer" FontSize="13" FontWeight="SemiBold" Foreground="#92400E" Margin="0,0,0,4"/>
                            <TextBlock Text="$($Script:Disclaimer)" TextWrapping="Wrap" FontSize="12" Foreground="#78350F"/>
                        </StackPanel>
                    </Border>

                    <Button x:Name="BtnBackupCsv" Content="Create Manual CSV Backup Now" Width="230" HorizontalAlignment="Left"
                            Padding="10,6" Background="#E5E7EB" Foreground="#1F2937" FontWeight="SemiBold" BorderThickness="0"/>
                </StackPanel>
            </TabItem>
        </TabControl>

        <!-- Persistent Subtle Disclaimer Footer -->
        <DockPanel Grid.Row="4" Margin="0,8,0,0">
            <TextBlock DockPanel.Dock="Left" FontSize="10.5" Foreground="#6B7280"
                       Text="Unofficial personal project (MIT License) - 100% local CSV, provided as-is without warranties."/>
            <TextBlock DockPanel.Dock="Right" HorizontalAlignment="Right" FontSize="10.5" Foreground="#9CA3AF"
                       Text="LocalLog v$($Script:AppVersion) | Schema v$($Script:SchemaVersion)"/>
        </DockPanel>
    </Grid>
</Window>
"@

$Script:MainWindow = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $mainXaml))
$Script:TxtStopwatch = $Script:MainWindow.FindName("TxtStopwatch")
$Script:TxtActiveRateHint = $Script:MainWindow.FindName("TxtActiveRateHint")
$Script:TxtTodaySummary = $Script:MainWindow.FindName("TxtTodaySummary")
$Script:CmbActiveProjects = $Script:MainWindow.FindName("CmbActiveProjects")
$Script:TxtQuickNote = $Script:MainWindow.FindName("TxtQuickNote")
$Script:BtnStartPause = $Script:MainWindow.FindName("BtnStartPause")
$Script:BtnStop = $Script:MainWindow.FindName("BtnStop")
$Script:BtnCopyTsv = $Script:MainWindow.FindName("BtnCopyTsv")
$Script:ChkIncludeRates = $Script:MainWindow.FindName("ChkIncludeRates")
$Script:TxtCopyFeedback = $Script:MainWindow.FindName("TxtCopyFeedback")
$Script:GridEntries = $Script:MainWindow.FindName("GridEntries")
$Script:ColRate = $Script:MainWindow.FindName("ColRate")
$Script:ColValue = $Script:MainWindow.FindName("ColValue")
$Script:TxtNewProjectName = $Script:MainWindow.FindName("TxtNewProjectName")
$Script:CmbNewProjectColor = $Script:MainWindow.FindName("CmbNewProjectColor")
$Script:TxtNewProjectRate = $Script:MainWindow.FindName("TxtNewProjectRate")
$Script:BtnAddProject = $Script:MainWindow.FindName("BtnAddProject")
$Script:GridProjects = $Script:MainWindow.FindName("GridProjects")
$Script:TxtVersionDetails = $Script:MainWindow.FindName("TxtVersionDetails")
$Script:BtnBackupCsv = $Script:MainWindow.FindName("BtnBackupCsv")
$Script:BannerFileLock = $Script:MainWindow.FindName("BannerFileLock")
$Script:TxtBannerFileLock = $Script:MainWindow.FindName("TxtBannerFileLock")
$Script:BtnDismissFileLock = $Script:MainWindow.FindName("BtnDismissFileLock")
$Script:BtnRetryFileLock = $Script:MainWindow.FindName("BtnRetryFileLock")

$Script:BtnDismissFileLock.Add_Click({
    $Script:BannerFileLock.Visibility = [System.Windows.Visibility]::Collapsed
})

$Script:BtnRetryFileLock.Add_Click({
    if ($Script:LockedFilePath -and (Test-Path "$($Script:LockedFilePath).tmp")) {
        try {
            Move-Item -Path "$($Script:LockedFilePath).tmp" -Destination $Script:LockedFilePath -Force -ErrorAction Stop
            Hide-FileLockBanner
            Refresh-UiData
        }
        catch {
            $fName = [System.IO.Path]::GetFileName($Script:LockedFilePath)
            $Script:TxtBannerFileLock.Text = "Still locked: '$fName' is still open in Excel or another program. Please save and close it in Excel first, then click Retry Save."
        }
    }
    else {
        Hide-FileLockBanner
    }
})

if ($Script:FileLockActive -and $Script:LockedFilePath) {
    Show-FileLockBanner -Path $Script:LockedFilePath
}

$Script:TxtVersionDetails.Text = "Application: LocalLog v$($Script:AppVersion) (MIT License)`nArchitecture: Pure PowerShell 5.1 + WPF (Zero C# Compilation)`nCSV Schema Version: v$($Script:SchemaVersion)`nMic Check Interval: 60 seconds`nNetwork Activity: None (100% offline / local-first)`nStorage Folder: $($Script:DataDir)"

function Show-MainWindow {
    Refresh-UiData
    $Script:MainWindow.Show()
    if ($Script:MainWindow.WindowState -eq "Minimized") { $Script:MainWindow.WindowState = "Normal" }
    $Script:MainWindow.Activate() | Out-Null
}

$Script:MainWindow.Add_Closing({
        param($sender, $e)
        if (-not $Script:ForceExit) {
            $e.Cancel = $true
            $Script:MainWindow.Hide()
        }
    })

# ==============================================================================
# 7. WPF CORNER CARDS (30-MIN CHECK-IN, IDLE RETURN, MIC CALL-END, UNLOCK)
# ==============================================================================
function Show-CornerPromptCard {
    param(
        [string]$Title,
        [string]$Message,
        [string]$PrimaryLabel,
        [scriptblock]$PrimaryAction,
        [string]$SecondaryLabel,
        [scriptblock]$SecondaryAction
    )

    $wa = [System.Windows.SystemParameters]::WorkArea
    $cardLeft = $wa.Right - 340
    $cardTop = $wa.Bottom - 165

    [xml]$cardXaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" Left="$cardLeft" Top="$cardTop" Width="326" Height="132">
    <Border Background="#FFFFFF" BorderBrush="#D1D5DB" BorderThickness="1" CornerRadius="10" Padding="12">
        <Border.Effect>
            <DropShadowEffect BlurRadius="14" ShadowDepth="3" Opacity="0.22"/>
        </Border.Effect>
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="*"/>
                <RowDefinition Height="Auto"/>
            </Grid.RowDefinitions>
            <DockPanel Grid.Row="0">
                <TextBlock Text="$Title" FontWeight="SemiBold" FontSize="13" Foreground="#111827"/>
                <Button x:Name="BtnDismissCard" Content="X" DockPanel.Dock="Right" HorizontalAlignment="Right"
                        Width="20" Height="20" Background="Transparent" BorderThickness="0" Foreground="#6B7280"/>
            </DockPanel>
            <TextBlock Grid.Row="1" Text="$Message" TextWrapping="Wrap" FontSize="12" Foreground="#374151" Margin="0,6,0,8"/>
            <StackPanel Grid.Row="2" Orientation="Horizontal" HorizontalAlignment="Right">
                <Button x:Name="BtnCardSecondary" Content="$SecondaryLabel" Padding="10,4" Margin="0,0,6,0"
                        Background="#E5E7EB" Foreground="#1F2937" FontSize="11.5" BorderThickness="0"/>
                <Button x:Name="BtnCardPrimary" Content="$PrimaryLabel" Padding="10,4"
                        Background="#0078D4" Foreground="#FFFFFF" FontSize="11.5" FontWeight="SemiBold" BorderThickness="0"/>
            </StackPanel>
        </Grid>
    </Border>
</Window>
"@
    $cardWin = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $cardXaml))
    $btn1 = $cardWin.FindName("BtnCardPrimary")
    $btn2 = $cardWin.FindName("BtnCardSecondary")
    $btnX = $cardWin.FindName("BtnDismissCard")

    $autoClose = New-Object System.Windows.Threading.DispatcherTimer
    $autoClose.Interval = [TimeSpan]::FromSeconds(25)
    $autoClose.Add_Tick({ $autoClose.Stop(); $cardWin.Close() })

    $btn1.Add_Click({ $autoClose.Stop(); $cardWin.Close(); & $PrimaryAction })
    $btn2.Add_Click({ $autoClose.Stop(); $cardWin.Close(); & $SecondaryAction })
    $btnX.Add_Click({ $autoClose.Stop(); $cardWin.Close() })

    $autoClose.Start()
    $cardWin.Show()
}

# ==============================================================================
# 8. UI REFRESH, VISUAL SYNC & EVENT WIRING
# ==============================================================================
function Refresh-UiData {
    $activeProjects = @(Get-Projects -ActiveOnly)
    $allProjects = @(Get-Projects)
    $entries = @(Get-Entries)

    $prevSelected = $Script:CmbActiveProjects.SelectedValue
    $Script:CmbActiveProjects.ItemsSource = $activeProjects
    if ($Script:State.ActiveProjectId) {
        $Script:CmbActiveProjects.SelectedValue = $Script:State.ActiveProjectId
    }
    elseif ($prevSelected) {
        $Script:CmbActiveProjects.SelectedValue = $prevSelected
    }
    elseif ($activeProjects.Count -gt 0) {
        $Script:CmbActiveProjects.SelectedIndex = 0
    }

    $Script:GridProjects.ItemsSource = $allProjects
    $Script:GridEntries.ItemsSource = $entries

    $todayStr = (Get-Date).ToString("dd.MM.yyyy")
    $todayHours = 0.0
    foreach ($e in $entries) {
        if ($e.DateDisplay -eq $todayStr) { $todayHours += $e.HoursDecimal }
    }
    $Script:TxtTodaySummary.Text = [string]::Format($Script:CultureAT, "Today ($todayStr): {0:N2} h", $todayHours)
}

$Script:TrayIconCache = @{}
$Script:CurrentTrayIconKey = ""

function Get-ProjectTrayIcon {
    param(
        [string]$ColorHex,
        [string]$Mode # "running", "paused", "idle"
    )
    if ([string]::IsNullOrWhiteSpace($ColorHex)) { $ColorHex = "#9CA3AF" }
    $cacheKey = "$Mode`_$ColorHex"
    if ($Script:TrayIconCache.ContainsKey($cacheKey)) {
        return $Script:TrayIconCache[$cacheKey]
    }

    $bmp = New-Object System.Drawing.Bitmap 16, 16
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    try {
        $baseColor = [System.Drawing.ColorTranslator]::FromHtml($ColorHex)
    }
    catch {
        $baseColor = [System.Drawing.Color]::FromArgb(0, 120, 212)
    }

    if ($Mode -eq "running") {
        # Solid project-colored disc with subtle white border and small center highlight
        $brush = New-Object System.Drawing.SolidBrush $baseColor
        $g.FillEllipse($brush, 1, 1, 14, 14)
        $brush.Dispose()

        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 255, 255, 255), 1.0)
        $g.DrawEllipse($pen, 1, 1, 14, 14)
        $pen.Dispose()

        # Small white center dot
        $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $g.FillEllipse($dotBrush, 6, 6, 4, 4)
        $dotBrush.Dispose()
    }
    elseif ($Mode -eq "paused") {
        # Amber disc with pause bars
        $amber = [System.Drawing.Color]::FromArgb(245, 158, 11)
        $brush = New-Object System.Drawing.SolidBrush $amber
        $g.FillEllipse($brush, 1, 1, 14, 14)
        $brush.Dispose()

        # Two white vertical pause stripes
        $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $g.FillRectangle($whiteBrush, 5, 4, 2, 8)
        $g.FillRectangle($whiteBrush, 9, 4, 2, 8)
        $whiteBrush.Dispose()
    }
    else {
        # Idle: neutral hollow ring with subtle dot
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 156, 163, 175), 1.6)
        $g.DrawEllipse($pen, 2, 2, 12, 12)
        $pen.Dispose()

        $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 245, 158, 11))
        $g.FillEllipse($dotBrush, 6, 6, 4, 4)
        $dotBrush.Dispose()
    }

    $g.Dispose()
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $Script:TrayIconCache[$cacheKey] = $icon
    return $icon
}

function Update-AllVisuals {
    $elapsed = Get-CurrentElapsedSeconds
    $ts = [TimeSpan]::FromSeconds($elapsed)
    $Script:TxtStopwatch.Text = $ts.ToString("hh\:mm\:ss")

    $activeProj = $Script:State.ActiveProjectCache
    $brushConverter = New-Object System.Windows.Media.BrushConverter

    if ($Script:State.IsRunning -and $activeProj) {
        $projBrush = $brushConverter.ConvertFromString($activeProj.ColorHex)
        $Script:OrbDot.Fill = $projBrush
        $Script:OrbDot.Opacity = 1.0
        $Script:BtnStartPause.Content = "Pause"
        $Script:BtnStop.IsEnabled = $true
        $Script:TxtActiveRateHint.Text = "$($activeProj.Name)  •  Internal rate: $($activeProj.RateDisplay)"
        $tip = "LocalLog v$($Script:AppVersion) | $($ts.ToString('hh\:mm\:ss')) - $($activeProj.Name)"
        if ($null -ne $Script:TrayIcon) {
            $Script:TrayIcon.Text = $tip.Substring(0, [Math]::Min(63, $tip.Length))
            $iconKey = "running_$($activeProj.ColorHex)"
            if ($Script:CurrentTrayIconKey -ne $iconKey) {
                $Script:TrayIcon.Icon = Get-ProjectTrayIcon -ColorHex $activeProj.ColorHex -Mode "running"
                $Script:CurrentTrayIconKey = $iconKey
            }
        }
    }
    elseif ($Script:State.IsPaused -and $activeProj) {
        $amberBrush = $brushConverter.ConvertFromString("#F59E0B")
        $Script:OrbDot.Fill = $amberBrush
        $Script:OrbDot.Opacity = 0.85
        $Script:BtnStartPause.Content = "Resume"
        $Script:BtnStop.IsEnabled = $true
        $Script:TxtActiveRateHint.Text = "Paused: $($activeProj.Name)"
        if ($null -ne $Script:TrayIcon) {
            $Script:TrayIcon.Text = "LocalLog v$($Script:AppVersion) | Paused"
            $iconKey = "paused_$($activeProj.ColorHex)"
            if ($Script:CurrentTrayIconKey -ne $iconKey) {
                $Script:TrayIcon.Icon = Get-ProjectTrayIcon -ColorHex $activeProj.ColorHex -Mode "paused"
                $Script:CurrentTrayIconKey = $iconKey
            }
        }
    }
    else {
        $pulse = 0.35 + 0.55 * [Math]::Abs([Math]::Sin((Get-Date).TimeOfDay.TotalSeconds * 1.4))
        $idleBrush = $brushConverter.ConvertFromString("#F59E0B")
        $Script:OrbDot.Fill = $idleBrush
        $Script:OrbDot.Opacity = $pulse
        $Script:BtnStartPause.Content = "Start"
        $Script:BtnStop.IsEnabled = $false
        $Script:TxtActiveRateHint.Text = "No timer active"
        if ($null -ne $Script:TrayIcon) {
            $Script:TrayIcon.Text = "LocalLog v$($Script:AppVersion) | Idle"
            $iconKey = "idle"
            if ($Script:CurrentTrayIconKey -ne $iconKey) {
                $Script:TrayIcon.Icon = Get-ProjectTrayIcon -ColorHex "#9CA3AF" -Mode "idle"
                $Script:CurrentTrayIconKey = $iconKey
            }
        }
    }
}

$Script:BtnStartPause.Add_Click({
        if ($Script:State.IsRunning) {
            Pause-ProjectTimer
        }
        elseif ($Script:State.IsPaused) {
            Resume-ProjectTimer
        }
        else {
            $projId = $Script:CmbActiveProjects.SelectedValue
            if ($projId) { Start-ProjectTimer -ProjectId ([int]$projId) -Note $Script:TxtQuickNote.Text }
        }
    })

$Script:BtnStop.Add_Click({
        Stop-ProjectTimer
        $Script:TxtQuickNote.Text = ""
    })

$Script:ChkIncludeRates.Add_Checked({
        $Script:State.IncludeRatesInCopy = $true
        $Script:ColRate.Visibility = "Visible"
        $Script:ColValue.Visibility = "Visible"
    })
$Script:ChkIncludeRates.Add_Unchecked({
        $Script:State.IncludeRatesInCopy = $false
        $Script:ColRate.Visibility = "Collapsed"
        $Script:ColValue.Visibility = "Collapsed"
    })

$Script:BtnCopyTsv.Add_Click({
        $entries = @(Get-Entries)
        $lines = New-Object System.Collections.Generic.List[string]
        if ($Script:State.IncludeRatesInCopy) {
            $lines.Add("Date`tTime`tProject`tDuration`tHours`tRate (EUR/h)`tValue (EUR)`tNote")
            foreach ($e in $entries) {
                $safeProj = Protect-SpreadsheetCell $e.ProjectName
                $safeNote = Protect-SpreadsheetCell $e.Note
                $lines.Add("$($e.DateDisplay)`t$($e.TimeRange)`t$safeProj`t$($e.DurationDisplay)`t$($e.HoursDisplay)`t$($e.RateDisplay)`t$($e.ValueDisplay)`t$safeNote")
            }
        }
        else {
            $lines.Add("Date`tTime`tProject`tDuration`tHours`tNote")
            foreach ($e in $entries) {
                $safeProj = Protect-SpreadsheetCell $e.ProjectName
                $safeNote = Protect-SpreadsheetCell $e.Note
                $lines.Add("$($e.DateDisplay)`t$($e.TimeRange)`t$safeProj`t$($e.DurationDisplay)`t$($e.HoursDisplay)`t$safeNote")
            }
        }
        [System.Windows.Clipboard]::SetText(($lines -join "`r`n"))
        $Script:TxtCopyFeedback.Text = "Copied $($entries.Count) rows to clipboard!"
    })

$Script:BtnAddProject.Add_Click({
        $name = $Script:TxtNewProjectName.Text.Trim()
        if (-not $name) { return }
        $colorHex = $Script:CmbNewProjectColor.SelectedItem.Tag
        $rateParsed = 85.0
        [double]::TryParse($Script:TxtNewProjectRate.Text.Replace(".", ","), [System.Globalization.NumberStyles]::Any, $Script:CultureAT, [ref]$rateParsed) | Out-Null

        $projHeaders = @("Id", "Name", "ColorHex", "HourlyRate", "IsActive", "CreatedAt")
        $raw = @(Import-Csv -Path $Script:ProjectsCsv -Encoding UTF8)
        $maxId = 0
        foreach ($r in $raw) {
            $rid = [int](Get-SafeProp $r "Id" 0)
            if ($rid -gt $maxId) { $maxId = $rid }
        }

        $raw += [PSCustomObject]@{
            Id         = "$($maxId + 1)"
            Name       = $name
            ColorHex   = $colorHex
            HourlyRate = $rateParsed.ToString([System.Globalization.CultureInfo]::InvariantCulture)
            IsActive   = "1"
            CreatedAt  = (Get-Date).ToString("o")
        }
        Save-CsvAtomic -Path $Script:ProjectsCsv -Rows $raw -Headers $projHeaders
        $Script:TxtNewProjectName.Text = ""
        Refresh-UiData
    })

# Routed ButtonBase.Click handler for DataGrid template buttons
$Script:GridProjects.AddHandler(
    [System.Windows.Controls.Primitives.ButtonBase]::ClickEvent,
    [System.Windows.RoutedEventHandler] {
        param($sender, $e)
        $btn = $e.OriginalSource -as [System.Windows.Controls.Button]
        if (-not $btn -or $null -eq $btn.Tag) { return }

        $id = [int]$btn.Tag
        $cmd = [string]$btn.CommandParameter
        $projHeaders = @("Id", "Name", "ColorHex", "HourlyRate", "IsActive", "CreatedAt")
        $raw = @(Import-Csv -Path $Script:ProjectsCsv -Encoding UTF8)

        if ($cmd -eq "Toggle") {
            foreach ($r in $raw) {
                if ([int](Get-SafeProp $r "Id" 0) -eq $id) {
                    $r.IsActive = if ((Get-SafeProp $r "IsActive" "1") -eq "1") { "0" } else { "1" }
                    break
                }
            }
            Save-CsvAtomic -Path $Script:ProjectsCsv -Rows $raw -Headers $projHeaders
            Refresh-UiData
        }
        elseif ($cmd -eq "Delete") {
            $entries = @(Import-Csv -Path $Script:EntriesCsv -Encoding UTF8)
            $hasEntries = $false
            foreach ($ent in $entries) {
                if ([int](Get-SafeProp $ent "ProjectId" 0) -eq $id) { $hasEntries = $true; break }
            }
            if ($hasEntries) {
                [System.Windows.MessageBox]::Show("This project has logged time entries. Use 'Toggle Active' to deactivate it instead.", $Script:AppName, "OK", "Information") | Out-Null
                return
            }
            $filtered = @($raw | Where-Object { [int](Get-SafeProp $_ "Id" 0) -ne $id })
            Save-CsvAtomic -Path $Script:ProjectsCsv -Rows $filtered -Headers $projHeaders
            Refresh-UiData
        }
    }
)

$Script:BtnBackupCsv.Add_Click({
        $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
        $backupFolder = Join-Path $Script:DataDir "Backup_$stamp"
        New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
        foreach ($f in @($Script:ProjectsCsv, $Script:EntriesCsv, $Script:MetaCsv)) {
            if (Test-Path $f) { Copy-Item -Path $f -Destination $backupFolder -Force }
        }
        [System.Windows.MessageBox]::Show("CSV files backed up to:`n$backupFolder", $Script:AppName, "OK", "Information") | Out-Null
    })

# ==============================================================================
# 9. SYSTEM TRAY ICON & WINDOWS EVENT TRIGGERS (LOCK, IDLE, 60s MIC, 30-MIN CARD)
# ==============================================================================
$Script:ForceExit = $false
$Script:TrayIcon = New-Object System.Windows.Forms.NotifyIcon
$Script:CurrentTrayIconKey = "idle"
$Script:TrayIcon.Icon = Get-ProjectTrayIcon -ColorHex "#9CA3AF" -Mode "idle"
$Script:TrayIcon.Text = "LocalLog v$($Script:AppVersion) | Idle"
$Script:TrayIcon.Visible = $true

$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$itemOpen = $trayMenu.Items.Add("Open LocalLog (v$($Script:AppVersion))")
$itemOpen.Add_Click({ Show-MainWindow })
$itemStop = $trayMenu.Items.Add("Stop & Log Current Timer")
$itemStop.Add_Click({ Stop-ProjectTimer })
$trayMenu.Items.Add("-") | Out-Null
$itemExit = $trayMenu.Items.Add("Exit")
$itemExit.Add_Click({
        Stop-ProjectTimer
        $Script:ForceExit = $true
        $Script:TrayIcon.Visible = $false
        $Script:TrayIcon.Dispose()
        foreach ($ico in $Script:TrayIconCache.Values) {
            if ($null -ne $ico) {
                try { $ico.Dispose() } catch { }
            }
        }
        $Script:OrbWindow.Close()
        $Script:MainWindow.Close()
        [System.Windows.Application]::Current.Shutdown()
    })
$Script:TrayIcon.ContextMenuStrip = $trayMenu
$Script:TrayIcon.Add_MouseClick({
        param($s, $e)
        if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Show-MainWindow }
    })

# 9A. Lock / Unlock Automation
$Script:SessionHandler = [Microsoft.Win32.SessionSwitchEventHandler] {
    param($sender, $e)
    if ($e.Reason -eq [Microsoft.Win32.SessionSwitchReason]::SessionLock) {
        if ($Script:State.IsRunning) { Pause-ProjectTimer }
    }
    elseif ($e.Reason -eq [Microsoft.Win32.SessionSwitchReason]::SessionUnlock) {
        Show-CornerPromptCard -Title "Welcome Back" `
            -Message "Ready to track your next block? Open LocalLog to select a project." `
            -PrimaryLabel "Open Picker" -PrimaryAction { Show-MainWindow } `
            -SecondaryLabel "Dismiss" -SecondaryAction { }
    }
}
[Microsoft.Win32.SystemEvents]::add_SessionSwitch($Script:SessionHandler)

# 9B. Read-Only Microphone Call-End Watcher
function Test-MicrophoneActive {
    $basePaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged"
    )
    foreach ($bp in $basePaths) {
        if (-not (Test-Path $bp)) { continue }
        foreach ($sub in (Get-ChildItem -Path $bp -ErrorAction SilentlyContinue)) {
            $prop = Get-ItemProperty -Path $sub.PSPath -Name "LastUsedTimeStop" -ErrorAction SilentlyContinue
            if ($prop -and $prop.LastUsedTimeStop -eq 0) { return $true }
        }
    }
    return $false
}

# 9C. 1-Second UI Heartbeat DispatcherTimer
$Script:HeartBeat = New-Object System.Windows.Threading.DispatcherTimer
$Script:HeartBeat.Interval = [TimeSpan]::FromSeconds(1)
$Script:HeartBeat.Add_Tick({
        Update-AllVisuals

        # 60-second background checkpoint for crash/reboot protection
        if ($Script:State.IsRunning -and $Script:State.LastCheckpointTime) {
            if (((Get-Date) - $Script:State.LastCheckpointTime).TotalSeconds -ge 60) {
                $Script:State.LastCheckpointTime = Get-Date
                Update-ActiveEntryCsv -EntryId $Script:State.ActiveEntryId -EndTimeIso "" -DurationSeconds (Get-CurrentElapsedSeconds)
            }
        }

        # 30-minute anti-drift WPF corner card
        if ($Script:State.IsRunning -and $Script:State.LastCheckInTime) {
            if (((Get-Date) - $Script:State.LastCheckInTime).TotalMinutes -ge 30) {
                $Script:State.LastCheckInTime = Get-Date
                Show-CornerPromptCard -Title "30-Minute Check-In" `
                    -Message "Still working on the current project, or ready to switch?" `
                    -PrimaryLabel "Keep Going" -PrimaryAction { $Script:State.LastCheckInTime = Get-Date } `
                    -SecondaryLabel "Switch / Stop" -SecondaryAction { Show-MainWindow }
            }
        }

        # 60-second throttled post-meeting microphone call-end detector
        if (((Get-Date) - $Script:State.LastMicPollTime).TotalSeconds -ge 60) {
            $Script:State.LastMicPollTime = Get-Date
            $micNow = Test-MicrophoneActive
            if ($Script:State.WasMicInUse -and -not $micNow -and -not $Script:State.MicPromptOpen) {
                $Script:State.MicPromptOpen = $true
                Show-CornerPromptCard -Title "Call Ended" `
                    -Message "Your microphone turned off. Switch to a follow-up project?" `
                    -PrimaryLabel "Switch Project" -PrimaryAction { $Script:State.MicPromptOpen = $false; Show-MainWindow } `
                    -SecondaryLabel "Stay Here" -SecondaryAction { $Script:State.MicPromptOpen = $false }
            }
            $Script:State.WasMicInUse = $micNow
        }
    })
$Script:HeartBeat.Start()

Refresh-UiData
Update-AllVisuals
$Script:MainWindow.Show()

$app = New-Object System.Windows.Application
try {
    $app.Run($Script:MainWindow) | Out-Null
}
finally {
    [Microsoft.Win32.SystemEvents]::remove_SessionSwitch($Script:SessionHandler)
    [Microsoft.Win32.SystemEvents]::remove_DisplaySettingsChanged($Script:DisplayHandler)
    if ($Script:Mutex) { $Script:Mutex.ReleaseMutex(); $Script:Mutex.Dispose() }
}