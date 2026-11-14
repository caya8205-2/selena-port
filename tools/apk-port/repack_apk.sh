#!/usr/bin/env bash
# Repack the PGR local-service APK with the English web UI.
# Swaps only the web assets (HTML/JS/CSS) and re-signs with a local debug key.
set -euo pipefail

PROJ="C:/Users/Caya/Desktop/Project/pgr-local"
SRC="C:/Users/Caya/Downloads/PGR 本地服务.apk"
BT="C:/Android/Sdk/build-tools/36.0.0"
WORK="$PROJ/build"
OUT="$PROJ/artifacts/PGR-localhost-en.apk"
KS="$PROJ/build/debug.keystore"

echo "== 1. staging =="
rm -rf "$WORK/app"
mkdir -p "$WORK/app"
cd "$WORK" && unzip -q "$SRC" -d app

echo "== 2. swapping web assets =="
WEB="app/assets/server-resources/Web"
for f in gm/index.html gm/gm.js gm/gm.css player/index.html player/panel.js player/panel.css; do
  cp "$PROJ/web-en/$f" "$WEB/$f"
  echo "   replaced $f"
done

echo "== 3. zipping (aligned later) =="
rm -f "$WORK/unsigned.apk"
python3 "$PROJ/tools/zip_apk.py" "$WORK/app" "$WORK/unsigned.apk"

echo "== 4. zipalign =="
"$BT/zipalign.exe" -f -p 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"

echo "== 5. signing key =="
if [ ! -f "$KS" ]; then
  keytool -genkeypair -v -keystore "$KS" -storepass android -keypass android \
    -alias pgrlocal -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=PGR Local EN, OU=mod, O=pgr-local, L=-, S=-, C=ID" >/dev/null 2>&1
  echo "   generated $KS"
else
  echo "   reusing $KS"
fi

echo "== 6. apksigner =="
"$BT/apksigner.bat" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT" "$WORK/aligned.apk"
"$BT/apksigner.bat" verify --print-certs "$OUT" | head -4

echo "== 7. result =="
ls -lh "$OUT"
"$BT/aapt2.exe" dump badging "$OUT" 2>/dev/null | head -2