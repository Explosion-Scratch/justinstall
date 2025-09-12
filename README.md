# 📦 justinstall


https://github.com/Explosion-Scratch/justinstall/assets/61319150/4a05e6e0-065a-493f-97ae-b7f5e2bc0265

<i>In the above recording I installed fzf, mise, Google Chrome, Cursor, and pocketbase.</i>

`justinstall`: Just install **almost anything**!! It's goal is to make it easy to install software from GitHub repositories, direct URLs, or local files.

## Installation:
Grab the binary from the github releases (ironically you can use this tool to install itself)

### Automated Builds
This project uses GitHub Actions to automatically build binaries for all supported platforms on every push to the main branch. Pre-releases are created with binaries for:
- Linux x64
- Linux ARM64  
- Windows x64
- macOS x64
- macOS ARM64 (Apple Silicon)

You can find the latest pre-releases in the [releases page](https://github.com/Explosion-Scratch/justinstall/releases).

## Features

- Detects install scripts from README.mds and release notes
- Supports installation from GitHub repositories, direct URLs, and local files
- Handles various file formats: .tar.gz, .zip, .dmg, .app, .pkg, and .deb
- Automatically detects system architecture and platform for compatibility
- Installs binaries to ~/.local/bin
- Supports macOS, Linux, and partially supports FreeBSD and OpenBSD
- Provides interactive prompts for user confirmation during installation
- Handles code signing and quarantine removal for macOS applications
- Offers detailed logging and error handling
  Confirmation for overwriting

## Installation

(Add installation instructions here, e.g., how to download and set up the tool)

## Usage
