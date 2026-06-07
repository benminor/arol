/**
 * Import extraction for import-gating.
 *
 * A pattern entry with a non-empty detect.sdk only runs its patterns in a file
 * that imports a matching package. We parse imports from the SAME preprocessed
 * (comment-stripped, string-aware) text the patterns use, so comment/string
 * handling stays consistent. Regex-based, one pass per file.
 */

/** JS/TS extensions that get full import parsing. */
const JS_EXTS = new Set(["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"]);

/** A shared empty set for files we don't gate (avoids per-call allocation). */
export const NO_IMPORTS: ReadonlySet<string> = new Set();

/**
 * Languages where import-gating applies. Go is a v1 fallback (not gated) and
 * unknown extensions are never gated.
 */
export function isGateableLang(ext: string): boolean {
  const e = ext.toLowerCase();
  return JS_EXTS.has(e) || e === "py";
}

/**
 * An import source matches an sdk name if it equals it, or is a subpath of it.
 * So sdk:["ai"] matches 'ai' and 'ai/test', but NOT 'aimee' or 'ai-utils'.
 * Scoped packages behave the same: '@ai-sdk/openai' matches '@ai-sdk/openai/sub'.
 * (Intentionally stricter and case-sensitive — distinct from manifests.nameMatches.)
 */
export function sdkMatchesImport(sdkName: string, source: string): boolean {
  return source === sdkName || source.startsWith(sdkName + "/");
}

/** True if any import source in the set matches any of the entry's sdk names. */
export function importsSatisfySdk(
  sdkNames: string[],
  imports: ReadonlySet<string>,
): boolean {
  for (const sdk of sdkNames) {
    for (const source of imports) {
      if (sdkMatchesImport(sdk, source)) return true;
    }
  }
  return false;
}

/**
 * Extract the set of imported package sources from preprocessed source text.
 * JS/TS returns raw import specifiers ('ai', 'ai/test', '@ai-sdk/openai').
 * Python returns top-level module names ('openai', 'langchain').
 * Other languages (incl. Go) return an empty set — the caller does not gate them.
 */
export function extractImports(text: string, ext: string): Set<string> {
  const e = ext.toLowerCase();
  if (e === "py") return extractPythonImports(text);
  if (JS_EXTS.has(e)) return extractJsImports(text);
  return new Set(); // go / unknown — TODO: gate Go imports
}

function collect(
  text: string,
  re: RegExp,
  group: number,
  out: Set<string>,
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
    const src = m[group];
    if (src) out.add(src);
  }
}

function extractJsImports(text: string): Set<string> {
  const out = new Set<string>();
  // `import ... from '<src>'` and `export ... from '<src>'` — covers named,
  // default, namespace, aliased, `type`, and re-export. Multiline-safe: the
  // binding span excludes ; ' " ` so it can't run across statements or quotes.
  collect(
    text,
    /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"`])([^'"`]+)\1/g,
    2,
    out,
  );
  // Side-effect import: `import '<src>'` (import directly followed by a quote).
  collect(text, /\bimport\s*(['"`])([^'"`]+)\1/g, 2, out);
  // Dynamic import: `import('<src>')`.
  collect(text, /\bimport\s*\(\s*(['"`])([^'"`]+)\1/g, 2, out);
  // CommonJS: `require('<src>')`.
  collect(text, /\brequire\s*\(\s*(['"`])([^'"`]+)\1/g, 2, out);
  return out;
}

/** Top-level module of a dotted path ("openai.error" -> "openai"); "" for relative. */
function topLevelModule(mod: string): string {
  return mod.trim().split(".")[0];
}

function extractPythonImports(text: string): Set<string> {
  const out = new Set<string>();
  let m: RegExpExecArray | null;

  // `from pkg[.sub] import ...`
  const fromRe = /^[ \t]*from[ \t]+([.\w]+)[ \t]+import\b/gm;
  while ((m = fromRe.exec(text)) !== null) {
    const top = topLevelModule(m[1]);
    if (top) out.add(top); // skip relative imports ("from . import x")
  }

  // `import pkg`, `import pkg as p`, `import a, b`
  const importRe = /^[ \t]*import[ \t]+(.+)$/gm;
  while ((m = importRe.exec(text)) !== null) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/[ \t]+as[ \t]+/)[0];
      const top = topLevelModule(name);
      if (top) out.add(top);
    }
  }

  return out;
}
