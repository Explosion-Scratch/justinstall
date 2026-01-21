const { describe, test, expect } = require("bun:test");
const { getPlatformInfo, selectBestAsset } = require("./installers");

describe("getPlatformInfo", () => {
  test("returns current platform", () => {
    const info = getPlatformInfo();
    expect(info.platform).toBe(process.platform);
  });

  test("returns current architecture", () => {
    const info = getPlatformInfo();
    expect(info.arch).toBe(process.arch);
  });

  test("includes architecture aliases", () => {
    const info = getPlatformInfo();
    expect(info.archAliases).toBeDefined();
    expect(info.archAliases.arm64).toContain("arm64");
    expect(info.archAliases.arm64).toContain("aarch64");
    expect(info.archAliases.x64).toContain("x64");
    expect(info.archAliases.x64).toContain("x86_64");
  });

  test("includes platform aliases", () => {
    const info = getPlatformInfo();
    expect(info.platformAliases).toBeDefined();
    expect(info.platformAliases.darwin).toContain("darwin");
    expect(info.platformAliases.darwin).toContain("macos");
    expect(info.platformAliases.darwin).toContain("mac");
    expect(info.platformAliases.linux).toContain("linux");
    expect(info.platformAliases.win32).toContain("windows");
  });

  test("includes my platform preferences", () => {
    const info = getPlatformInfo();
    expect(info.myPlatform).toBeDefined();
    expect(Array.isArray(info.myPlatform)).toBe(true);
    expect(info.myPlatform.length).toBeGreaterThan(0);
  });

  test("includes my arch preferences", () => {
    const info = getPlatformInfo();
    expect(info.myArch).toBeDefined();
    expect(Array.isArray(info.myArch)).toBe(true);
    expect(info.myArch.length).toBeGreaterThan(0);
  });

  test("includes platform boosters", () => {
    const info = getPlatformInfo();
    expect(info.boosters).toBeDefined();
    expect(info.boosters.darwin).toBeDefined();
    expect(info.boosters.linux).toBeDefined();
    expect(info.boosters.win32).toBeDefined();
  });
});

describe("selectBestAsset", () => {
  const createAsset = (name, extension = null) => ({
    name,
    extension: extension || name.split('.').pop(),
    segments: name.split(/[_.\-]/).map(s => s.toLowerCase()),
  });

  const mockPlatformInfo = {
    arch: "arm64",
    platform: "darwin",
    myArch: ["arm64", "aarch64", "silicon", "m1", "m2", "m3"],
    myPlatform: ["darwin", "macos", "mac", "apple", "osx"],
    archAliases: {
      arm64: ["arm64", "arm", "aarch", "aarch64", "aar64", "silicon"],
      x64: ["x64", "intel", "x86_64"],
      universal: ["universal", "all"],
    },
    platformAliases: {
      darwin: ["darwin", "osx", "macos", "mac", "apple"],
      linux: ["linux"],
      win32: ["win32", "win", "windows"],
    },
    boosters: {
      darwin: ["dmg", "pkg", "app"],
      linux: ["AppImage", "deb", "rpm"],
      win32: ["exe", "msi"],
    },
  };

  const mockCapabilities = {
    dmg: true,
    pkg: true,
    app: true,
    deb: false,
    rpm: false,
  };

  describe("platform matching", () => {
    test("selects darwin asset for macOS", () => {
      const assets = [
        createAsset("tool-darwin-arm64.tar.gz", "tar.gz"),
        createAsset("tool-linux-x64.tar.gz", "tar.gz"),
        createAsset("tool-windows-x64.zip", "zip"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.name).toContain("darwin");
    });

    test("selects macos asset for macOS", () => {
      const assets = [
        createAsset("tool-macos-arm64.tar.gz", "tar.gz"),
        createAsset("tool-linux-x64.tar.gz", "tar.gz"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.name).toContain("macos");
    });

    test("filters out incompatible platforms", () => {
      const assets = [
        createAsset("tool-linux-x64.tar.gz", "tar.gz"),
        createAsset("tool-windows-x64.exe", "exe"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeNull();
    });
  });

  describe("architecture matching", () => {
    test("prefers matching architecture", () => {
      const assets = [
        createAsset("tool-darwin-arm64.tar.gz", "tar.gz"),
        createAsset("tool-darwin-x64.tar.gz", "tar.gz"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.name).toContain("arm64");
    });

    test("accepts aarch64 for arm64", () => {
      const assets = [
        createAsset("tool-darwin-aarch64.tar.gz", "tar.gz"),
        createAsset("tool-darwin-x64.tar.gz", "tar.gz"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.name).toContain("aarch64");
    });

    test("accepts universal or no-arch assets", () => {
      const assets = [
        createAsset("tool-darwin.dmg", "dmg"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.name).toContain("darwin");
    });
  });

  describe("extension preferences", () => {
    test("prefers DMG over tar.gz on macOS", () => {
      const assets = [
        createAsset("tool-darwin-arm64.tar.gz", "tar.gz"),
        createAsset("Tool-darwin-arm64.dmg", "dmg"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.extension).toBe("dmg");
    });

    test("prefers PKG over zip on macOS", () => {
      const assets = [
        createAsset("tool-darwin-arm64.zip", "zip"),
        createAsset("tool-darwin-arm64.pkg", "pkg"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.extension).toBe("pkg");
    });
  });

  describe("real-world scenarios", () => {
    test("handles fzf release assets", () => {
      const assets = [
        createAsset("fzf-0.54.0-darwin_arm64.tar.gz", "tar.gz"),
        createAsset("fzf-0.54.0-darwin_amd64.tar.gz", "tar.gz"),
        createAsset("fzf-0.54.0-linux_amd64.tar.gz", "tar.gz"),
        createAsset("fzf-0.54.0-linux_arm64.tar.gz", "tar.gz"),
        createAsset("fzf-0.54.0-windows_amd64.zip", "zip"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.name).toContain("darwin");
      expect(result.name).toContain("arm64");
    });

    test("handles ripgrep release assets", () => {
      const assets = [
        createAsset("ripgrep-14.1.0-aarch64-apple-darwin.tar.gz", "tar.gz"),
        createAsset("ripgrep-14.1.0-x86_64-apple-darwin.tar.gz", "tar.gz"),
        createAsset("ripgrep-14.1.0-x86_64-unknown-linux-gnu.tar.gz", "tar.gz"),
        createAsset("ripgrep-14.1.0-x86_64-pc-windows-msvc.zip", "zip"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.name).toContain("apple-darwin");
      expect(result.name).toContain("aarch64");
    });

    test("handles app with only DMG releases", () => {
      const assets = [
        createAsset("MyApp-1.0.0.dmg", "dmg"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
      expect(result.extension).toBe("dmg");
    });
  });

  describe("edge cases", () => {
    test("returns null for empty asset list", () => {
      const result = selectBestAsset([], mockPlatformInfo, mockCapabilities);
      expect(result).toBeNull();
    });

    test("handles assets without explicit platform", () => {
      const assets = [
        createAsset("tool.tar.gz", "tar.gz"),
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
    });

    test("handles direct binary assets", () => {
      const assets = [
        { name: "yt-dlp_macos", extension: null, segments: ["yt", "dlp", "macos"] },
      ];

      const result = selectBestAsset(assets, mockPlatformInfo, mockCapabilities);
      expect(result).toBeDefined();
    });
  });
});
