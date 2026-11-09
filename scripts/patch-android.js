// Po "npx cap add android" i "npx cap sync":
//  1) manifest: uprawnienia, HTTP do serwera w sieci lokalnej, aktywność skanera,
//  2) build.gradle: zależności CameraX + ML Kit, stały podpis (klucz z sekretów GitHub),
//     numer wersji = numer uruchomienia Actions (każdy build jest nowszy => instalacja NAD starą wersją),
//  3) kod natywny (ScanActivity, ScannerPlugin, MainActivity) do projektu Android,
//  4) zaakceptowana ikona SENTINEL we wszystkich wariantach Androida.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const androidApp = path.join(root, 'android', 'app');
if (!fs.existsSync(androidApp)) {
    console.error('Brak android/ - najpierw uruchom: npx cap add android');
    process.exit(1);
}

// 1) AndroidManifest.xml
const manifestPath = path.join(androidApp, 'src', 'main', 'AndroidManifest.xml');
let xml = fs.readFileSync(manifestPath, 'utf8');
const perms = ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.CAMERA'];
for (const p of perms) {
    if (!xml.includes(p)) xml = xml.replace(/(<manifest[^>]*>)/, `$1\n    <uses-permission android:name="${p}" />`);
}
if (!xml.includes('android.hardware.camera')) {
    xml = xml.replace(/(<manifest[^>]*>)/, `$1\n    <uses-feature android:name="android.hardware.camera" android:required="false" />`);
}
if (!xml.includes('usesCleartextTraffic')) {
    xml = xml.replace(/<application\b/, '<application android:usesCleartextTraffic="true"');
}
if (!xml.includes('androidx.core.content.FileProvider')) {
    xml = xml.replace('</application>', '        <provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.fileprovider" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" /></provider>\n    </application>');
}
if (!xml.includes('pl.sentinel.app.ScanActivity')) {
    xml = xml.replace('</application>', '        <activity android:name="pl.sentinel.app.ScanActivity" android:exported="false" android:screenOrientation="portrait" />\n    </application>');
}
fs.writeFileSync(manifestPath, xml);

// 2) build.gradle
const gradlePath = path.join(androidApp, 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');

// 2a) zależności (te same wersje co w QCDefectScan)
const deps = [
    "implementation 'androidx.camera:camera-core:1.3.4'",
    "implementation 'androidx.camera:camera-camera2:1.3.4'",
    "implementation 'androidx.camera:camera-lifecycle:1.3.4'",
    "implementation 'androidx.camera:camera-view:1.3.4'",
    "implementation 'com.google.mlkit:barcode-scanning:17.3.0'"
];
if (!gradle.includes('com.google.mlkit:barcode-scanning')) {
    gradle = gradle.replace(/dependencies\s*\{/, 'dependencies {\n    ' + deps.join('\n    '));
}

// 2b) stały podpis: klucz z pliku app/sentinel.keystore, hasła z sekretów (zmienne środowiskowe)
if (!gradle.includes('signingConfigs.sentinel')) {
    const signing = `
    signingConfigs {
        sentinel {
            storeFile file("sentinel.keystore")
            storePassword System.getenv("KEYSTORE_PASSWORD") ?: ""
            keyAlias System.getenv("KEY_ALIAS") ?: "sentinel"
            keyPassword System.getenv("KEY_PASSWORD") ?: ""
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.sentinel
        }
    }`;
    gradle = gradle.replace(/android\s*\{/, 'android {' + signing);
}

// 2c) numer wersji rośnie z każdym buildem (GITHUB_RUN_NUMBER)
if (!gradle.includes('GITHUB_RUN_NUMBER')) {
    gradle = gradle.replace(/versionCode\s+\d+/, 'versionCode Integer.parseInt(System.getenv("GITHUB_RUN_NUMBER") ?: "1")');
    gradle = gradle.replace(/versionName\s+"[^"]*"/, 'versionName "3.1." + (System.getenv("GITHUB_RUN_NUMBER") ?: "1")');
}
fs.writeFileSync(gradlePath, gradle);

// 3a) Ścieżki FileProvider (udostępnianie plików)
const xmlDir = path.join(androidApp, 'src', 'main', 'res', 'xml');
fs.mkdirSync(xmlDir, { recursive: true });
fs.writeFileSync(path.join(xmlDir, 'file_paths.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<paths>\n    <cache-path name="shared" path="shared/" />\n</paths>\n');

// 3) Kod natywny
const src = path.join(root, 'native', 'java', 'pl', 'sentinel', 'app');
const dst = path.join(androidApp, 'src', 'main', 'java', 'pl', 'sentinel', 'app');
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

// 4) Ikona aplikacji: zasoby są przechowywane w repozytorium, ponieważ katalog
// android jest tworzony od nowa przez GitHub Actions przy każdym buildzie.
const iconSrc = path.join(root, 'assets', 'android-icons');
const iconDst = path.join(androidApp, 'src', 'main', 'res');
if (!fs.existsSync(iconSrc)) {
    throw new Error('Brak zasobów ikony Android: assets/android-icons');
}
fs.cpSync(iconSrc, iconDst, { recursive: true, force: true });

console.log('Android: manifest, zależności, podpis, wersja, skaner i ikona przygotowane.');
