#!/usr/bin/env node
/* global console */
/**
 * Builds the AI assistant's knowledge base from the project documentation.
 *
 *   pnpm --filter @ordiq/web knowledge:build
 *
 * Reads the curated sources below, splits them into heading-scoped passages,
 * removes images, code blocks, contact details and pricing, and writes
 * src/server/modules/ai/knowledge/knowledge-base.generated.json. The JSON is
 * committed, so production never needs the docs folder. Re-run after any
 * change to the docs.
 *
 * Deliberately left out: client correspondence and quotation (names,
 * commercial terms), the manuscript's front matter and references, and
 * developer-only sections of the implementation plan.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const repoRoot = path.resolve(webRoot, "../..");
const docs = (p) => path.join(repoRoot, "docs", p);
const OUT = path.join(webRoot, "src/server/modules/ai/knowledge/knowledge-base.generated.json");

/**
 * priority: ranking boost (the in-app guide describes the current screens and
 * wins over older documents).
 * include: optional filter on top-level ("#"/"##") section titles.
 */
const SOURCES = [
  {
    file: path.join(webRoot, "src/server/modules/ai/knowledge/app-guide.md"),
    title: "ORDIQ In-App Guide",
    priority: 1.35,
  },
  {
    file: path.join(webRoot, "src/server/modules/ai/knowledge/faq.md"),
    title: "ORDIQ FAQ",
    priority: 1.3,
  },
  { file: docs("turnover/DEAN_USER_GUIDE_AND_PORTAL_ENCODING.md"), title: "Dean User Guide", priority: 1.15 },
  {
    file: docs("turnover/ARCHITECTURE_AND_KNOWN_LIMITATIONS.md"),
    title: "Architecture, Constraints & Known Limitations",
    priority: 1.1,
  },
  { file: docs("turnover/PRIVACY_AND_SECURITY_NOTES.md"), title: "Privacy & Security Notes", priority: 1.1 },
  { file: docs("turnover/OPERATIONS_AND_ADMIN_MANUAL.md"), title: "Operations & Administration Manual", priority: 0.9 },
  {
    file: docs("IMPLEMENTATION_PLAN.md"),
    title: "Implementation Plan",
    priority: 1,
    // Product, architecture flows, decisions, data lifecycle, rules, ML, scope.
    includeH2: [
      /^1\. Product goal/,
      /^2\. Architecture/,
      /^3\. Decision log/,
      /^5\. Data model/,
      /^6\. Constraint catalogue/,
      /^Phase 5: Machine learning/,
      /^13\. Out of scope/,
    ],
    dropH3: [/^Repository layout/, /^Engine API/, /^Architecture rules/],
  },
  {
    file: docs("manuscript.md"),
    title: "Research Manuscript",
    priority: 0.85,
    // Body of the paper only: no approval sheet, acknowledgements,
    // dedication, references or appendices.
    includeH1: [
      /^1\. Platform/,
      /^2\. Sustainable Development Goals/,
      /^3\. Abstract/,
      /^4\. Introduction/,
      /^5\. Review of Literature/,
      /^6\. Methods and Procedures/,
      /^7\. Results and Discussion/,
    ],
  },
];

const MAX_CHARS = 1400;
const MIN_CHARS = 90;

function clean(text) {
  return (
    text
      // images (inline and reference style), including base64 payloads
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/!\[[^\]]*\]\[[^\]]*\]/g, "")
      .replace(/^\[[^\]]+\]:\s*\S+.*$/gm, "")
      .replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, "")
      // fenced code blocks (env files, shell commands, directory trees)
      .replace(/```[\s\S]*?```/g, "")
      // html tags and comments
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, "")
      // contact details
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email removed]")
      .replace(/(\+?63|0)9\d{2}[-\s]?\d{3}[-\s]?\d{4}/g, "[number removed]")
      // markdown links -> text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // emphasis around headings like "### **Title**"
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\\([*_[\]().#-])/g, "$1")
  );
}

/** Pricing and commercial terms are not assistant knowledge. */
function dropCommercialLines(text) {
  return text
    .split("\n")
    .filter((line) => !/₱|PHP\s?\d|\bpeso/i.test(line))
    .join("\n");
}

function splitLong(body) {
  if (body.length <= MAX_CHARS) return [body];
  const paras = body.split(/\n{2,}/);
  const out = [];
  let cur = "";
  for (const p of paras) {
    if (cur && (cur + "\n\n" + p).length > MAX_CHARS) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
    // A single huge paragraph (or table): cut at line breaks.
    while (cur.length > MAX_CHARS * 1.6) {
      const cut = cur.lastIndexOf("\n", MAX_CHARS) > 200 ? cur.lastIndexOf("\n", MAX_CHARS) : MAX_CHARS;
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

function chunkMarkdown(source) {
  const raw = readFileSync(source.file, "utf8").replace(/\r\n/g, "\n");
  const lines = clean(raw).split("\n");
  const chunks = [];
  const stack = []; // [{level, title}]
  let buf = [];
  let includeTop = !source.includeH1 && !source.includeH2;
  let dropped = false;

  const flush = () => {
    const body = dropCommercialLines(buf.join("\n"))
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^[-*_]{3,}\s*$/gm, "")
      .trim();
    buf = [];
    if (!includeTop || dropped || body.length < MIN_CHARS) return;
    const headings = stack.map((s) => s.title);
    for (const piece of splitLong(body)) {
      if (piece.trim().length < MIN_CHARS) continue;
      chunks.push({ headings, text: piece.trim() });
    }
  };

  for (const line of lines) {
    const m = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) {
      buf.push(line);
      continue;
    }
    flush();
    const level = m[1].length;
    const title = m[2].replace(/\*\*/g, "").trim();
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, title });

    if (source.includeH1 && level === 1) {
      includeTop = source.includeH1.some((re) => re.test(title));
    }
    if (source.includeH2 && level === 2) {
      includeTop = source.includeH2.some((re) => re.test(title));
    }
    if (level <= 3) {
      dropped = level === 3 && (source.dropH3 ?? []).some((re) => re.test(title));
      if (level < 3) dropped = false;
    }
  }
  flush();
  return chunks;
}

const out = [];
for (const source of SOURCES) {
  const chunks = chunkMarkdown(source);
  for (const c of chunks) {
    // Drop the document's own H1 from the path when it repeats the title.
    const headings = c.headings.filter((h, i) => !(i === 0 && /ORDIQ|Implementation Plan|Manuscript/i.test(h) && source.file.endsWith(".md") && !source.includeH1));
    const section = headings.join(" › ") || source.title;
    const id = createHash("sha1").update(`${source.title}|${section}|${c.text.slice(0, 80)}`).digest("hex").slice(0, 12);
    out.push({ id, source: source.title, section, priority: source.priority, text: c.text });
  }
  console.log(`${source.title}: ${chunks.length} passages`);
}

// Last line of defence: no e-mail address or obvious secret may be written.
for (const c of out) {
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(c.text) || /(api[_-]?key|secret|password)\s*[:=]\s*\S{8,}/i.test(c.text)) {
    throw new Error(`Refusing to write passage ${c.id} (${c.section}): it looks like it contains contact details or a secret.`);
  }
}

writeFileSync(
  OUT,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), passageCount: out.length, passages: out }, null, 1)}\n`,
);
console.log(`Wrote ${out.length} passages to ${path.relative(repoRoot, OUT)}`);
