const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = [
  '.github/workflows/build-apk.yml',
  'capacitor.config.json',
  'package.json',
  'scripts/patch-android.js',
  'native/java/pl/sentinel/app/MainActivity.java',
  'native/java/pl/sentinel/app/ScanActivity.java',
  'native/java/pl/sentinel/app/ScannerPlugin.java',
  'assets/sentinel-icon.png',
  'assets/android-icons/drawable/ic_launcher_foreground.png',
  'assets/android-icons/mipmap-anydpi-v26/ic_launcher.xml',
  'assets/android-icons/mipmap-anydpi-v26/ic_launcher_round.xml',
  'assets/android-icons/mipmap-mdpi/ic_launcher.png',
  'assets/android-icons/mipmap-hdpi/ic_launcher.png',
  'assets/android-icons/mipmap-xhdpi/ic_launcher.png',
  'assets/android-icons/mipmap-xxhdpi/ic_launcher.png',
  'assets/android-icons/mipmap-xxxhdpi/ic_launcher.png',
  'www/index.html',
  'www/assets/sentinel-icon.png',
  'www/lib/xlsx.full.min.js',
  'www/lib/exceljs.min.js',
  'www/modules/sentinel-sync.js',
  'www/modules/report-history.js',
  'www/modules/ddms/index.html',
  'www/modules/warehouse/index.html',
  'www/modules/cleanily/index.html'
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error('Brak wymaganego pliku: ' + file);
}

new Function(fs.readFileSync(path.join(root, 'scripts/patch-android.js'), 'utf8'));
new Function(fs.readFileSync(path.join(root, 'www/modules/report-history.js'), 'utf8'));

const icon = fs.readFileSync(path.join(root, 'assets/sentinel-icon.png'));
if (icon.toString('ascii', 1, 4) !== 'PNG' || icon.readUInt32BE(16) !== 1024 || icon.readUInt32BE(20) !== 1024) {
  throw new Error('Główna ikona musi być poprawnym plikiem PNG 1024x1024');
}
for (const file of [
  'www/index.html',
  'www/modules/ddms/index.html',
  'www/modules/warehouse/index.html',
  'www/modules/cleanily/index.html'
]) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  blocks.forEach((block, index) => {
    try { new Function(block[1]); }
    catch (error) { throw new Error(file + ' - skrypt ' + (index + 1) + ': ' + error.message); }
  });
}

const scanner = fs.readFileSync(path.join(root, 'native/java/pl/sentinel/app/ScannerPlugin.java'), 'utf8');
if (!scanner.includes('void scan(') || !scanner.includes('void shareFile(')) {
  throw new Error('Natywny skaner lub udostepnianie plikow sa niekompletne');
}

const appHtml = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
if (/MAX\s*[·-]\s*(DDMS|W\/H|Cleanily)/i.test(appHtml)) {
  throw new Error('Nazwy modułów nadal zawierają dopisek MAX');
}

for (const file of [
  'www/modules/ddms/sentinel-adapter.js',
  'www/modules/warehouse/sentinel-adapter.js',
  'www/modules/cleanily/index.html',
  'www/modules/cleanily/sentinel-adapter.js'
]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (!source.includes('PHOTO_RESET_VERSION') && !source.includes('_photoResetVersion')) {
    throw new Error('Brak mechanizmu pierwszego czyszczenia zdjęć: ' + file);
  }
}

console.log('OK: projekt GitHub zawiera kompletną aplikację i pliki potrzebne do budowy APK.');
