const { describe, test, expect } = require("bun:test");
const { fileSize, parseFlags, processInstallSnippetReplacements } = require("./utils");

describe("fileSize", () => {
  describe("bytes", () => {
    test("formats small bytes correctly", () => {
      expect(fileSize(0)).toBe("0 B");
      expect(fileSize(500)).toBe("500 B");
      expect(fileSize(1023)).toBe("1023 B");
    });
  });

  describe("binary units (default)", () => {
    test("formats KiB correctly", () => {
      expect(fileSize(1024)).toBe("1.0 KiB");
      expect(fileSize(1536)).toBe("1.5 KiB");
    });

    test("formats MiB correctly", () => {
      expect(fileSize(1024 * 1024)).toBe("1.0 MiB");
      expect(fileSize(10 * 1024 * 1024)).toBe("10.0 MiB");
    });

    test("formats GiB correctly", () => {
      expect(fileSize(1024 * 1024 * 1024)).toBe("1.0 GiB");
    });
  });

  describe("SI units", () => {
    test("formats kB correctly", () => {
      expect(fileSize(1000, true)).toBe("1.0 kB");
      expect(fileSize(1500, true)).toBe("1.5 kB");
    });

    test("formats MB correctly", () => {
      expect(fileSize(1000000, true)).toBe("1.0 MB");
      expect(fileSize(10000000, true)).toBe("10.0 MB");
    });

    test("formats GB correctly", () => {
      expect(fileSize(1000000000, true)).toBe("1.0 GB");
    });
  });

  describe("precision", () => {
    test("respects decimal places parameter", () => {
      expect(fileSize(1536, false, 2)).toBe("1.50 KiB");
      expect(fileSize(1536, false, 0)).toBe("2 KiB");
    });
  });

  describe("real-world file sizes", () => {
    test("formats typical DMG size", () => {
      const size = 10.6 * 1024 * 1024;
      const result = fileSize(size);
      expect(result).toContain("MiB");
    });

    test("formats typical binary size", () => {
      const size = 5 * 1024 * 1024;
      const result = fileSize(size);
      expect(result).toBe("5.0 MiB");
    });
  });
});

describe("parseFlags", () => {
  describe("help flag", () => {
    test("parses --help", () => {
      const { flags } = parseFlags(["--help"]);
      expect(flags.help).toBe(true);
    });

    test("parses -h", () => {
      const { flags } = parseFlags(["-h"]);
      expect(flags.help).toBe(true);
    });
  });

  describe("update flag", () => {
    test("parses --update without package", () => {
      const { flags } = parseFlags(["--update"]);
      expect(flags.update).toBe(true);
      expect(flags.updatePackage).toBeUndefined();
    });

    test("parses --update with package name", () => {
      const { flags } = parseFlags(["--update", "fzf"]);
      expect(flags.update).toBe(true);
      expect(flags.updatePackage).toBe("fzf");
    });
  });

  describe("uninstall flag", () => {
    test("parses --uninstall with package", () => {
      const { flags } = parseFlags(["--uninstall", "fzf"]);
      expect(flags.uninstall).toBe(true);
      expect(flags.uninstallPackage).toBe("fzf");
    });
  });

  describe("list flag", () => {
    test("parses --list", () => {
      const { flags } = parseFlags(["--list"]);
      expect(flags.list).toBe(true);
    });
  });

  describe("search flag", () => {
    test("parses --search without query", () => {
      const { flags } = parseFlags(["--search"]);
      expect(flags.search).toBe(true);
      expect(flags.searchQuery).toBeUndefined();
    });

    test("parses --search with query", () => {
      const { flags } = parseFlags(["--search", "terminal"]);
      expect(flags.search).toBe(true);
      expect(flags.searchQuery).toBe("terminal");
    });
  });

  describe("first flag", () => {
    test("parses --first with query", () => {
      const { flags } = parseFlags(["--first", "terminal multiplexer"]);
      expect(flags.first).toBe("terminal multiplexer");
    });

    test("throws on --first without query", () => {
      expect(() => parseFlags(["--first"])).toThrow();
    });
  });

  describe("yes flag", () => {
    test("parses --yes", () => {
      const { flags } = parseFlags(["--yes"]);
      expect(flags.yes).toBe(true);
    });
  });

  describe("remaining args", () => {
    test("returns non-flag arguments", () => {
      const { remainingArgs } = parseFlags(["junegunn/fzf"]);
      expect(remainingArgs).toEqual(["junegunn/fzf"]);
    });

    test("separates flags from args", () => {
      const { flags, remainingArgs } = parseFlags(["--yes", "junegunn/fzf"]);
      expect(flags.yes).toBe(true);
      expect(remainingArgs).toEqual(["junegunn/fzf"]);
    });

    test("handles multiple positional args", () => {
      const { remainingArgs } = parseFlags(["arg1", "arg2"]);
      expect(remainingArgs).toEqual(["arg1", "arg2"]);
    });
  });

  describe("combined flags", () => {
    test("parses multiple flags together", () => {
      const { flags } = parseFlags(["--yes", "--list"]);
      expect(flags.yes).toBe(true);
      expect(flags.list).toBe(true);
    });
  });

  describe("order independence", () => {
    test("flags work before positional args", () => {
      const { flags, remainingArgs } = parseFlags(["--yes", "repo"]);
      expect(flags.yes).toBe(true);
      expect(remainingArgs).toEqual(["repo"]);
    });

    test("flags work after positional args", () => {
      const { flags, remainingArgs } = parseFlags(["repo", "--yes"]);
      expect(flags.yes).toBe(true);
      expect(remainingArgs).toEqual(["repo"]);
    });
  });
});

describe("processInstallSnippetReplacements", () => {
  test("removes leading $ prompt", () => {
    expect(processInstallSnippetReplacements("$ npm install")).toBe("pnpm i");
  });

  test("replaces npm install with pnpm i", () => {
    expect(processInstallSnippetReplacements("npm install")).toBe("pnpm i");
  });

  test("replaces yarn install with pnpm i", () => {
    expect(processInstallSnippetReplacements("yarn install")).toBe("pnpm i");
  });

  test("preserves other commands", () => {
    expect(processInstallSnippetReplacements("brew install fzf")).toBe("brew install fzf");
  });

  test("handles multiple replacements", () => {
    expect(processInstallSnippetReplacements("$ npm install")).toBe("pnpm i");
  });

  test("handles empty input", () => {
    expect(processInstallSnippetReplacements("")).toBe("");
  });
});
