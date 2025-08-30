# 📦 justinstall


https://github.com/Explosion-Scratch/justinstall/assets/61319150/4a05e6e0-065a-493f-97ae-b7f5e2bc0265

<i>In the above recording I installed fzf, mise, Google Chrome, Cursor, and pocketbase.</i>

`justinstall`: Just install **almost anything**!! It's goal is to make it easy to install software from GitHub repositories, direct URLs, or local files.

## Installation:
Grab the binary from the github releases (ironically you can use this tool to install itself)

### Automated Builds

This project uses GitHub Actions to automatically build cross-platform binaries whenever code changes are pushed to the main branch. The build system creates pre-releases with binaries for all supported platforms:

| Platform | Architecture | Binary Name |
|----------|--------------|-------------|
| Linux | x86_64 | `justinstall-{version}-linux-x64` |
| Linux | ARM64 | `justinstall-{version}-linux-arm64` |
| Windows | x86_64 | `justinstall-{version}-windows-x64.exe` |
| macOS | x86_64 | `justinstall-{version}-darwin-x64` |
| macOS | ARM64 (Apple Silicon) | `justinstall-{version}-darwin-arm64` |

#### Getting Pre-built Binaries

1. Visit the [releases page](https://github.com/Explosion-Scratch/justinstall/releases)
2. Look for the latest pre-release (marked with "Pre-release" tag)
3. Download the appropriate binary for your platform
4. Make the binary executable: `chmod +x justinstall-*` (Unix/macOS)
5. Add it to your PATH or run directly

#### Build Process

The automated build process:
- Triggers only on code changes (ignoring documentation updates)
- Uses Bun's native compilation for optimal performance
- Verifies all binaries are created successfully before releasing
- Creates timestamped pre-releases to avoid version conflicts
- Includes comprehensive build metadata and download instructions

For development builds or custom compilation, see the [Building](#building) section below.

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
```
justinstall <github-url|file-url|local-file>
	v1.0.0 - Just install anything. Supports .tar.gz, .zip, .dmg, .app, .pkg, and .deb files. Binaries will be installed to ~/.local/bin.

	Example:
		justinstall atuinsh/atuin
		justinstall https://github.com/junegunn/fzf/
		justinstall https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg
		justinstall tailscale.pkg
```

## Supported Installation Methods

1. GitHub Repositories: Automatically fetches the latest release and selects the most compatible asset. **or** finds snippets from release notes and README files using hueristics.
2. Direct URLs: Downloads and installs files from direct links.
3. Local Files: Installs software from files already present on the local system.

## Contributing

## Building

To build the project locally:

### Prerequisites

- [Bun](https://bun.sh/) runtime (latest version)
- Unix-like environment (Linux, macOS, or WSL on Windows)

### Build Steps

1. Clone the repository:
   ```bash
   git clone https://github.com/Explosion-Scratch/justinstall.git
   cd justinstall
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Build all platform binaries:
   ```bash
   ./build.sh
   ```

This creates optimized binaries in the `build/` directory for all supported platforms. The build script uses Bun's native compilation feature for maximum performance and minimal dependencies.

### Development

For development and testing:
```bash
# Run directly with Bun
bun run index.js --help

# Or make executable and run
chmod +x index.js
./index.js --help
```

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgements

Created by [Explosion-Scratch](https://github.com/explosion-scratch)

## Disclaimer
Don't use on windows. I don't have windows so I haven't tested it on windows. It would probably still work well for binaries though.

This tool attempts to install software as safely as possible, but I'm not responsible if you install malware of if this breaks your system or harms anything in any way directly or indirectly. Always verify the source and contents of packages before installation.

Less scary note: I've included confirmations for many operations as a failsafe.

### Why's does the recording have errors:
<small>Ignore the mise errors, I uninstalled it before recording to install it again. Also the regex thought it detected an install script but it didn't.</small>
