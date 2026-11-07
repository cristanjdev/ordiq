import { describe, expect, it } from "vitest";
import { GOLDEN_DOC_QUESTIONS, HELD_OUT_DOC_QUESTIONS } from "./golden-doc-questions";
import {
  focusExcerpt,
  formatKnowledgeForPrompt,
  isDocumentationQuestion,
  knowledgePassageCount,
  searchKnowledge,
} from "./knowledge.service";

/**
 * Golden documentation questions (English, Filipino, Taglish). Each must find
 * a passage from the expected section among the top three results. This is
 * the measurable part of "the assistant knows the docs": every question here
 * has to pass.
 */
const GOLDEN: Array<{ q: string; expect: RegExp }> = [
  // Sign-in, security and settings
  { q: "How do I turn off Google Authenticator two-factor?", expect: /Settings page|Signing in/ },
  { q: "Paano i-off ang 2FA?", expect: /Settings page|Signing in/ },
  { q: "Why was the account locked after wrong passwords?", expect: /Signing in|Settings page/ },
  { q: "How long before ORDIQ signs me out when idle?", expect: /Settings page|Signing in/ },
  { q: "Can I change the auto-expire inactivity limit?", expect: /Settings page/ },
  { q: "Why does saving settings ask for my password?", expect: /Settings page|ask for my password/ },
  { q: "How do I sign out?", expect: /Signing in and signing out/ },
  { q: "Is there a sign up page for coordinators?", expect: /Signing in|Dean-Only|Access Control|Decision log/ },
  { q: "How do I turn off the AI assistant?", expect: /Settings page/ },
  // Scheduling workflow
  { q: "How do I generate candidate schedules?", expect: /Schedules page|Step 2/ },
  { q: "What is the difference between Balanced, Faculty First and Student First?", expect: /Schedules page|Step 2|optimized|Candidate preferences/ },
  { q: "How do I accept a schedule as official?", expect: /Schedules page|Step 3/ },
  { q: "Why can't I accept the candidate schedule?", expect: /Schedules page|Step 3|lifecycle/i },
  { q: "Paano mag-revise ng accepted schedule?", expect: /Schedules page|lifecycle|change an accepted/i },
  { q: "How do I undo my last edit?", expect: /Schedules page/ },
  { q: "How do I waive a rule with a documented exception?", expect: /Schedules page|Step 3/ },
  { q: "Can double booking of a faculty member be waived?", expect: /Schedules page|Step 3|Hard constraints|Hard Constraints/ },
  { q: "How do I compare the candidates side by side?", expect: /Schedules page|Step 3/ },
  // Rules
  { q: "What is HC-04?", expect: /HC-04|Hard constraints|Hard Constraints/ },
  { q: "Ano ang HC-01?", expect: /HC-01|Hard constraints|Hard Constraints/ },
  { q: "What are the soft constraints SC-01 to SC-16?", expect: /Soft constraints|Soft Objectives/ },
  { q: "Why can't I edit the hard constraints?", expect: /Rules & Preferences page|Hard/ },
  { q: "How do I add a dean directive?", expect: /Rules & Preferences page|Directive types|Dean directive/ },
  { q: "What are locked fixed blocks for PATHFIT and GenEd?", expect: /Rules & Preferences page/ },
  { q: "How do I change the objective weights?", expect: /Rules & Preferences page|Soft constraints/ },
  { q: "What does the readiness gate check?", expect: /Rules & Preferences page|Step 1|Readiness|Data readiness/i },
  // Data
  { q: "How do I import the Excel workbook?", expect: /Importing data|Step 1/ },
  { q: "Where do I set faculty availability?", expect: /Faculty page/ },
  { q: "Where do I add a faculty qualification?", expect: /Faculty page|subjects a faculty member can teach/ },
  { q: "Where do I change room capacity?", expect: /Rooms & Laboratories page/ },
  { q: "Does ORDIQ store individual student records?", expect: /Minimization|Courses & Sections page|Scope|D-21|Decision log/i },
  // Reports and portal
  { q: "How do I export the schedule to Excel for portal encoding?", expect: /Reports page|Exporting Reports/ },
  { q: "Does ORDIQ connect to the university portal?", expect: /Reports page|Exporting|Out of scope/ },
  { q: "What reports can I download?", expect: /Reports page/ },
  // AI and privacy
  { q: "Are faculty names sent to the AI provider?", expect: /Privacy|Chat panel|Pseudonym/i },
  { q: "Can the chatbot accept the schedule for me?", expect: /Chat panel|Conversational AI|changing a schedule through chat/i },
  { q: "How do I apply or reject a proposal from the assistant?", expect: /AI Assistant page|Chat panel|Conversational AI/ },
  { q: "What does mark all as read do in notifications?", expect: /Notifications/ },
  { q: "How does the faculty recommendation machine learning model work?", expect: /Machine learning|5A|four parts of the hybrid AI/ },
  { q: "Where is the monthly token budget shown?", expect: /AI Assistant page|Settings page/ },
  // About the project
  { q: "What are the objectives of the study?", expect: /Objectives of the Study/ },
  { q: "What SDGs does the project support?", expect: /Sustainable Development Goals/ },
  { q: "What is the scope and limitation of the system?", expect: /Scope and Limitations|Known Limitations|Out of scope/ },
];

describe("knowledge base", () => {
  it("is built from the docs", () => {
    expect(knowledgePassageCount()).toBeGreaterThan(50);
  });

  it.each(GOLDEN)("finds the right passage for: $q", ({ q, expect: section }) => {
    const hits = searchKnowledge(q, { limit: 3, minScore: 0 });
    expect(
      hits.some((h) => section.test(h.section)),
      `top: ${hits.map((h) => `${h.source} › ${h.section} (${h.score.toFixed(1)})`).join(" | ")}`,
    ).toBe(true);
  });

  it.each([...GOLDEN_DOC_QUESTIONS, ...HELD_OUT_DOC_QUESTIONS])(
    "evaluation set: $q",
    ({ q, expect: section }) => {
      const hits = searchKnowledge(q, { limit: 3, minScore: 0 });
      expect(
        hits.some((h) => section.test(h.section)),
        `top: ${hits.map((h) => `${h.source} › ${h.section} (${h.score.toFixed(1)})`).join(" | ")}`,
      ).toBe(true);
    },
  );

  it("tolerates typos and rule codes without a dash", () => {
    expect(searchKnowledge("how to acept the scedule", { limit: 3 }).some((h) => /accept/i.test(h.section))).toBe(true);
    expect(searchKnowledge("explain hc 7", { limit: 3 }).some((h) => /HC-07/.test(h.section))).toBe(true);
  });

  it("quotes the part of a long passage that answers the question", () => {
    const long = `Intro line about the page.
${"Filler sentence that says nothing useful. ".repeat(40)}
- Accept Candidate: makes a candidate the official schedule.`;
    expect(focusExcerpt(long, "how do I accept a candidate", 300)).toContain("Accept Candidate");
  });

  it("returns nothing for unrelated chit-chat", () => {
    expect(searchKnowledge("hello good morning")).toHaveLength(0);
  });

  it("formats passages with their source and a size cap", () => {
    const text = formatKnowledgeForPrompt(searchKnowledge("How do I accept a schedule?"), 1200);
    expect(text).toMatch(/^\[1\] /);
    expect(text.length).toBeLessThanOrEqual(1200);
  });

  it("tells how-to questions from data questions", () => {
    expect(isDocumentationQuestion("How do I accept a schedule?")).toBe(true);
    expect(isDocumentationQuestion("Paano i-on ang 2FA?")).toBe(true);
    expect(isDocumentationQuestion("What is HC-04?")).toBe(true);
    expect(isDocumentationQuestion("Check conflicts in the current schedule")).toBe(false);
    expect(isDocumentationQuestion("Show the faculty load for Engr. Santos")).toBe(false);
    expect(isDocumentationQuestion("How is room utilization this term?")).toBe(false);
    expect(isDocumentationQuestion("Saan pwedeng ilipat ang OFF-CPE-1A-CPE101?")).toBe(false);
    expect(isDocumentationQuestion("Where are the conflicts in the current schedule?")).toBe(false);
    expect(isDocumentationQuestion("Why is CPE 101 unscheduled?")).toBe(false);
  });
});
