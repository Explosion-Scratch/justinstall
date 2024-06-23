# 📦 justinstall


https://github.com/Explosion-Scratch/justinstall/assets/61319150/4a05e6e0-065a-493f-97ae-b7f5e2bc0265

<i>In the above recording I installed fzf, mise, Google Chrome, Cursor, and pocketbase.</i>

`justinstall`: Just install **almost anything**!! It's goal is to make it easy to install software from GitHub repositories, direct URLs, or local files.

## Installation:
Grab the binary from the github releases (ironically you can use this tool to install itself)

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

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgements

Created by [Explosion-Scratch](https://github.com/explosion-scratch)

## Disclaimer
Don't use on windows. I don't have windows so I haven't tested it on windows. It would probably still work well for binaries though.

This tool attempts to install software as safely as possible, but I'm not responsible if you install malware of if this breaks your system or harms anything in any way directly or indirectly. Always verify the source and contents of packages before installation.

Less scary note: I've included confirmations for many operations as a failsafe.

### Why's does the recording have errors:
<small>Ignore the mise errors, I uninstalled it before recording to install it again. Also the regex thought it detected an install script but it didn't.</small>
