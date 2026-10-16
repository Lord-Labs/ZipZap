import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkLinks, markdownFiles } from "./check-links.mjs";

test("local links resolve from the document, including encoded paths and fragments", () => {
  const root = path.resolve("fixture");
  const source = path.join(root, "docs", "guide.md");
  const targets = new Set([path.join(root, "README.md"), path.join(root, "docs", "a b.md")]);
  assert.deepEqual(
    checkLinks("[root](../README.md#setup) [space](a%20b.md)", source, root, (p) => targets.has(p)),
    [],
  );
});

test("missing links, traversal, absolute paths, and malformed encoding fail", () => {
  const root = path.resolve("fixture");
  const source = path.join(root, "README.md");
  const errors = checkLinks(
    "[missing](docs/missing.md) [escape](../outside.md) [abs](/outside.md) [bad](bad%ZZ.md)",
    source,
    root,
    () => false,
  );
  assert.equal(errors.length, 4);
  assert.match(errors[0], /Missing local target/);
  assert.match(errors[1], /outside the repository/);
  assert.match(errors[2], /outside the repository/);
  assert.match(errors[3], /Invalid URL encoding/);
});

test("external links, anchors, and fenced examples do not hit the filesystem", () => {
  const root = path.resolve("fixture");
  const source = path.join(root, "README.md");
  const markdown = [
    "[web](https://example.com) [mail](mailto:hello@example.com) [anchor](#setup)",
    "```md",
    "[example](missing.md)",
    "```",
    "~~~md",
    "[example](missing-too.md)",
    "~~~",
  ].join("\n");
  assert.deepEqual(
    checkLinks(markdown, source, root, () => {
      assert.fail("Ignored links must not be checked on disk");
    }),
    [],
  );
});

test("Markdown discovery skips Git metadata and dependency/build directories", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zipzap-links-"));
  try {
    for (const folder of ["docs", ".git", "node_modules", "target", "dist", ".research-local"]) {
      mkdirSync(path.join(root, folder));
      writeFileSync(path.join(root, folder, "note.md"), "# Note\n");
    }
    writeFileSync(path.join(root, "README.md"), "# ZipZap\n");
    assert.deepEqual(
      markdownFiles(root)
        .map((p) => path.relative(root, p))
        .sort(),
      ["README.md", path.join("docs", "note.md")].sort(),
    );
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("zipzap-links-"));
    rmSync(root, { recursive: true, force: true });
  }
});
