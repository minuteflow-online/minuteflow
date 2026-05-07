#!/bin/bash
# pack-extension.sh
# Packages the MinuteFlow Chrome extension as .crx and .zip for distribution.
#
# Usage:
#   ./scripts/pack-extension.sh
#
# Requirements:
#   - Node.js
#   - crx3 package at /tmp/crx-tools (run: cd /tmp/crx-tools && npm install crx3)
#   - Signing key at /home/redbot/manny-bot/minuteflow-extension-key.pem
#
# After running, the new files are in public/:
#   public/minuteflow-extension.crx  ← VAs install this (auto-update enabled)
#   public/minuteflow-extension.zip  ← legacy fallback
#
# Also update public/extension-updates.xml if the version changed.

set -e

EXTENSION_DIR="$(cd "$(dirname "$0")/.." && pwd)/extension"
PUBLIC_DIR="$(cd "$(dirname "$0")/.." && pwd)/public"
KEY="/home/redbot/manny-bot/minuteflow-extension-key.pem"
CRX_TOOLS="/tmp/crx-tools/node_modules/.bin/crx3"

echo "📦 Packing MinuteFlow extension..."
echo "   Source: $EXTENSION_DIR"
echo "   Output: $PUBLIC_DIR"

# Reinstall crx3 if missing
if [ ! -f "$CRX_TOOLS" ]; then
  echo "⚙️  Installing crx3 packaging tool..."
  mkdir -p /tmp/crx-tools
  cd /tmp/crx-tools
  npm init -y > /dev/null 2>&1
  npm install crx3 > /dev/null 2>&1
  echo "   crx3 installed"
fi

# Read version from manifest
VERSION=$(node -e "const m = require('$EXTENSION_DIR/manifest.json'); console.log(m.version)")
echo "   Version: $VERSION"

# Pack as CRX3
echo "🔐 Signing and packing CRX..."
"$CRX_TOOLS" pack "$EXTENSION_DIR" \
  --key "$KEY" \
  --crx "$PUBLIC_DIR/minuteflow-extension.crx"

# Pack as ZIP (wrap in chrome-extension/ folder for user install)
echo "📁 Creating ZIP..."
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/chrome-extension"
cp -r "$EXTENSION_DIR/." "$TMPDIR/chrome-extension/"
cd "$TMPDIR"
python3 -c "
import zipfile, os
with zipfile.ZipFile('$PUBLIC_DIR/minuteflow-extension.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk('chrome-extension'):
        for f in files:
            z.write(os.path.join(root, f))
"
rm -rf "$TMPDIR"
cd -

echo ""
echo "✅ Done!"
echo "   CRX: $PUBLIC_DIR/minuteflow-extension.crx"
echo "   ZIP: $PUBLIC_DIR/minuteflow-extension.zip"
echo ""
echo "⚠️  If version changed, update public/extension-updates.xml:"
echo "   <updatecheck codebase='https://minuteflow.click/minuteflow-extension.crx' version='$VERSION' />"
