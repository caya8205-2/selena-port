$ErrorActionPreference = 'Stop'
$dir = 'C:\Users\Caya\Desktop\Project\pgr-local\assemblies-x64'
Push-Location $dir
$renamed = 0
$failed = @()
Get-ChildItem $dir -Filter 'asm_*.dll' | ForEach-Object {
    try {
        $n = [System.Reflection.AssemblyName]::GetAssemblyName($_.FullName).Name
        if ($n) {
            $target = Join-Path $dir ($n + '.dll')
            if ($_.FullName -ne $target) {
                Move-Item -LiteralPath $_.FullName -Destination $target -Force
                $renamed++
            }
        }
    } catch {
        $failed += $_.Exception.InnerException.Message + ' :: ' + $_.Exception.Message
    }
}
"renamed: $renamed"
"failed: $($failed.Count)"
$failed | Select-Object -First 5
"=== key assemblies ==="
Get-ChildItem $dir -Filter '*.dll' | Where-Object { $_.Name -match 'AscNet|Kestrel|AspNetCore\.App|Mono\.Android|System\.Private\.CoreLib|e_sqlite3|MongoDB' } |
    Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}} | Format-Table -AutoSize
Pop-Location