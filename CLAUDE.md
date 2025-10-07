# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`justinstall` is a command-line tool that makes it easy to install software from various sources including GitHub repositories, direct URLs, and local files. It supports multiple file formats and platforms, with intelligent detection of install scripts and binaries.

## Development Environment

- **Runtime**: Bun (JavaScript runtime)
- **Main entry point**: `index.js`
- **Configuration**: `jsconfig.json` (TypeScript support without compilation)
- **Build script**: `build.sh` for creating platform-specific binaries

## Build Commands

```bash
# Build for all platforms
./build.sh

# Individual platform builds (manual)
bun build --compile --target=bun-linux-x64 index.js --outfile build/justinstall-v1.2.0-linux-x64
bun build --compile --target=bun-linux-arm64 index.js --outfile build/justinstall-v1.2.0-linux-arm64
bun build --compile --target=bun-windows-x64 index.js --outfile build/justinstall-v1.2.0-windows-x64.exe
bun build --compile --target=bun-darwin-x64 index.js --outfile build/justinstall-v1.2.0-darwin-x64
bun build --compile --target=bun-darwin-arm64 index.js --outfile build/justinstall-v1.2.0-darwin-arm64
```

## Architecture Overview

### Core Components

1. **Main Entry Point (`index.js`)**
   - CLI argument parsing and command routing
   - Help text and usage information
   - Integration of all major modules

2. **Installation System (`lib/installer.js`)**
   - Main installation orchestration
   - Coordinates between sources and installers
   - Handles user confirmation and progress tracking

3. **Source Management (`lib/sources.js`)**
   - GitHub repository parsing and asset discovery
   - Website scraping and download detection
   - Smart URL handling and fallback strategies
   - Install script detection from README/release notes

4. **Platform Installers (`lib/installers.js`)**
   - Platform-specific installation logic
   - Archive extraction (tar.gz, zip, tar.xz)
   - Binary detection and installation (~/.local/bin)
   - macOS-specific: DMG mounting, PKG installation, .app handling
   - Linux-specific: DEB package installation

5. **Update Management (`lib/updater.js`)**
   - Configuration management (`~/.config/justinstall/config.json`)
   - Update checking and installation
   - Package listing and uninstallation

6. **Search Functionality (`lib/search.js`)**
   - GitHub repository search
   - Interactive selection interface
   - Repository metadata fetching

7. **Utilities (`lib/utils.js`)**
   - Logging system with configurable levels
   - File operations and path management
   - Platform detection and capability checking
   - User interaction helpers (confirmation prompts)

8. **Configuration (`lib/config.js`)**
   - Installation history tracking
   - Package metadata storage
   - Configuration file management

## Key Features

### Installation Sources
- **GitHub**: Repository owner/repo format, releases, assets
- **Direct URLs**: Website downloads, direct file links
- **Local Files**: Local package installation
- **Smart URLs**: Intelligent fallback and discovery

### Supported Formats
- Archives: `.tar.gz`, `.zip`, `.tar.xz`
- macOS: `.dmg`, `.pkg`, `.app`
- Linux: `.deb`
- Binaries: Direct executable installation

### Platform Support
- **macOS**: Full support with code signing and quarantine handling
- **Linux**: Binary and DEB package support
- **Windows**: Basic binary support
- **BSD**: Limited support for basic operations

## Installation Strategy

The tool uses a sophisticated asset selection algorithm:
1. Platform-specific asset detection (architecture, OS)
2. Fallback chains for compatibility
3. Smart binary detection within archives
4. Install script discovery and execution
5. User confirmation for overwrites and sensitive operations

## Configuration

- **Config location**: `~/.config/justinstall/config.json`
- **Binary install location**: `~/.local/bin`
- **Logging**: Configurable levels with file output option
- **Update tracking**: Automatic version checking and updates

## Testing

The project currently does not have automated tests. Manual testing should cover:
- Installation from various sources
- Different file formats and platforms
- Update and uninstall operations
- Error handling and edge cases

## Dependencies

- **cli-progress**: Progress bar functionality
- **@types/bun**: TypeScript definitions for Bun
- **typescript**: Peer dependency for type checking