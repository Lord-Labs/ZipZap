import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules", "target", "dist", ".research-local"]);

export function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? markdownFiles(filename)
      : entry.name.endsWith(".md")
        ? [filename]
        : [];
  });
}

export function checkLinks(markdown, source, repositoryRoot, exists = existsSync) {
  const errors = [];
  // shortcut: inline links only, use a Markdown parser if reference-style links are introduced.
  const content = markdown.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "");
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
    let filename;
    try {
      filename = decodeURIComponent(target.split(/[?#]/, 1)[0]);
    } catch {
      errors.push(`Invalid URL encoding: ${target}`);
      continue;
    }
    if (!filename) continue;
    const resolved = path.resolve(path.dirname(source), filename);
    const relative = path.relative(repositoryRoot, resolved);
    if (path.isAbsolute(filename) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
      errors.push(`Target is outside the repository: ${target}`);
    } else if (!exists(resolved)) {
      errors.push(`Missing local target: ${target}`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failures = 0;
  const files = markdownFiles(root);
  for (const filename of files) {
    for (const error of checkLinks(readFileSync(filename, "utf8"), filename, root)) {
      console.error(`${path.relative(root, filename)}: ${error}`);
      failures++;
    }
  }
  if (failures) process.exitCode = 1;
  else console.log(`Checked local links in ${files.length} Markdown files.`);
}
