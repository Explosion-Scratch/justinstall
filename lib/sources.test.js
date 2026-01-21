const { describe, test, expect } = require("bun:test");
const {
  parseSource,
  isIgnored,
  isInstallScript,
  scoreSnippet,
  removeCommentLines,
} = require("./sources");

describe("parseSource", () => {
  describe("GitHub URLs", () => {
    test("parses full GitHub URL", () => {
      const result = parseSource("https://github.com/junegunn/fzf");
      expect(result.type).toBe("github");
      expect(result.owner).toBe("junegunn");
      expect(result.repo).toBe("fzf");
    });

    test("parses GitHub URL with trailing slash", () => {
      const result = parseSource("https://github.com/junegunn/fzf/");
      expect(result.type).toBe("github");
      expect(result.owner).toBe("junegunn");
      expect(result.repo).toBe("fzf");
    });

    test("parses GitHub release URL with specific tag", () => {
      const result = parseSource("https://github.com/junegunn/fzf/releases/tag/v0.54.0");
      expect(result.type).toBe("github");
      expect(result.owner).toBe("junegunn");
      expect(result.repo).toBe("fzf");
      expect(result.specificTag).toBe("v0.54.0");
    });

    test("parses shorthand GitHub format", () => {
      const result = parseSource("junegunn/fzf");
      expect(result.type).toBe("github");
      expect(result.owner).toBe("junegunn");
      expect(result.repo).toBe("fzf");
    });

    test("handles repos with dashes and underscores", () => {
      const result = parseSource("helix-editor/helix");
      expect(result.type).toBe("github");
      expect(result.owner).toBe("helix-editor");
      expect(result.repo).toBe("helix");
    });

    test("handles repos with numbers", () => {
      const result = parseSource("cli/cli");
      expect(result.type).toBe("github");
      expect(result.owner).toBe("cli");
      expect(result.repo).toBe("cli");
    });
  });

  describe("direct URLs", () => {
    test("parses non-GitHub URLs as smart_url", () => {
      const result = parseSource("https://example.com/downloads/app.dmg");
      expect(result.type).toBe("smart_url");
      expect(result.url).toBe("https://example.com/downloads/app.dmg");
    });

    test("parses download pages as smart_url", () => {
      const result = parseSource("https://www.sublimetext.com/download");
      expect(result.type).toBe("smart_url");
    });
  });

  describe("error cases", () => {
    test("throws on invalid input", () => {
      expect(() => parseSource("not-a-valid-input")).toThrow();
    });

    test("throws on empty input", () => {
      expect(() => parseSource("")).toThrow();
    });
  });
});

describe("isIgnored", () => {
  describe("system files", () => {
    test("ignores __MACOSX directory", () => {
      expect(isIgnored("__MACOSX/file.txt")).toBeTruthy();
      expect(isIgnored("path/__MACOSX/something")).toBeTruthy();
    });

    test("ignores .DS_Store", () => {
      expect(isIgnored(".DS_Store")).toBeTruthy();
      expect(isIgnored("folder/.DS_Store")).toBeTruthy();
    });

    test("ignores .background directory", () => {
      expect(isIgnored(".background")).toBeTruthy();
      expect(isIgnored(".background/image.png")).toBeTruthy();
    });

    test("ignores .VolumeIcon.icns", () => {
      expect(isIgnored(".VolumeIcon.icns")).toBeTruthy();
    });

    test("ignores .keystone_install", () => {
      expect(isIgnored(".keystone_install")).toBeTruthy();
    });
  });

  describe("documentation files", () => {
    test("ignores README files", () => {
      expect(isIgnored("README")).toBeTruthy();
      expect(isIgnored("README.md")).toBeTruthy();
      expect(isIgnored("readme.txt")).toBeTruthy();
    });

    test("ignores LICENSE files", () => {
      expect(isIgnored("LICENSE")).toBeTruthy();
      expect(isIgnored("LICENSE.txt")).toBeTruthy();
      expect(isIgnored("license.md")).toBeTruthy();
    });

    test("ignores CHANGELOG files", () => {
      expect(isIgnored("CHANGELOG")).toBeTruthy();
      expect(isIgnored("CHANGELOG.md")).toBeTruthy();
    });

    test("ignores release notes", () => {
      expect(isIgnored("release_notes.txt")).toBeTruthy();
      expect(isIgnored("RELEASE_NOTES.md")).toBeTruthy();
    });
  });

  describe("checksum files", () => {
    test("ignores checksum files", () => {
      expect(isIgnored("checksums.txt")).toBeTruthy();
      expect(isIgnored("SHA256CHECKSUMS")).toBeTruthy();
    });
  });

  describe("internal directories", () => {
    test("ignores _internal directory", () => {
      expect(isIgnored("_internal/lib.so")).toBeTruthy();
      expect(isIgnored("app/_internal/data")).toBeTruthy();
    });

    test("ignores Applications directory in DMGs", () => {
      expect(isIgnored("Applications")).toBeTruthy();
    });
  });

  describe("text files", () => {
    test("ignores .txt files", () => {
      expect(isIgnored("notes.txt")).toBeTruthy();
      expect(isIgnored("info.txt")).toBeTruthy();
    });
  });

  describe("does not ignore valid files", () => {
    test("does not ignore binary files", () => {
      expect(isIgnored("myapp")).toBeFalsy();
      expect(isIgnored("tool-v1.0.0")).toBeFalsy();
    });

    test("does not ignore .app bundles", () => {
      expect(isIgnored("MyApp.app")).toBeFalsy();
    });

    test("does not ignore package files", () => {
      expect(isIgnored("app.dmg")).toBeFalsy();
      expect(isIgnored("installer.pkg")).toBeFalsy();
    });

    test("does not ignore executables", () => {
      expect(isIgnored("bin/myapp")).toBeFalsy();
      expect(isIgnored("usr/local/bin/tool")).toBeFalsy();
    });
  });

  describe("case insensitivity", () => {
    test("ignores regardless of case", () => {
      expect(isIgnored("README")).toBeTruthy();
      expect(isIgnored("readme")).toBeTruthy();
      expect(isIgnored("Readme")).toBeTruthy();
      expect(isIgnored("LICENSE")).toBeTruthy();
      expect(isIgnored("license")).toBeTruthy();
    });
  });
});

describe("isInstallScript", () => {
  describe("valid install scripts", () => {
    test("recognizes brew install", () => {
      expect(isInstallScript('brew install fzf')).toBe(true);
    });

    test("recognizes pip install", () => {
      expect(isInstallScript('pip install package')).toBe(true);
    });

    test("recognizes go install", () => {
      expect(isInstallScript('go install github.com/user/repo@latest')).toBe(true);
    });

    test("recognizes sudo apt install", () => {
      expect(isInstallScript('sudo apt install package')).toBe(true);
    });

    test("recognizes make install", () => {
      expect(isInstallScript('make install')).toBe(true);
    });
  });

  describe("invalid install scripts", () => {
    test("rejects markdown documentation", () => {
      expect(isInstallScript('See [installation](#installation) for details')).toBe(false);
    });

    test("rejects brew update commands", () => {
      expect(isInstallScript('brew update && brew upgrade')).toBe(false);
    });

    test("rejects export commands", () => {
      expect(isInstallScript('export PATH=$PATH:/usr/local/bin')).toBe(false);
    });

    test("rejects echo commands", () => {
      expect(isInstallScript('echo "Hello World"')).toBe(false);
    });

    test("rejects cd commands", () => {
      expect(isInstallScript('cd /path/to/dir')).toBe(false);
    });

    test("rejects very long commands (documentation)", () => {
      const longCommand = 'curl -fsSL ' + 'x'.repeat(250);
      expect(isInstallScript(longCommand)).toBe(false);
    });

    test("rejects commands with many flags (usage examples)", () => {
      expect(isInstallScript('tool --flag1 --flag2 --flag3 --flag4 --flag5 --flag6')).toBe(false);
    });

    test("rejects table-like content", () => {
      expect(isInstallScript('| Command | Description |')).toBe(false);
    });

    test("rejects empty or null input", () => {
      expect(isInstallScript('')).toBe(false);
      expect(isInstallScript(null)).toBe(false);
      expect(isInstallScript(undefined)).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("short install commands work", () => {
      expect(isInstallScript('brew install ripgrep')).toBe(true);
    });

    test("rejects scripts with too many lines", () => {
      const manyLines = Array(15).fill('echo "line"').join('\n');
      expect(isInstallScript(manyLines)).toBe(false);
    });
  });
});

describe("scoreSnippet", () => {
  test("scores curl | sh higher than brew", () => {
    const curlScore = scoreSnippet('curl -fsSL https://example.com/install.sh | sh');
    const brewScore = scoreSnippet('brew install tool');
    expect(curlScore).toBeGreaterThan(brewScore);
  });

  test("scores shorter scripts higher", () => {
    const shortScore = scoreSnippet('brew install fzf');
    const longerScore = scoreSnippet('brew install fzf && fzf --version && echo done');
    expect(shortScore).toBeGreaterThanOrEqual(longerScore);
  });

  test("returns 0 for empty input", () => {
    expect(scoreSnippet('')).toBe(0);
    expect(scoreSnippet(null)).toBe(0);
  });

  test("penalizes documentation-like content", () => {
    const docScore = scoreSnippet('See `brew install tool` for installation');
    const cleanScore = scoreSnippet('brew install tool');
    expect(cleanScore).toBeGreaterThan(docScore);
  });
});

describe("removeCommentLines", () => {
  test("removes hash comments", () => {
    const input = "# This is a comment\nactual command";
    expect(removeCommentLines(input)).toBe("actual command");
  });

  test("preserves shebang lines", () => {
    const input = "#!/bin/bash\n# comment\necho hello";
    const result = removeCommentLines(input);
    expect(result).toContain("#!/bin/bash");
    expect(result).toContain("echo hello");
    expect(result).not.toContain("# comment");
  });

  test("removes // comments", () => {
    const input = "// This is a comment\ncode";
    expect(removeCommentLines(input)).toBe("code");
  });

  test("removes /* comments", () => {
    const input = "/* comment */\ncode";
    const result = removeCommentLines(input);
    expect(result).toBe("code");
  });

  test("removes -- comments (SQL style)", () => {
    const input = "-- comment\ncode";
    expect(removeCommentLines(input)).toBe("code");
  });

  test("handles empty input", () => {
    expect(removeCommentLines('')).toBe('');
    expect(removeCommentLines(null)).toBe(null);
  });

  test("handles input with only comments", () => {
    const input = "# comment 1\n# comment 2";
    expect(removeCommentLines(input)).toBe("");
  });
});
