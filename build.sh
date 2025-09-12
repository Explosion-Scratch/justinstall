#!/usr/bin/env bash
set -e

rm -rf build
mkdir -p build

VERSION=$(cat package.json | jq -r '.version')
bun build --compile --target=bun-linux-x64 index.js --outfile build/justinstall-$VERSION-linux-x64
bun build --compile --target=bun-linux-arm64 index.js --outfile build/justinstall-$VERSION-linux-arm64
bun build --compile --target=bun-windows-x64 index.js --outfile build/justinstall-$VERSION-windows-x64.exe
bun build --compile --target=bun-darwin-x64 index.js --outfile build/justinstall-$VERSION-darwin-x64
bun build --compile --target=bun-darwin-arm64 index.js --outfile build/justinstall-$VERSION-darwin-arm64
