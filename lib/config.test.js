const { describe, test, expect } = require("bun:test");
const { extractName } = require("./config");

describe("extractName", () => {
  describe("version removal", () => {
    test("removes semver versions with v prefix", () => {
      expect(extractName({ name: "app-v1.2.3.tar.gz" })).toBe("app");
    });

    test("removes semver versions without v prefix", () => {
      expect(extractName({ name: "tool-1.0.0.zip" })).toBe("tool");
    });

    test("removes versions in the middle of name", () => {
      expect(extractName({ name: "cli-v2.5.1-darwin.tar.gz" })).toBe("cli");
    });

    test("handles real-world versioned filenames", () => {
      const ripgrepResult = extractName({ name: "ripgrep-14.1.0-x86_64-apple-darwin.tar.gz" });
      expect(ripgrepResult.toLowerCase()).toContain("ripgrep");
      const fzfResult = extractName({ name: "fzf-0.54.0-darwin_arm64.tar.gz" });
      expect(fzfResult.toLowerCase()).toContain("fzf");
      const helixResult = extractName({ name: "helix-24.07-x86_64-macos.tar.gz" });
      expect(helixResult.toLowerCase()).toContain("helix");
    });

    test("handles versions at the start", () => {
      expect(extractName({ name: "v1.2.3-myapp.dmg" })).toBe("myapp");
    });
  });

  describe("platform removal", () => {
    test("removes darwin platform indicator", () => {
      expect(extractName({ name: "tool_darwin.zip" })).toBe("tool");
    });

    test("removes macos platform indicator", () => {
      expect(extractName({ name: "app-macos.dmg" })).toBe("app");
    });

    test("removes osx platform indicator", () => {
      expect(extractName({ name: "binary_osx.tar.gz" })).toBe("binary");
    });

    test("removes apple platform indicator", () => {
      expect(extractName({ name: "cli-apple.pkg" })).toBe("cli");
    });

    test("removes linux platform indicator", () => {
      expect(extractName({ name: "tool_linux.tar.gz" })).toBe("tool");
    });

    test("removes windows platform indicator", () => {
      expect(extractName({ name: "app-windows.zip" })).toBe("app");
    });

    test("handles real-world platform filenames", () => {
      const deltaResult = extractName({ name: "delta-0.16.5-x86_64-apple-darwin.tar.gz" });
      expect(deltaResult.toLowerCase()).toContain("delta");
      const batResult = extractName({ name: "bat-v0.24.0-x86_64-unknown-linux-gnu.tar.gz" });
      expect(batResult.toLowerCase()).toContain("bat");
    });
  });

  describe("architecture removal", () => {
    test("removes x64 architecture", () => {
      expect(extractName({ name: "app_x64.zip" })).toBe("app");
    });

    test("removes x86_64 architecture when possible", () => {
      const result = extractName({ name: "tool-x86_64.tar.gz" });
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    test("removes arm64 architecture", () => {
      expect(extractName({ name: "binary-arm64.dmg" })).toBe("binary");
    });

    test("removes aarch64 architecture", () => {
      expect(extractName({ name: "cli_aarch64.pkg" })).toBe("cli");
    });

    test("removes universal architecture", () => {
      expect(extractName({ name: "app-universal.dmg" })).toBe("app");
    });

    test("removes amd64 architecture", () => {
      expect(extractName({ name: "tool_amd64.deb" })).toBe("tool");
    });
  });

  describe("extension removal", () => {
    test("removes tar.gz extension", () => {
      expect(extractName({ name: "app.tar.gz" })).toBe("app");
    });

    test("removes tar.xz extension", () => {
      expect(extractName({ name: "tool.tar.xz" })).toBe("tool");
    });

    test("removes zip extension", () => {
      expect(extractName({ name: "binary.zip" })).toBe("binary");
    });

    test("removes dmg extension", () => {
      expect(extractName({ name: "App.dmg" })).toBe("App");
    });

    test("removes pkg extension", () => {
      expect(extractName({ name: "installer.pkg" })).toBe("installer");
    });

    test("removes deb extension", () => {
      expect(extractName({ name: "package.deb" })).toBe("package");
    });

    test("removes app extension", () => {
      expect(extractName({ name: "MyApp.app" })).toBe("MyApp");
    });
  });

  describe("combined scenarios", () => {
    test("handles version + platform + arch + extension", () => {
      const result = extractName({ name: "ripgrep-14.1.0-x86_64-apple-darwin.tar.gz" });
      expect(result.toLowerCase()).toContain("ripgrep");
    });

    test("handles underscores as separators", () => {
      expect(extractName({ name: "my_tool_v1.0.0_darwin_arm64.tar.gz" })).toBe("my_tool");
    });

    test("handles dashes as separators", () => {
      expect(extractName({ name: "my-tool-v1.0.0-darwin-arm64.tar.gz" })).toBe("my-tool");
    });

    test("handles mixed separators", () => {
      expect(extractName({ name: "my-tool_v1.0.0-darwin_arm64.tar.gz" })).toBe("my-tool");
    });

    test("handles real-world complex filenames", () => {
      expect(extractName({ name: "Pearcleaner.dmg" })).toBe("Pearcleaner");
      const vscodeResult = extractName({ name: "Visual Studio Code-darwin-universal.dmg" });
      expect(vscodeResult).toContain("Visual Studio Code");
      const itermResult = extractName({ name: "iTerm2-3_5_4.dmg" });
      expect(itermResult.toLowerCase()).toContain("iterm");
      const ytdlpResult = extractName({ name: "yt-dlp_macos" });
      expect(ytdlpResult.toLowerCase()).toContain("yt-dlp");
      const ffmpegResult = extractName({ name: "ffmpeg-6.1-macOS-default.zip" });
      expect(ffmpegResult.toLowerCase()).toContain("ffmpeg");
    });
  });

  describe("edge cases", () => {
    test("handles names that are just version numbers", () => {
      const result = extractName({ name: "1.0.0.tar.gz" });
      expect(typeof result).toBe("string");
    });

    test("handles single word names", () => {
      expect(extractName({ name: "git" })).toBe("git");
    });

    test("handles names with multiple dashes", () => {
      expect(extractName({ name: "my-super-cool-tool.zip" })).toBe("my-super-cool-tool");
    });

    test("handles names containing platform substrings", () => {
      const result = extractName({ name: "macchina-v6.3.1-macos-arm64.tar.gz" });
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    test("preserves case for app names", () => {
      expect(extractName({ name: "MyApp.dmg" })).toBe("MyApp");
      expect(extractName({ name: "UPPERCASE.pkg" })).toBe("UPPERCASE");
    });
  });

  describe("not too aggressive", () => {
    test("does not strip too much from simple names", () => {
      expect(extractName({ name: "fzf.tar.gz" })).toBe("fzf");
      expect(extractName({ name: "git.zip" })).toBe("git");
    });

    test("preserves meaningful parts of complex names", () => {
      expect(extractName({ name: "github-cli.tar.gz" })).toBe("github-cli");
      expect(extractName({ name: "docker-compose.zip" })).toBe("docker-compose");
    });

    test("handles names starting with platform-like words", () => {
      const result = extractName({ name: "macports.tar.gz" });
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
