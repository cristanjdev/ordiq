import knowledgeBase from "./knowledge-base.generated.json";

/**
 * Documentation knowledge for the AI assistant (retrieval, not fine-tuning).
 *
 * The passages come from docs/ via scripts/build-knowledge.mjs. For each chat
 * turn the most relevant passages are found here with BM25 ranking and given
 * to the model as reference text, so answers about how ORDIQ works, its
 * rules, workflow, privacy and settings follow the project documents. The
 * search runs locally; nothing is sent anywhere to find the passages.
 */

export interface KnowledgePassage {
  id: string;
  source: string;
  section: string;
  priority: number;
  text: string;
}

export interface KnowledgeHit extends KnowledgePassage {
  score: number;
}

const PASSAGES = (knowledgeBase as { passages: KnowledgePassage[] }).passages;

// English and Filipino words that carry no meaning for search.
const STOPWORDS = new Set(
  `a an and are as at be been but by can could did do does for from had has have how i if in into is it its
  me my no not of on or our please should so than that the their them then there these they this to us was
  we were what when where which who why will with would you your about tell show give explain
  ang ng mga sa na ba ko mo ito iyan yan yung nang kung para po ako ikaw siya kami tayo natin namin nila
  niya ay at din rin lang lamang pa ano anong paano pano saan bakit kailan sino alin pwede puwede paki
  naman kasi talaga dito doon diyan meron mayroon wala hindi oo`.split(/\s+/),
);

// Greetings and thanks: a message made only of these gets no passages.
const SMALL_TALK = new Set(
  `hello hi hey good morn morning afternoon evening night day thank thanks salamat maraming magandang
  umaga hapon gabi ok okay sige noted nice great cool kumusta kamusta musta bye`.split(/\s+/),
);

// Query words that should also match the documents' own vocabulary.
const SYNONYMS: Record<string, string[]> = {
  "2fa": ["two", "factor", "authentication", "totp"],
  mfa: ["two", "factor", "authentication", "totp"],
  otp: ["totp", "authentication", "code"],
  totp: ["authentication", "two", "factor"],
  authenticator: ["totp", "two", "factor"],
  gemini: ["ai", "provider", "llm"],
  openai: ["ai", "provider", "llm"],
  provider: ["ai", "llm"],
  register: ["sign", "account", "signup"],
  signup: ["sign", "account", "register"],
  account: ["sign", "dean"],
  language: ["english", "filipino", "taglish"],
  languages: ["english", "filipino", "taglish"],
  tagalog: ["filipino", "taglish"],
  start: ["create", "generate", "step"],
  login: ["sign"],
  log: ["sign"],
  logout: ["sign", "out"],
  signin: ["sign"],
  password: ["password", "credential"],
  lock: ["lockout", "failed", "attempts"],
  lockout: ["locked", "lock", "attempts", "minutes"],
  locked: ["lockout", "failed", "attempts"],
  expire: ["inactivity", "session", "idle"],
  timeout: ["inactivity", "session", "idle"],
  idle: ["inactivity", "session"],
  conflict: ["violation", "hard", "constraint"],
  conflicts: ["violation", "hard", "constraint"],
  clash: ["conflict", "violation", "double", "booking"],
  overlap: ["conflict", "double", "booking"],
  rule: ["constraint"],
  rules: ["constraint"],
  waive: ["waivable", "exception"],
  override: ["waivable", "exception"],
  export: ["report", "excel", "xlsx", "pdf"],
  download: ["report", "export"],
  excel: ["xlsx", "export", "report"],
  portal: ["encoding"],
  encode: ["portal", "encoding"],
  accept: ["accept", "official"],
  approve: ["accept"],
  candidate: ["candidate", "schedule"],
  generate: ["generation", "solver", "cp", "sat", "candidate"],
  solver: ["cp", "sat", "generation"],
  load: ["load", "unit", "overload"],
  workload: ["load", "unit"],
  overload: ["load", "unit", "exceed"],
  room: ["room", "laboratory"],
  lab: ["laboratory", "room"],
  privacy: ["pseudonym", "alias", "privacy"],
  alias: ["pseudonym", "privacy"],
  ml: ["machine", "learning", "recommend"],
  ai: ["assistant", "llm", "chat"],
  chatbot: ["assistant", "chat"],
  notification: ["bell", "attention"],
  notifications: ["bell", "attention"],
  readiness: ["readiness", "25012", "quality"],
  directive: ["directive"],
  preference: ["preference", "soft"],
  preferences: ["preference", "soft"],
  weight: ["weight", "soft", "objective"],
  undo: ["undo", "revert"],
  revision: ["revision"],
  import: ["import", "workbook", "template"],
  // Filipino / Taglish
  iskedyul: ["schedule"],
  eskedyul: ["schedule"],
  guro: ["faculty"],
  propesor: ["faculty"],
  kwarto: ["room"],
  silid: ["room"],
  oras: ["time", "slot"],
  araw: ["day", "weekday"],
  pumasok: ["sign"],
  mag: [],
  "i-accept": ["accept"],
  "i-export": ["export"],
  "i-generate": ["generation"],
  banggaan: ["conflict"],
  sabay: ["conflict", "double", "booking"],
  kulang: ["missing", "readiness"],
  estudyante: ["student", "section"],
  seksyon: ["section"],
};

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Very small suffix stripper, enough to match "scheduling" with "schedule". */
function stem(word: string): string {
  if (word.length <= 4 || /\d/.test(word)) return word;
  let w = word;
  for (const suffix of ["ations", "ation", "ities", "ness", "ments", "ment", "ings", "ing", "ies", "ied", "ers", "ed", "es", "er", "ly", "s", "e", "y"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

/** Tokens for search. Rule codes like HC-04 / SC-12 / D-21 / Q-18 stay whole. */
export function tokenize(text: string, expand = false): string[] {
  const norm = normalize(text);
  const tokens: string[] = [];
  // "HC-07", "hc 7" and "hc7" all become "hc07".
  for (const m of norm.matchAll(/\b(hc|sc)[- ]?(\d{1,2})\b|\b(d|q)-(\d{1,2})\b/g)) {
    const prefix = m[1] ?? m[3];
    const num = m[2] ?? m[4];
    tokens.push(`${prefix}${String(Number(num)).padStart(2, "0")}`);
  }
  for (const raw of norm.split(/[^a-z0-9-]+/)) {
    const parts = raw.includes("-") && !/^(?:hc|sc|d|q)-\d/.test(raw) ? [raw, ...raw.split("-")] : [raw.replace(/-/g, "")];
    for (const word of parts) {
      if (!word || word.length < 2 || STOPWORDS.has(word)) continue;
      if (expand && SYNONYMS[word]) tokens.push(...SYNONYMS[word].map(stem));
      if (word.includes("-")) continue;
      tokens.push(stem(word));
    }
  }
  return tokens;
}

/** Edit distance, stopping early once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

/**
 * Typo tolerance: a query word the documents never use is replaced by the
 * closest document word ("acept" -> "accept", "scedule" -> "schedule").
 */
function correctTypos(terms: string[], df: Map<string, number>): string[] {
  return terms.map((term) => {
    if (df.has(term) || term.length < 4 || /\d/.test(term)) return term;
    const max = term.length >= 7 ? 2 : 1;
    let best = term;
    let bestDist = max + 1;
    let bestDf = 0;
    for (const [word, count] of df) {
      if (word[0] !== term[0] && word[1] !== term[1]) continue;
      const d = editDistance(term, word, max);
      if (d < bestDist || (d === bestDist && count > bestDf)) {
        best = word;
        bestDist = d;
        bestDf = count;
      }
    }
    return bestDist <= max ? best : term;
  });
}

interface IndexedPassage {
  passage: KnowledgePassage;
  tf: Map<string, number>;
  length: number;
}

interface Index {
  docs: IndexedPassage[];
  df: Map<string, number>;
  avgLength: number;
}

let cachedIndex: Index | null = null;

function buildIndex(): Index {
  const docs: IndexedPassage[] = [];
  const df = new Map<string, number>();
  let total = 0;
  for (const passage of PASSAGES) {
    // Headings count twice: they say what the passage is about.
    const tokens = [...tokenize(passage.section), ...tokenize(passage.section), ...tokenize(passage.text)];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    docs.push({ passage, tf, length: tokens.length });
    total += tokens.length;
  }
  return { docs, df, avgLength: docs.length ? total / docs.length : 1 };
}

function index(): Index {
  cachedIndex ??= buildIndex();
  return cachedIndex;
}

const K1 = 1.4;
const B = 0.72;

/**
 * Most relevant documentation passages for a question, best first.
 * `minScore` drops weak matches so unrelated chit-chat gets no passages.
 */
export function searchKnowledge(
  query: string,
  options: { limit?: number; minScore?: number } = {},
): KnowledgeHit[] {
  const { limit = 4, minScore = 3 } = options;
  const { docs, df, avgLength } = index();
  const raw = tokenize(query);
  if (raw.every((t) => SMALL_TALK.has(t))) return [];
  const terms = [...new Set(correctTypos(tokenize(query, true), df))];
  if (terms.length === 0) return [];
  const n = docs.length;

  const scored: KnowledgeHit[] = [];
  for (const doc of docs) {
    let score = 0;
    for (const term of terms) {
      const f = doc.tf.get(term);
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * doc.length) / avgLength));
    }
    if (score <= 0) continue;
    scored.push({ ...doc.passage, score: score * doc.passage.priority });
  }
  scored.sort((a, b) => b.score - a.score);

  // At most two passages from the same section, so one long section can't
  // crowd out the rest.
  const perSection = new Map<string, number>();
  const hits: KnowledgeHit[] = [];
  for (const hit of scored) {
    if (hit.score < minScore) break;
    const key = `${hit.source}|${hit.section}`;
    const seen = perSection.get(key) ?? 0;
    if (seen >= 2) continue;
    perSection.set(key, seen + 1);
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Passages formatted for the model's instructions, with a size cap. */
export function formatKnowledgeForPrompt(hits: KnowledgeHit[], maxChars = 6000): string {
  let used = 0;
  const blocks: string[] = [];
  for (const [i, hit] of hits.entries()) {
    const text = hit.text.length > 1800 ? `${hit.text.slice(0, 1800)}…` : hit.text;
    let block = `[${i + 1}] ${hit.source} › ${hit.section}\n${text}`;
    if (used + block.length > maxChars) {
      // Always keep the best passage, shortened to fit.
      if (blocks.length > 0) break;
      block = `${block.slice(0, Math.max(0, maxChars - 1))}…`;
    }
    blocks.push(block);
    used += block.length;
  }
  return blocks.join("\n\n");
}

/**
 * The part of a passage that answers the question: the lines (bullets,
 * steps, paragraphs) that share the most words with it, kept in their
 * original order, up to `maxChars`.
 */
export function focusExcerpt(text: string, query: string, maxChars = 900): string {
  if (text.length <= maxChars) return text;
  const terms = new Set(tokenize(query, true));
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const ranked = lines
    .map((line, i) => ({ i, line, score: tokenize(line).filter((t) => terms.has(t)).length }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const keep = new Set<number>();
  let used = 0;
  for (const { i, line, score } of ranked) {
    if (score === 0 && keep.size > 0) break;
    if (used + line.length > maxChars) {
      if (keep.size === 0) return `${line.slice(0, maxChars - 1)}…`;
      continue;
    }
    keep.add(i);
    used += line.length + 1;
  }
  const picked = [...keep].sort((a, b) => a - b);
  return picked
    .map((i, n) => (n > 0 && i !== (picked[n - 1] ?? i) + 1 ? `…\n${lines[i]}` : lines[i]))
    .join("\n");
}

/**
 * A question about how ORDIQ works rather than about this term's data
 * ("How do I accept a schedule?", "Paano i-on ang 2FA?", "What is HC-04?").
 */
export function isDocumentationQuestion(prompt: string): boolean {
  const p = normalize(prompt).trim();
  // Questions about specific records or the live schedule are data questions
  // ("Saan pwedeng ilipat ang OFF-CPE-1A-CPE101?", "Where are the conflicts
  // in the current schedule?"), answered by the tools.
  const namesData =
    /\b(off|fac)-[a-z0-9]|\ben-(lec|lab)-\d|\b[a-z]{2,4}-\d[a-z]\b|\b[a-z]{2,4} ?\d{3}[a-z]?\b|alias-\d/.test(p) ||
    /\b(this term|this semester|current schedule|current candidate|right now|today|ngayong|ngayon|engr\.|prof\.|dr\.)/.test(p);
  if (namesData && !/\b(hc|sc)-\d{1,2}\b/.test(p)) return false;
  return (
    /^(how (do|can|should|to|does)|how is .* (calculated|computed|measured)|where (do|can|is|are)|what (is|are|does|do) (an? |the )?(hc|sc|d|q)-?\d|what does .* mean|what is (ordiq|the purpose|a candidate|a directive|a fixed block|the readiness|the validator|the solver|cp-sat|pseudonym)|why (does|do|is|can't|cannot)|explain|ipaliwanag|paano|pano|saan|bakit|ano ang ibig sabihin|ano ba ang|ano ang (ordiq|hc|sc)|can i |pwede ba|puwede ba|is it possible|who can)/.test(
      p,
    ) || /\b(hc|sc)-\d{1,2}\b/.test(p)
  );
}

export function knowledgePassageCount(): number {
  return PASSAGES.length;
}
