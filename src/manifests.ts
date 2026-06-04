import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";

/** A dependency declared in some manifest file. */
export interface PkgRef {
  /** Dependency name exactly as written in the manifest. */
  name: string;
  /** Declared version / constraint, or null. */
  version: string | null;
  /** Repo-relative path of the manifest it came from. */
  source: string;
}

/**
 * Normalize a name for tolerant comparison. PyPI treats runs of `_ . -` as
 * equivalent and is case-insensitive; npm names are lowercase; Go module paths
 * keep their slashes (untouched here) so identical paths still compare equal.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_.-]+/g, "-");
}

/** True if a manifest dependency name matches one of a deprecation's SDK names. */
export function nameMatches(sdk: string, depName: string): boolean {
  if (sdk.toLowerCase() === depName.toLowerCase()) return true;
  return normalizeName(sdk) === normalizeName(depName);
}

function readFileSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

const PACKAGE_JSON_DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** Parse a package.json's dependency maps into PkgRefs. */
export function parsePackageJson(content: string, source: string): PkgRef[] {
  const refs: PkgRef[] = [];
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return refs;
  }
  for (const field of PACKAGE_JSON_DEP_FIELDS) {
    const deps = json[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
      refs.push({
        name,
        version: typeof version === "string" ? version : null,
        source,
      });
    }
  }
  return refs;
}

/** Extract workspace glob patterns from a root package.json, if any. */
export function packageJsonWorkspaces(content: string): string[] {
  try {
    const json = JSON.parse(content) as Record<string, unknown>;
    const ws = json.workspaces;
    if (Array.isArray(ws)) return ws.filter((w): w is string => typeof w === "string");
    if (ws && typeof ws === "object") {
      const packages = (ws as Record<string, unknown>).packages;
      if (Array.isArray(packages)) {
        return packages.filter((w): w is string => typeof w === "string");
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

/** Parse a requirements.txt into PkgRefs. */
export function parseRequirements(content: string, source: string): PkgRef[] {
  const refs: PkgRef[] = [];
  // name, optional [extras], optional (operator + version).
  const lineRe =
    /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*((?:==|===|>=|<=|~=|!=|<|>)\s*[^\s;#]+)?/;

  for (const rawLine of content.split(/\r?\n/)) {
    // Strip inline comments and surrounding whitespace.
    let line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    // Skip pip options (-r, -e, --hash, ...) and direct URLs / VCS installs.
    if (line.startsWith("-")) continue;
    if (/^[a-z+]+:\/\//i.test(line) || line.includes("@ ")) continue;

    const m = lineRe.exec(line);
    if (!m) continue;
    const name = m[1];
    const version = m[2] ? m[2].replace(/\s+/g, "") : null;
    refs.push({ name, version, source });
  }
  return refs;
}

/** Parse a go.mod file's require directives into PkgRefs. */
export function parseGoMod(content: string, source: string): PkgRef[] {
  const refs: PkgRef[] = [];
  const lines = content.split(/\r?\n/);
  let inBlock = false;

  const pushModule = (modPart: string) => {
    // modPart looks like: "github.com/foo/bar v1.2.3 // indirect"
    const cleaned = modPart.replace(/\/\/.*$/, "").trim();
    if (!cleaned) return;
    const parts = cleaned.split(/\s+/);
    if (parts.length < 2) return;
    refs.push({ name: parts[0], version: parts[1], source });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (inBlock) {
      if (line.startsWith(")")) {
        inBlock = false;
        continue;
      }
      pushModule(line);
      continue;
    }

    if (/^require\s*\(\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    const single = /^require\s+(.+)$/.exec(line);
    if (single) pushModule(single[1]);
  }
  return refs;
}

/**
 * Collect every dependency declared in the repo's root manifests
 * (package.json, requirements.txt, go.mod) plus simple npm workspaces.
 * Returns the dependency refs and the list of manifest files that were read.
 */
export function collectManifestDeps(root: string): {
  refs: PkgRef[];
  manifests: string[];
} {
  const refs: PkgRef[] = [];
  const manifests: string[] = [];

  const addManifest = (absPath: string, parse: (c: string, rel: string) => PkgRef[]) => {
    const content = readFileSafe(absPath);
    if (content === null) return content;
    const rel = path.relative(root, absPath) || path.basename(absPath);
    manifests.push(rel);
    refs.push(...parse(content, rel));
    return content;
  };

  // Root package.json (+ workspaces).
  const rootPkgPath = path.join(root, "package.json");
  const rootPkgContent = addManifest(rootPkgPath, parsePackageJson);
  if (rootPkgContent) {
    const patterns = packageJsonWorkspaces(rootPkgContent);
    if (patterns.length > 0) {
      let wsPkgPaths: string[] = [];
      try {
        wsPkgPaths = fg.sync(
          patterns.map((p) => `${p.replace(/\/+$/, "")}/package.json`),
          {
            cwd: root,
            absolute: true,
            ignore: ["**/node_modules/**"],
            suppressErrors: true,
          }
        );
      } catch {
        wsPkgPaths = [];
      }
      for (const wsPath of wsPkgPaths) {
        if (path.resolve(wsPath) === path.resolve(rootPkgPath)) continue;
        addManifest(wsPath, parsePackageJson);
      }
    }
  }

  // Python and Go root manifests.
  addManifest(path.join(root, "requirements.txt"), parseRequirements);
  addManifest(path.join(root, "go.mod"), parseGoMod);

  return { refs, manifests };
}
