const { describe, test, expect } = require("bun:test");
const {
  getExtension,
  isInstallable,
  isArchive,
  isPackage,
  getBoostedExtensions,
  isExtensionSupported,
  scoreAssetByExtension,
  getInstallableExtensions,
  EXTENSION_CONFIG,
} = require("./extensions");

describe("getExtension", () => {
  describe("compound extensions", () => {
    test("extracts tar.gz correctly", () => {
      expect(getExtension("file.tar.gz")).toBe("tar.gz");
    });

    test("extracts tar.xz correctly", () => {
      expect(getExtension("app-v1.2.3-linux-x64.tar.xz")).toBe("tar.xz");
    });

    test("extracts tar.bz2 correctly", () => {
      expect(getExtension("package.tar.bz2")).toBe("tar.bz2");
    });

    test("handles real-world tar.gz filenames", () => {
      expect(getExtension("helix-24.07-x86_64-macos.tar.gz")).toBe("tar.gz");
      expect(getExtension("ripgrep-14.1.0-x86_64-apple-darwin.tar.gz")).toBe("tar.gz");
      expect(getExtension("fzf-0.54.0-darwin_arm64.tar.gz")).toBe("tar.gz");
    });
  });

  describe("simple extensions", () => {
    test("extracts dmg correctly", () => {
      expect(getExtension("App.dmg")).toBe("dmg");
    });

    test("extracts pkg correctly", () => {
      expect(getExtension("installer.pkg")).toBe("pkg");
    });

    test("extracts zip correctly", () => {
      expect(getExtension("archive.zip")).toBe("zip");
    });

    test("extracts deb correctly", () => {
      expect(getExtension("package_amd64.deb")).toBe("deb");
    });

    test("extracts app correctly", () => {
      expect(getExtension("MyApp.app")).toBe("app");
    });

    test("extracts exe correctly", () => {
      expect(getExtension("setup.exe")).toBe("exe");
    });

    test("handles real-world DMG filenames", () => {
      expect(getExtension("Pearcleaner.dmg")).toBe("dmg");
      expect(getExtension("Visual Studio Code-darwin-universal.dmg")).toBe("dmg");
      expect(getExtension("iTerm2-3_5_4.dmg")).toBe("dmg");
    });
  });

  describe("edge cases", () => {
    test("returns empty string for no extension", () => {
      expect(getExtension("binary")).toBe("");
    });

    test("returns empty string for null input", () => {
      expect(getExtension(null)).toBe("");
    });

    test("returns empty string for undefined input", () => {
      expect(getExtension(undefined)).toBe("");
    });

    test("returns empty string for empty string", () => {
      expect(getExtension("")).toBe("");
    });

    test("handles hidden files", () => {
      expect(getExtension(".gitignore")).toBe("gitignore");
    });

    test("handles multiple dots in filename", () => {
      expect(getExtension("app.min.js")).toBe("js");
      expect(getExtension("file.backup.zip")).toBe("zip");
    });

    test("is not confused by tar in filename that isn't tar.gz", () => {
      expect(getExtension("tarball.zip")).toBe("zip");
      expect(getExtension("mytar.dmg")).toBe("dmg");
    });
  });
});

describe("isInstallable", () => {
  test("recognizes archive extensions", () => {
    expect(isInstallable("tar.gz")).toBe(true);
    expect(isInstallable("tar.xz")).toBe(true);
    expect(isInstallable("tar.bz2")).toBe(true);
    expect(isInstallable("zip")).toBe(true);
    expect(isInstallable("tar.zst")).toBe(true);
    expect(isInstallable("7z")).toBe(true);
  });

  test("recognizes package extensions", () => {
    expect(isInstallable("dmg")).toBe(true);
    expect(isInstallable("pkg")).toBe(true);
    expect(isInstallable("app")).toBe(true);
    expect(isInstallable("deb")).toBe(true);
    expect(isInstallable("rpm")).toBe(true);
    expect(isInstallable("exe")).toBe(true);
    expect(isInstallable("msi")).toBe(true);
    expect(isInstallable("AppImage")).toBe(true);
  });

  test("rejects unknown extensions", () => {
    expect(isInstallable("txt")).toBe(false);
    expect(isInstallable("md")).toBe(false);
    expect(isInstallable("json")).toBe(false);
    expect(isInstallable("yaml")).toBe(false);
    expect(isInstallable("")).toBe(false);
  });
});

describe("isArchive", () => {
  test("returns true for archive types", () => {
    expect(isArchive("tar.gz")).toBe(true);
    expect(isArchive("tar.xz")).toBe(true);
    expect(isArchive("zip")).toBe(true);
    expect(isArchive("tar.zst")).toBe(true);
  });

  test("returns false for package types", () => {
    expect(isArchive("dmg")).toBe(false);
    expect(isArchive("pkg")).toBe(false);
    expect(isArchive("deb")).toBe(false);
  });

  test("returns false for unknown types", () => {
    expect(isArchive("txt")).toBe(false);
    expect(isArchive("")).toBe(false);
  });
});

describe("isPackage", () => {
  test("returns true for package types", () => {
    expect(isPackage("dmg")).toBe(true);
    expect(isPackage("pkg")).toBe(true);
    expect(isPackage("app")).toBe(true);
    expect(isPackage("deb")).toBe(true);
    expect(isPackage("rpm")).toBe(true);
    expect(isPackage("exe")).toBe(true);
    expect(isPackage("msi")).toBe(true);
  });

  test("returns false for archive types", () => {
    expect(isPackage("tar.gz")).toBe(false);
    expect(isPackage("zip")).toBe(false);
  });

  test("returns false for unknown types", () => {
    expect(isPackage("txt")).toBe(false);
    expect(isPackage("")).toBe(false);
  });
});

describe("getBoostedExtensions", () => {
  test("returns correct boosters for darwin", () => {
    const boosted = getBoostedExtensions("darwin");
    expect(boosted).toContain("dmg");
    expect(boosted).toContain("pkg");
    expect(boosted).toContain("app");
    expect(boosted).not.toContain("exe");
    expect(boosted).not.toContain("deb");
  });

  test("returns correct boosters for linux", () => {
    const boosted = getBoostedExtensions("linux");
    expect(boosted).toContain("AppImage");
    expect(boosted).toContain("deb");
    expect(boosted).toContain("rpm");
    expect(boosted).not.toContain("dmg");
    expect(boosted).not.toContain("exe");
  });

  test("returns correct boosters for win32", () => {
    const boosted = getBoostedExtensions("win32");
    expect(boosted).toContain("exe");
    expect(boosted).toContain("msi");
    expect(boosted).not.toContain("dmg");
    expect(boosted).not.toContain("deb");
  });

  test("returns empty array for unknown platform", () => {
    const boosted = getBoostedExtensions("unknown");
    expect(boosted).toEqual([]);
  });
});

describe("isExtensionSupported", () => {
  const darwinCapabilities = { dmg: true, pkg: true, app: true, deb: false };
  const linuxCapabilities = { dmg: false, pkg: false, app: false, deb: true, rpm: true };

  test("darwin supports macOS packages", () => {
    expect(isExtensionSupported("dmg", "darwin", darwinCapabilities)).toBe(true);
    expect(isExtensionSupported("pkg", "darwin", darwinCapabilities)).toBe(true);
    expect(isExtensionSupported("app", "darwin", darwinCapabilities)).toBe(true);
  });

  test("darwin does not support linux packages", () => {
    expect(isExtensionSupported("deb", "darwin", darwinCapabilities)).toBe(false);
  });

  test("linux supports linux packages", () => {
    expect(isExtensionSupported("deb", "linux", linuxCapabilities)).toBe(true);
    expect(isExtensionSupported("rpm", "linux", linuxCapabilities)).toBe(true);
  });

  test("linux does not support macOS packages", () => {
    expect(isExtensionSupported("dmg", "linux", linuxCapabilities)).toBe(false);
    expect(isExtensionSupported("pkg", "linux", linuxCapabilities)).toBe(false);
  });

  test("archives are supported on all platforms", () => {
    expect(isExtensionSupported("tar.gz", "darwin", darwinCapabilities)).toBe(true);
    expect(isExtensionSupported("tar.gz", "linux", linuxCapabilities)).toBe(true);
    expect(isExtensionSupported("zip", "darwin", darwinCapabilities)).toBe(true);
    expect(isExtensionSupported("zip", "linux", linuxCapabilities)).toBe(true);
  });

  test("no extension returns true (could be executable)", () => {
    expect(isExtensionSupported(null, "darwin", darwinCapabilities)).toBe(true);
    expect(isExtensionSupported("", "linux", linuxCapabilities)).toBe(true);
  });
});

describe("scoreAssetByExtension", () => {
  const darwinCapabilities = { dmg: true, pkg: true, app: true };
  const linuxCapabilities = { deb: true, rpm: true };

  test("scores macOS packages higher on darwin", () => {
    const dmgAsset = { extension: "dmg" };
    const zipAsset = { extension: "zip" };

    const dmgScore = scoreAssetByExtension(dmgAsset, "darwin", darwinCapabilities);
    const zipScore = scoreAssetByExtension(zipAsset, "darwin", darwinCapabilities);

    expect(dmgScore).toBeGreaterThan(zipScore);
  });

  test("scores linux packages higher on linux", () => {
    const debAsset = { extension: "deb" };
    const tarAsset = { extension: "tar.gz" };

    const debScore = scoreAssetByExtension(debAsset, "linux", linuxCapabilities);
    const tarScore = scoreAssetByExtension(tarAsset, "linux", linuxCapabilities);

    expect(debScore).toBeGreaterThan(tarScore);
  });

  test("returns -1 for incompatible extensions", () => {
    const exeAsset = { extension: "exe" };
    const score = scoreAssetByExtension(exeAsset, "darwin", darwinCapabilities);
    expect(score).toBe(-1);
  });

  test("gives points to assets without extension (direct binaries)", () => {
    const binaryAsset = { extension: undefined };
    const score = scoreAssetByExtension(binaryAsset, "darwin", darwinCapabilities);
    expect(score).toBeGreaterThan(0);
  });
});

describe("getInstallableExtensions", () => {
  test("returns all installable extensions", () => {
    const extensions = getInstallableExtensions();
    expect(extensions).toContain("tar.gz");
    expect(extensions).toContain("zip");
    expect(extensions).toContain("dmg");
    expect(extensions).toContain("pkg");
    expect(extensions).toContain("deb");
    expect(extensions).toContain("exe");
  });

  test("returns a new array each time", () => {
    const ext1 = getInstallableExtensions();
    const ext2 = getInstallableExtensions();
    expect(ext1).not.toBe(ext2);
    expect(ext1).toEqual(ext2);
  });
});

describe("EXTENSION_CONFIG", () => {
  test("archives have extractable flag", () => {
    Object.values(EXTENSION_CONFIG.archives).forEach((config) => {
      expect(config.extractable).toBe(true);
    });
  });

  test("packages have installable flag", () => {
    Object.values(EXTENSION_CONFIG.packages).forEach((config) => {
      expect(config.installable).toBe(true);
    });
  });

  test("packages have platform restrictions", () => {
    expect(EXTENSION_CONFIG.packages.dmg.platforms).toContain("darwin");
    expect(EXTENSION_CONFIG.packages.deb.platforms).toContain("linux");
    expect(EXTENSION_CONFIG.packages.exe.platforms).toContain("win32");
  });
});
