#!/usr/bin/env bash
# Build StreamMonitor as a standalone binary using PyInstaller
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "==> Installing frontend dependencies..."
npm ci

echo "==> Building frontend..."
npm run build

echo "==> Installing PyInstaller..."
uv pip install pyinstaller

echo "==> Building binary..."
uv run pyinstaller streammonitor.spec --noconfirm --clean

BINARY="$PROJECT_DIR/dist/streammonitor"
if [ -f "$BINARY" ]; then
    SIZE=$(du -h "$BINARY" | cut -f1)
    echo ""
    echo "==> Build successful!"
    echo "    Binary: $BINARY ($SIZE)"
    echo "    Run:    ./dist/streammonitor"
else
    echo "==> Build failed!"
    exit 1
fi
