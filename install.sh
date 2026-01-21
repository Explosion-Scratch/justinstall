#!/usr/bin/env bash
set -e

# Run the build script
./build.sh

# Get version from package.json
VERSION=$(cat package.json | jq -r '.version')

# Detect OS and Architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

BINARY_NAME=""

if [ "$OS" == "Darwin" ]; then
    if [ "$ARCH" == "arm64" ]; then
        BINARY_NAME="justinstall-${VERSION}-darwin-arm64"
    else
        BINARY_NAME="justinstall-${VERSION}-darwin-x64"
    fi
elif [ "$OS" == "Linux" ]; then
    if [ "$ARCH" == "aarch64" ]; then
        BINARY_NAME="justinstall-${VERSION}-linux-arm64"
    else
        BINARY_NAME="justinstall-${VERSION}-linux-x64"
    fi
else
    echo "Unsupported OS: $OS"
    exit 1
fi

SOURCE="build/$BINARY_NAME"
DEST_DIR="$HOME/.local/bin"
DEST="$DEST_DIR/justinstall"

if [ ! -f "$SOURCE" ]; then
    echo "Error: Binary $SOURCE not found!"
    exit 1
fi

# Ensure destination directory exists
mkdir -p "$DEST_DIR"

# Install
echo "Installing $SOURCE to $DEST..."
cp "$SOURCE" "$DEST"
chmod +x "$DEST"

echo "Successfully installed justinstall to $DEST"
echo "Make sure $DEST_DIR is in your PATH."
