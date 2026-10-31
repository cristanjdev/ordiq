import {
  type FacultyRecord,
  getMasterDataState,
  type LlmUsageRecord,
} from "../master-data/master-data.store";

export interface PseudonymMapEntry {
  facultyCode: string;
  alias: string;
  fullName: string;
  normalizedFull: string;
  surname: string;
  normalizedSurname: string;
  givenTokens: string[];
}

export interface CapturedLlmEgressPayload {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  systemPrompt: string;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolName?: string;
  }>;
}

const capturedEgressPayloads: CapturedLlmEgressPayload[] = [];

export function getCapturedLlmEgressPayloads(): CapturedLlmEgressPayload[] {
  return [...capturedEgressPayloads];
}

export function clearCapturedLlmEgressPayloads(): void {
  capturedEgressPayloads.length = 0;
}

const HONORIFIC_LIST = [
  "professor",
  "prof\\.",
  "prof",
  "doctor",
  "dr\\.",
  "dr",
  "engineer",
  "engr\\.",
  "engr",
  "atty\\.",
  "atty",
  "arch\\.",
  "arch",
  "ma'am",
  "maam",
  "madam",
  "sir",
  "mr\\.",
  "mr",
  "ms\\.",
  "ms",
  "mrs\\.",
  "mrs",
];

const GIVEN_TOKEN_STOPWORDS = new Set([
  "faculty",
  "member",
  "coordinator",
  "schedule",
  "engineering",
  "college",
  "section",
  "subject",
  "lecture",
  "laboratory",
  "del",
  "dela",
  "los",
  "las",
  "san",
]);

const HONORIFIC_REGEX_PART = `(?:${HONORIFIC_LIST.join("|")})`;

/**
 * Strip diacritics/accents (e.g. Ñ -> N, á -> a) and normalize case.
 */
export function normalizeDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Compute Levenshtein edit distance between two lowercase ASCII strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const curr = new Array<number>(n + 1).fill(0);
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    prev = curr;
  }
  return prev[n] ?? 0;
}

/**
 * Build the lookup table of faculty names, surnames, and given-name tokens to aliases.
 */
export function buildFacultyPseudonymTable(
  facultyList?: FacultyRecord[],
): PseudonymMapEntry[] {
  const records =
    facultyList ?? Array.from(getMasterDataState().faculty.values());
  const entries: PseudonymMapEntry[] = [];

  for (const fac of records) {
    const rawName = (fac as { fullName?: string }).fullName ?? fac.name;
    const strippedHonorific = rawName
      .replace(new RegExp(`^\\s*${HONORIFIC_REGEX_PART}\\s+`, "i"), "")
      .trim();
    const rawTokens = strippedHonorific
      .split(/[\s,.-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    const surname = rawTokens[rawTokens.length - 1] ?? strippedHonorific;
    const givenTokens = rawTokens
      .slice(0, -1)
      .filter((t) => t.length >= 3)
      .map((t) => normalizeDiacritics(t).toLowerCase())
      .filter((t) => !GIVEN_TOKEN_STOPWORDS.has(t));

    entries.push({
      facultyCode: fac.code,
      alias: fac.alias,
      fullName: rawName,
      normalizedFull: normalizeDiacritics(strippedHonorific).toLowerCase(),
      surname,
      normalizedSurname: normalizeDiacritics(surname).toLowerCase(),
      givenTokens,
    });
  }

  // Sort longest full names first so full names match before single surnames
  entries.sort((a, b) => b.normalizedFull.length - a.normalizedFull.length);
  return entries;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a character-class pattern that matches both accented and unaccented variations
 * of an ASCII-normalized token.
 */
function buildAccentInsensitivePattern(asciiToken: string): string {
  const charMap: Record<string, string> = {
    a: "[aàáâãäåā]",
    e: "[eèéêëē]",
    i: "[iìíîïī]",
    o: "[oòóôõöō]",
    u: "[uùúûüū]",
    n: "[nñ]",
    c: "[cç]",
  };
  return asciiToken
    .split("")
    .map((ch) => {
      const lower = ch.toLowerCase();
      return charMap[lower] ?? escapeRegExp(ch);
    })
    .join("");
}

/**
 * Replace all occurrences of faculty names, surnames, honorific+name patterns,
 * accent variations, and fuzzy misspellings next to honorifics with `Faculty.alias`.
 * Also strips email addresses and phone numbers.
 */
export function pseudonymizeText(
  text: string,
  customFaculty?: FacultyRecord[],
): string {
  if (!text) return text;
  const table = buildFacultyPseudonymTable(customFaculty);
  let output = text;

  // 1. Redact email addresses and phone numbers
  output = output.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "[REDACTED-EMAIL]",
  );
  output = output.replace(
    /(?:\+63|0)9\d{2}[-\s]?\d{3}[-\s]?\d{4}\b/g,
    "[REDACTED-PHONE]",
  );

  if (table.length === 0) return output;

  // 2. Replace exact and accent-insensitive full names (with or without honorific)
  for (const entry of table) {
    const rawFullNoHonorific = entry.fullName
      .replace(new RegExp(`^\\s*${HONORIFIC_REGEX_PART}\\s+`, "i"), "")
      .trim();
    const parts = rawFullNoHonorific
      .split(/\s+/)
      .filter((p) => p.length > 0)
      .map((p) => buildAccentInsensitivePattern(normalizeDiacritics(p)));

    if (parts.length > 0) {
      const fullPattern = new RegExp(
        `(?:\\b${HONORIFIC_REGEX_PART}\\s+)?\\b${parts.join("\\s+")}\\b`,
        "gi",
      );
      output = output.replace(fullPattern, entry.alias);
    }

    // Also match First + Last (skipping middle initial/name)
    if (parts.length >= 3) {
      const firstLastPattern = new RegExp(
        `(?:\\b${HONORIFIC_REGEX_PART}\\s+)?\\b${parts[0]}\\s+${parts[parts.length - 1]}\\b`,
        "gi",
      );
      output = output.replace(firstLastPattern, entry.alias);
    }
  }

  // 3. Replace honorific + given name or surname (exact or accent-insensitive)
  for (const entry of table) {
    const surnamePattern = buildAccentInsensitivePattern(entry.normalizedSurname);
    const honSurnameRegex = new RegExp(
      `\\b${HONORIFIC_REGEX_PART}\\s+${surnamePattern}\\b`,
      "gi",
    );
    output = output.replace(honSurnameRegex, entry.alias);

    for (const given of entry.givenTokens) {
      const givenPattern = buildAccentInsensitivePattern(given);
      const honGivenRegex = new RegExp(
        `\\b${HONORIFIC_REGEX_PART}\\s+${givenPattern}\\b`,
        "gi",
      );
      output = output.replace(honGivenRegex, entry.alias);
    }
  }

  // 4. Fuzzy match misspelled names immediately following an honorific (e.g., "Prof. Sntos", "Sir Dlaz")
  const honorificNextTokenRegex = new RegExp(
    `(\\b${HONORIFIC_REGEX_PART})\\s+([A-Za-zÀ-ÖØ-öø-ÿ]{3,})(?:\\s+([A-Za-zÀ-ÖØ-öø-ÿ]{3,}))?`,
    "gi",
  );
  output = output.replace(
    honorificNextTokenRegex,
    (fullMatch, _hon: string, token1: string, token2?: string) => {
      if (token1.toUpperCase().startsWith("ALIAS")) return fullMatch;
      const norm1 = normalizeDiacritics(token1).toLowerCase();
      const norm2 = token2 ? normalizeDiacritics(token2).toLowerCase() : null;

      let bestAlias: string | null = null;
      let bestDistance = 99;

      for (const entry of table) {
        const candidates = [entry.normalizedSurname, ...entry.givenTokens];
        for (const cand of candidates) {
          if (cand.length < 4) continue;
          const maxDist = cand.length >= 6 ? 2 : 1;
          const d1 = levenshteinDistance(norm1, cand);
          if (d1 <= maxDist && d1 < bestDistance) {
            bestDistance = d1;
            bestAlias = entry.alias;
          }
          if (norm2) {
            const d2 = levenshteinDistance(norm2, cand);
            if (d2 <= maxDist && d2 < bestDistance) {
              bestDistance = d2;
              bestAlias = entry.alias;
            }
          }
        }
      }

      if (bestAlias) {
        return bestAlias;
      }
      return fullMatch;
    },
  );

  // 5. Replace standalone surnames and standalone distinctive given names (>= 4 chars)
  for (const entry of table) {
    if (entry.normalizedSurname.length >= 3) {
      const surnamePattern = buildAccentInsensitivePattern(entry.normalizedSurname);
      const standaloneSurname = new RegExp(`\\b${surnamePattern}\\b`, "gi");
      output = output.replace(standaloneSurname, entry.alias);
    }
    for (const given of entry.givenTokens) {
      if (given.length >= 4) {
        const givenPattern = buildAccentInsensitivePattern(given);
        const standaloneGiven = new RegExp(`\\b${givenPattern}\\b`, "gi");
        output = output.replace(standaloneGiven, entry.alias);
      }
    }
  }

  // 6. Collapse duplicate consecutive aliases (e.g. "ALIAS-001 ALIAS-001" -> "ALIAS-001")
  output = output.replace(/\b(ALIAS-\d{3})(?:\s+\1)+\b/g, "$1");

  return output;
}

/**
 * Restore `ALIAS-XXX` codes back to real faculty full names in complete text.
 */
export function restoreFacultyNamesInText(
  text: string,
  customFaculty?: FacultyRecord[],
): string {
  if (!text) return text;
  const records =
    customFaculty ?? Array.from(getMasterDataState().faculty.values());
  const aliasToName = new Map<string, string>();
  for (const fac of records) {
    const rawName = (fac as { fullName?: string }).fullName ?? fac.name;
    aliasToName.set(fac.alias.toUpperCase(), rawName);
  }

  return text.replace(/\bALIAS-\d{3}\b/gi, (match) => {
    return aliasToName.get(match.toUpperCase()) ?? match;
  });
}

/**
 * Streaming de-pseudonymizer that buffers trailing partial `ALIAS-XXX` tokens across
 * arbitrary chunk boundaries so split tokens are always restored to real faculty names.
 */
export class DePseudonymizerStream {
  private buffer = "";
  private readonly customFaculty?: FacultyRecord[];

  constructor(customFaculty?: FacultyRecord[]) {
    this.customFaculty = customFaculty;
  }

  public pushChunk(chunk: string): string {
    this.buffer += chunk;

    // Check if the end of the buffer could be the start of "ALIAS-\d{3}"
    // Partial prefixes: "A", "AL", "ALI", "ALIA", "ALIAS", "ALIAS-", "ALIAS-0", "ALIAS-00"
    const partialMatch = this.buffer.match(/A(?:L(?:I(?:A(?:S(?:-\d{0,2})?)?)?)?)?$/i);
    if (partialMatch && partialMatch.index !== undefined) {
      const safePart = this.buffer.slice(0, partialMatch.index);
      this.buffer = this.buffer.slice(partialMatch.index);
      return restoreFacultyNamesInText(safePart, this.customFaculty);
    }

    const complete = this.buffer;
    this.buffer = "";
    return restoreFacultyNamesInText(complete, this.customFaculty);
  }

  public flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return restoreFacultyNamesInText(remaining, this.customFaculty);
  }
}

/**
 * Allowlist of fields permitted to leave ORDIQ in tool results sent to the LLM.
 * Free-text notes, contact details, raw imports, and real faculty names are blocked.
 */
const ALLOWED_TOOL_RESULT_KEYS = new Set<string>([
  "termCode",
  "scheduleId",
  "candidateLabel",
  "profileName",
  "status",
  "solverStatus",
  "qualityScore",
  "hardViolationCount",
  "softPenaltyTotal",
  "unscheduledCount",
  "recheckNeeded",
  "version",
  "canGenerate",
  "criticalCount",
  "warningCount",
  "iso25012Scores",
  "completeness",
  "accuracy",
  "consistency",
  "currentness",
  "overall",
  "counts",
  "programs",
  "faculty",
  "subjects",
  "sections",
  "rooms",
  "offerings",
  "fixedBlocks",
  "issues",
  "code",
  "severity",
  "dimension",
  "entityCode",
  "message",
  "entries",
  "id",
  "offeringCode",
  "meetingIndex",
  "facultyCode",
  "facultyAlias",
  "roomCode",
  "sectionCode",
  "subjectCode",
  "weekday",
  "startMin",
  "endMin",
  "pinned",
  "violations",
  "constraintId",
  "waivable",
  "waived",
  "recordIds",
  "unmetPreferences",
  "preferenceId",
  "penalty",
  "unscheduled",
  "reasonCode",
  "reasonDetail",
  "alternatives",
  "qualityDelta",
  "resultingQualityScore",
  "recommendations",
  "rank",
  "score",
  "factors",
  "coldStart",
  "facultyLoads",
  "regularMaxUnits",
  "maxOverloadUnits",
  "assignedUnits",
  "utilizationPct",
  "overloadUnits",
  "statusLabel",
  "roomUtilizations",
  "roomType",
  "capacity",
  "usedMinutes",
  "availableMinutes",
  "proposalId",
  "summary",
  "valid",
  "runId",
  "candidateScheduleIds",
  "directiveId",
  "type",
  "hardness",
  "weight",
  "comparison",
  "candidateA",
  "candidateB",
  "deltas",
  "studentChangeRequestRisk",
  "totalScheduledMeetings",
  "totalMeetings",
  "beforeEntry",
  "afterEntry",
]);

const FORBIDDEN_TOOL_RESULT_KEYS = new Set<string>([
  "fullName",
  "facultyName",
  "email",
  "phone",
  "contact",
  "notes",
  "freeTextNotes",
  "rawImport",
  "passwordHash",
  "totpSecretEncrypted",
  "recoveryCodesHashed",
]);

/**
 * Recursively sanitize and pseudonymize any tool result before it is passed to an LLM.
 */
export function serializeToolResultForLlm(
  value: unknown,
  customFaculty?: FacultyRecord[],
): unknown {
  const state = getMasterDataState();
  const facCodeToAlias = new Map<string, string>();
  for (const fac of customFaculty ?? state.faculty.values()) {
    facCodeToAlias.set(fac.code, fac.alias);
  }

  function sanitizeNode(node: unknown): unknown {
    if (node === null || node === undefined) return node;
    if (typeof node === "string") {
      return pseudonymizeText(node, customFaculty);
    }
    if (typeof node === "number" || typeof node === "boolean") {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((item) => sanitizeNode(item));
    }
    if (typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (FORBIDDEN_TOOL_RESULT_KEYS.has(key)) {
          continue;
        }
        if (!ALLOWED_TOOL_RESULT_KEYS.has(key)) {
          continue;
        }
        if (key === "facultyCode" && typeof val === "string") {
          out.facultyCode = val;
          out.facultyAlias = facCodeToAlias.get(val) ?? val;
          continue;
        }
        out[key] = sanitizeNode(val);
      }
      return out;
    }
    return undefined;
  }

  return sanitizeNode(value);
}

export interface LlmGatewayRequest {
  provider?: "openai" | "anthropic" | "ollama";
  model?: string;
  systemPrompt: string;
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolName?: string;
  }>;
  synthesizedAssistantReply: string;
}

export interface LlmGatewayResponse {
  provider: "openai" | "anthropic" | "ollama";
  model: string;
  restoredReply: string;
  streamedChunks: string[];
  tokensIn: number;
  tokensOut: number;
  estimatedCostPhp: number;
  egressPayloadId: string;
}

/**
 * Check whether the monthly token budget has been exceeded.
 */
export function checkMonthlyTokenBudget(): {
  withinBudget: boolean;
  usedTokens: number;
  budgetTokens: number;
} {
  const budgetTokens = Number(process.env.LLM_MONTHLY_TOKEN_BUDGET ?? "500000");
  const state = getMasterDataState();
  const now = new Date();
  const currentMonthPrefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const usedTokens = state.llmUsage
    .filter((u) => u.createdAt.startsWith(currentMonthPrefix))
    .reduce((sum, u) => sum + u.tokensIn + u.tokensOut, 0);

  return {
    withinBudget: usedTokens < budgetTokens,
    usedTokens,
    budgetTokens,
  };
}

/**
 * Single LLM egress gateway.
 * - Pseudonymizes system prompt and all message/tool contents.
 * - Records the outgoing payload in `capturedEgressPayloads` for privacy egress auditing.
 * - Logs token counts ONLY (never message content) in `LlmUsageRecord`.
 * - Streams the assistant reply through `DePseudonymizerStream` so split `ALIAS-XXX` tokens
 *   are restored to real faculty names.
 */
export async function invokeLlmThroughPrivacyGateway(
  request: LlmGatewayRequest,
): Promise<LlmGatewayResponse> {
  const provider =
    request.provider ??
    ((process.env.LLM_PROVIDER as "openai" | "anthropic" | "ollama" | undefined) ??
      "openai");
  const model =
    request.model ??
    process.env.LLM_MODEL ??
    (provider === "anthropic"
      ? "claude-3-5-haiku-latest"
      : provider === "ollama"
        ? "qwen2.5:7b"
        : "gpt-4o-mini");

  const budget = checkMonthlyTokenBudget();
  if (!budget.withinBudget) {
    throw new Error(
      `Monthly AI token budget exceeded (${budget.usedTokens}/${budget.budgetTokens} tokens).`,
    );
  }

  // Pseudonymize every outgoing string
  const sanitizedSystemPrompt = pseudonymizeText(request.systemPrompt);
  const sanitizedMessages = request.messages.slice(-12).map((msg) => ({
    role: msg.role,
    content: pseudonymizeText(msg.content),
    ...(msg.toolName ? { toolName: msg.toolName } : {}),
  }));

  const egressPayload: CapturedLlmEgressPayload = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    provider,
    model,
    systemPrompt: sanitizedSystemPrompt,
    messages: sanitizedMessages,
  };
  capturedEgressPayloads.push(egressPayload);

  // Pseudonymize the synthesized LLM reply first (representing the raw LLM output in ALIAS codes)
  const rawAliasedReply = pseudonymizeText(request.synthesizedAssistantReply);

  // Estimate token counts (approx 4 chars per token)
  const totalInputChars =
    sanitizedSystemPrompt.length +
    sanitizedMessages.reduce((acc, m) => acc + m.content.length, 0);
  const tokensIn = Math.max(1, Math.ceil(totalInputChars / 4));
  const tokensOut = Math.max(1, Math.ceil(rawAliasedReply.length / 4));

  // Cost estimation in PHP (assuming ~₱0.009 per 1k input tokens & ~₱0.035 per 1k output tokens for mini models; 0 for local ollama)
  const estimatedCostPhp =
    provider === "ollama"
      ? 0
      : Number(((tokensIn * 0.009 + tokensOut * 0.035) / 1000).toFixed(4));

  const usageRecord: LlmUsageRecord = {
    id: crypto.randomUUID(),
    provider,
    model,
    tokensIn,
    tokensOut,
    estimatedCostPhp,
    createdAt: new Date().toISOString(),
  };
  getMasterDataState().llmUsage.push(usageRecord);

  // Stream through DePseudonymizerStream using deliberate small chunks (including splitting ALIAS tokens)
  const dePseudonymizer = new DePseudonymizerStream();
  const streamedChunks: string[] = [];
  const chunkSize = 7;
  for (let i = 0; i < rawAliasedReply.length; i += chunkSize) {
    const rawSlice = rawAliasedReply.slice(i, i + chunkSize);
    const restoredSlice = dePseudonymizer.pushChunk(rawSlice);
    if (restoredSlice.length > 0) {
      streamedChunks.push(restoredSlice);
    }
  }
  const tail = dePseudonymizer.flush();
  if (tail.length > 0) {
    streamedChunks.push(tail);
  }

  const restoredReply = streamedChunks.join("");

  return {
    provider,
    model,
    restoredReply,
    streamedChunks,
    tokensIn,
    tokensOut,
    estimatedCostPhp,
    egressPayloadId: egressPayload.id,
  };
}
