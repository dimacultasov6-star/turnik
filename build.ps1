param(
    [string]$ApkName = "Turnik-1.0.apk"
)

$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$Sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$BT = Join-Path $Sdk "build-tools\36.0.0"
$AndroidJar = Join-Path $Sdk "platforms\android-36\android.jar"
$Jbr = "C:\Program Files\Android\Android Studio\jbr"
$JbrBin = Join-Path $Jbr "bin"
$Stage = Join-Path $env:TEMP "turnik_build"
$KsDir = Join-Path $Root "android\keystore"
$Ks = Join-Path $KsDir "turnik.jks"
$KsPass = "turnik123"
$KsAlias = "turnik"

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

foreach ($p in @($BT, $AndroidJar, (Join-Path $JbrBin "javac.exe"), (Join-Path $BT "aapt2.exe"), (Join-Path $BT "d8.bat"), (Join-Path $BT "apksigner.bat"), (Join-Path $BT "zipalign.exe"))) {
    if (-not (Test-Path -LiteralPath $p)) { throw "Missing tool: $p" }
}

Step "Preparing staging dir (ASCII path)"
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$Stage\src", "$Stage\res", "$Stage\assets\www", "$Stage\out" | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "android\AndroidManifest.xml") -Destination "$Stage\"
Copy-Item -Path (Join-Path $Root "android\src\*") -Destination "$Stage\src" -Recurse -Force
Copy-Item -Path (Join-Path $Root "android\res\*") -Destination "$Stage\res" -Recurse -Force
Copy-Item -Path (Join-Path $Root "web\*") -Destination "$Stage\assets\www" -Recurse -Force

Step "aapt2 compile resources"
& "$BT\aapt2.exe" compile --dir "$Stage\res" -o "$Stage\out\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

Step "aapt2 link manifest + resources"
& "$BT\aapt2.exe" link -I $AndroidJar --manifest "$Stage\AndroidManifest.xml" -R "$Stage\out\res.zip" -o "$Stage\out\base.apk" --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

Step "javac (Java 8 bytecode)"
$src = Get-ChildItem -LiteralPath "$Stage\src" -Recurse -Filter *.java | ForEach-Object { $_.FullName }
& "$JbrBin\javac.exe" -encoding UTF8 -source 8 -target 8 -classpath $AndroidJar -d "$Stage\out\classes" $src
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

$oldJavaHome = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $Jbr

    Step "d8 -> classes.dex"
    $classes = Get-ChildItem -LiteralPath "$Stage\out\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
    & "$BT\d8.bat" --lib $AndroidJar --min-api 24 --output "$Stage\out" $classes
    if ($LASTEXITCODE -ne 0) { throw "d8 failed" }

    Step "Adding dex + web assets into apk"
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $baseApk = "$Stage\out\base.apk"
    $zip = [System.IO.Compression.ZipFile]::Open($baseApk, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$Stage\out\classes.dex", "classes.dex", [System.IO.Compression.CompressionLevel]::NoCompression) | Out-Null
        $wwwRoot = (Resolve-Path -LiteralPath "$Stage\assets").Path
        Get-ChildItem -LiteralPath "$Stage\assets" -Recurse -File | ForEach-Object {
            $rel = $_.FullName.Substring($wwwRoot.Length + 1).Replace("\", "/")
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally {
        $zip.Dispose()
    }

    Step "zipalign"
    & "$BT\zipalign.exe" -f -p 4 "$Stage\out\base.apk" "$Stage\out\aligned.apk"
    if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

    Step "Keystore"
    if (-not (Test-Path -LiteralPath $Ks)) {
        New-Item -ItemType Directory -Force -Path $KsDir | Out-Null
        & "$JbrBin\keytool.exe" -genkeypair -keystore $Ks -alias $KsAlias -keyalg RSA -keysize 2048 -validity 10000 -storepass $KsPass -keypass $KsPass -dname "CN=Turnik, OU=Turnik, O=Turnik, L=Local, C=RU"
        if ($LASTEXITCODE -ne 0) { throw "keytool failed" }
    }

    Step "sign"
    & "$BT\apksigner.bat" sign --ks $Ks --ks-pass "pass:$KsPass" --key-pass "pass:$KsPass" --out "$Stage\out\signed.apk" "$Stage\out\aligned.apk"
    if ($LASTEXITCODE -ne 0) { throw "apksigner sign failed" }

    Step "verify"
    & "$BT\apksigner.bat" verify --print-certs "$Stage\out\signed.apk"
    if ($LASTEXITCODE -ne 0) { throw "apksigner verify failed" }
}
finally {
    $env:JAVA_HOME = $oldJavaHome
}

$dest = Join-Path $Root $ApkName
Copy-Item -LiteralPath "$Stage\out\signed.apk" -Destination $dest -Force
$size = [math]::Round((Get-Item -LiteralPath $dest).Length / 1MB, 2)
Write-Host "OK: $dest ($size MB)" -ForegroundColor Green
