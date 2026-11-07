/**
 * Evaluation set for the assistant's documentation knowledge: realistic
 * questions as the Dean would type them (English, Filipino, Taglish, casual
 * wording and typos). Each must retrieve a passage whose section matches
 * `expect` in the top three. Used by knowledge.service.test.ts and by the
 * live evaluation (knowledge-live.eval.test.ts), which also checks that the
 * model's answer mentions `answerHas`.
 */
export interface GoldenDocQuestion {
  q: string;
  expect: RegExp;
  /** Words the live answer must contain (any one of them, case-insensitive). */
  answerHas?: string[];
}

export const GOLDEN_DOC_QUESTIONS: GoldenDocQuestion[] = [
  // ---- Sign-in, account, security
  { q: "How do I log in?", expect: /sign in|Signing in/i, answerHas: ["password"] },
  { q: "paano mag login sa ordiq", expect: /sign in|Signing in/i, answerHas: ["password"] },
  { q: "I lost my phone, how can I sign in without the authenticator?", expect: /lose my phone|recovery/i, answerHas: ["recovery"] },
  { q: "nawala yung phone ko na may google authenticator", expect: /lose my phone/i, answerHas: ["recovery"] },
  { q: "what are recovery codes for", expect: /lose my phone|Signing in|Dean-Only|sign in/i },
  { q: "How do I disable 2FA?", expect: /two-factor/i, answerHas: ["Settings"] },
  { q: "pano i-on ulit yung 2fa", expect: /two-factor/i, answerHas: ["Settings"] },
  { q: "Do I need to scan the QR code again if I turn 2FA back on?", expect: /two-factor|Settings page/i, answerHas: ["QR"] },
  { q: "my account got locked", expect: /locked/i, answerHas: ["minutes"] },
  { q: "na-lock ako after mali ang password", expect: /locked/i },
  { q: "how many wrong attempts before lockout", expect: /locked|Settings page/i, answerHas: ["5", "attempt"] },
  { q: "why did ordiq log me out by itself", expect: /signed out automatically|Signing in/i, answerHas: ["inactivity", "30"] },
  { q: "bakit ako na-logout bigla", expect: /signed out automatically/i },
  { q: "how do i change the auto logout time", expect: /signed out automatically|Settings page/i, answerHas: ["Settings"] },
  { q: "can I turn off auto expire", expect: /signed out automatically|Settings page/i },
  { q: "what's the max session length", expect: /signed out automatically|Settings page/i, answerHas: ["12"] },
  { q: "why is it asking my password when saving settings", expect: /password/i },
  { q: "where do I sign out", expect: /Signing in and signing out/i },
  { q: "can coordinators have their own login?", expect: /Who can use|Signing in|Dean-Only/i, answerHas: ["Dean"] },
  { q: "is there a register page", expect: /Who can use|sign in|Signing in/i },
  // ---- Settings and AI
  { q: "how to turn off the chatbot", expect: /turn off the AI Assistant|Settings page/i, answerHas: ["Settings"] },
  { q: "patayin ang AI assistant", expect: /turn off the AI Assistant|Settings page/i },
  { q: "what happens when the token budget runs out", expect: /token budget/i, answerHas: ["built-in"] },
  { q: "where can I see AI usage and cost", expect: /token budget|AI Assistant page/i, answerHas: ["Usage"] },
  { q: "restore default settings", expect: /Settings page/i },
  // ---- Workflow
  { q: "how do I make a schedule from scratch", expect: /create a schedule|Schedules page|Step 2/i, answerHas: ["Generate"] },
  { q: "paano gumawa ng schedule", expect: /create a schedule/i, answerHas: ["Generate"] },
  { q: "where do I start for a new term", expect: /create a schedule|Step 1|Readiness/i },
  { q: "what's candidate a b c", expect: /Balanced, Faculty First|Schedules page|Step 2/i, answerHas: ["Balanced"] },
  { q: "ano pinagkaiba ng faculty first at student first", expect: /Balanced, Faculty First/i },
  { q: "why are there unscheduled classes", expect: /unscheduled/i, answerHas: ["reason"] },
  { q: "bakit may hindi nailagay na klase", expect: /unscheduled/i },
  { q: "how to fix conflicts", expect: /fix a conflict/i, answerHas: ["move", "alternative"] },
  { q: "may banggaan sa schedule paano ayusin", expect: /fix a conflict/i },
  { q: "how do i approve the final schedule", expect: /accept a schedule|Schedules page|Step 3/i, answerHas: ["Accept"] },
  { q: "pano i-accept yung candidate", expect: /accept a schedule|accept the schedule/i, answerHas: ["Accept"] },
  { q: "the accept button doesnt work", expect: /accept/i, answerHas: ["conflict", "unscheduled"] },
  { q: "ayaw ma-accept ng schedule", expect: /accept/i },
  { q: "can the AI accept the schedule for me", expect: /AI Assistant accept|Chat panel|through chat/i, answerHas: ["Dean"] },
  { q: "I need to change something after accepting", expect: /change an accepted schedule|Schedules page|lifecycle/i, answerHas: ["revision"] },
  { q: "paano mag revise", expect: /change an accepted|revis/i, answerHas: ["revision"] },
  { q: "undo my last change", expect: /undo/i, answerHas: ["Undo"] },
  { q: "what is a waived exception", expect: /waived exception|Schedules page|Step 3/i, answerHas: ["reason"] },
  { q: "can I waive double booking", expect: /waived exception|HC-0[123]|Schedules page|Hard/i, answerHas: ["never"] },
  { q: "how do I compare candidates", expect: /Schedules page|Step 3|Balanced/i, answerHas: ["Compare"] },
  { q: "does the schedule get checked after I edit it", expect: /Schedules page|fix a conflict|Step 3/i },
  // ---- Rules
  { q: "what is HC-04", expect: /HC-04/i, answerHas: ["capacity"] },
  { q: "explain hc 7", expect: /HC-07/i, answerHas: ["load"] },
  { q: "ano ang HC-15", expect: /HC-15/i, answerHas: ["fixed"] },
  { q: "what does HC-11 mean", expect: /HC-11/i, answerHas: ["break"] },
  { q: "list the hard constraints", expect: /Hard constraints|Hard Constraints|HC-/i },
  { q: "what is SC-09", expect: /SC-09|SC-16|Soft constraints|Candidate preferences/i, answerHas: ["evening"] },
  { q: "what are the soft preferences", expect: /Soft preferences|Soft constraints|Soft Objectives/i },
  { q: "why cant i edit hard rules", expect: /Rules & Preferences page|Hard/i },
  { q: "where do i adjust the weights", expect: /Soft preferences|Rules & Preferences page|Objective/i, answerHas: ["Objective Weights"] },
  { q: "what is a directive", expect: /directive/i, answerHas: ["generation", "run"] },
  { q: "pano mag add ng directive na wag ilagay si sir sa monday", expect: /directive/i },
  { q: "what are fixed blocks", expect: /fixed blocks/i, answerHas: ["PATHFIT", "GenEd", "General Education"] },
  { q: "pathfit and nstp schedule", expect: /fixed blocks|Rules & Preferences page/i },
  { q: "what does the readiness gate check", expect: /Readiness/i, answerHas: ["critical"] },
  { q: "kulang daw ang data, bakit di makapag generate", expect: /Readiness/i },
  // ---- Data pages
  { q: "how do I upload the excel file", expect: /import data|Importing data|Step 1/i, answerHas: ["workbook", "Import"] },
  { q: "where to put faculty availability", expect: /available|Faculty page/i, answerHas: ["Faculty"] },
  { q: "set the subjects a teacher can teach", expect: /what subjects|Qualifications|Faculty page/i, answerHas: ["Qualifications"] },
  { q: "room capacity where", expect: /room capacity|Rooms & Laboratories/i, answerHas: ["Rooms"] },
  { q: "do you store student names", expect: /student records|D-21|Courses & Sections/i, answerHas: ["No", "count"] },
  { q: "may student data ba ang system", expect: /student records/i },
  // ---- Reports and portal
  { q: "export to portal", expect: /portal/i, answerHas: ["Portal Encoding Export"] },
  { q: "paano i-export sa excel", expect: /export|Reports page/i, answerHas: ["Reports"] },
  { q: "does it connect to the MSEUF portal directly", expect: /portal|Reports page|Out of scope/i, answerHas: ["never", "not"] },
  { q: "what reports can i print", expect: /reports/i, answerHas: ["PDF"] },
  { q: "faculty load report", expect: /reports|Reports page/i },
  // ---- Metrics
  { q: "how is faculty load balance computed", expect: /Load Balance/i, answerHas: ["standard deviation", "spread"] },
  { q: "what is room utilization", expect: /Dashboard|Room Utilization|reports/i },
  { q: "is the schedule optimal", expect: /optimized/i, answerHas: ["best found", "optimal"] },
  // ---- AI, ML, privacy
  { q: "is faculty data sent to google gemini", expect: /faculty names sent|Privacy|Chat panel/i, answerHas: ["ALIAS", "code"] },
  { q: "pinapadala ba ang pangalan ng faculty sa AI", expect: /faculty names sent/i },
  { q: "how does the ml recommendation work", expect: /recommendation|Machine learning|5A/i, answerHas: ["logistic", "history", "fit"] },
  { q: "how to retrain the model", expect: /recommendation|AI Assistant page|Feedback loop/i, answerHas: ["Retrain"] },
  { q: "how do I apply a proposal", expect: /AI Assistant page|AI Assistant accept|Proposals/i, answerHas: ["Apply"] },
  { q: "what do the notifications mean", expect: /notifications/i, answerHas: ["attention"] },
  { q: "mark as read", expect: /notifications/i },
  { q: "what languages does the assistant understand", expect: /Chat panel|Conversational AI|What is ORDIQ/i, answerHas: ["Taglish", "Filipino"] },
  // ---- About the project
  { q: "what is ordiq", expect: /What is ORDIQ|Abstract|Product goal/i, answerHas: ["schedul"] },
  { q: "ano ang ordiq", expect: /What is ORDIQ/i },
  { q: "what are the objectives of the study", expect: /Objectives of the Study/i },
  { q: "which SDGs", expect: /Sustainable Development Goals/i },
  { q: "limitations of the system", expect: /Limitations|Out of scope/i },
  { q: "what is the conceptual framework", expect: /Conceptual Framework/i },
  { q: "research design used", expect: /Research Design|Methods/i },
  { q: "what did the faculty survey find", expect: /Results and Discussion|Data-Gathering|Analysis/i },
  // ---- Typos
  { q: "how to acept the scedule", expect: /accept/i },
  { q: "two factor authentcation off", expect: /two-factor/i },
  { q: "unscheduled clases why", expect: /unscheduled/i },
];

/**
 * Held-out questions: written after the retrieval was tuned on the set above
 * and never used for tuning (29 of 30 passed on first run; the one miss,
 * "lockout", was then fixed with a synonym). New tuning should be checked
 * against fresh questions, not only these.
 */
export const HELD_OUT_DOC_QUESTIONS: GoldenDocQuestion[] = [
  { q: "I forgot which authenticator app to use", expect: /two-factor|Signing in|sign in|lose my phone/i },
  { q: "how long is the lockout", expect: /locked|Settings page/i },
  { q: "can I extend my session to 24 hours", expect: /signed out automatically|Settings page/i },
  { q: "where is the audit log of setting changes", expect: /Settings page|password|Access Control/i },
  { q: "paano malaman kung ready na ang data", expect: /Readiness/i },
  { q: "generate three candidates", expect: /create a schedule|Schedules page|Balanced|Step 2/i },
  { q: "candidate has 3 conflicts what should I do", expect: /fix a conflict|accept/i },
  { q: "how to move a class to another room", expect: /fix a conflict|Schedules page/i },
  { q: "anong ibig sabihin ng HC-09", expect: /HC-09/i },
  { q: "sc 12 meaning", expect: /SC-09 to SC-16|SC-12|Candidate preferences/i },
  { q: "room is under maintenance next week", expect: /HC-14|Rooms & Laboratories/i },
  { q: "faculty cannot teach on saturdays how do I set that", expect: /available|directive|Faculty page/i },
  { q: "add a rule that a section only has classes in the morning", expect: /directive/i },
  { q: "how do i pin a class so it doesnt move", expect: /directive|Schedules page|Step 3/i },
  { q: "gen ed classes from other departments", expect: /fixed blocks|Rules & Preferences page/i },
  { q: "where do I download the schedule per section", expect: /reports|Reports page/i },
  { q: "can the scheduling officer encode it in the portal", expect: /portal|Reports page|Exporting/i },
  { q: "what is the quality score", expect: /optimized|Compare|Schedules page|soft/i },
  { q: "how does ordiq protect privacy", expect: /Privacy|faculty names sent|student records/i },
  { q: "does the assistant remember previous chats", expect: /AI Assistant page|Chat panel/i },
  { q: "who made the final decision on schedules", expect: /accept|Dean|What is ORDIQ|Chat panel/i },
  { q: "bakit hindi ko ma-edit ang hard constraints", expect: /Rules & Preferences page|Hard/i },
  { q: "what is CP-SAT", expect: /CP-SAT|solver|Architecture|Theoretical|Schedules page|optimized/i },
  { q: "how many hard rules are there", expect: /hard constraints|Hard constraints|Hard Constraints/i },
  { q: "lumang schedule, gusto ko baguhin", expect: /change an accepted|revis/i },
  { q: "proposal from chatbot where to approve", expect: /AI Assistant page|AI Assistant accept|apply/i },
  { q: "notifications bell count", expect: /notifications/i },
  { q: "significance of the study", expect: /Significance/i },
  { q: "data gathering methods", expect: /Data-Gathering/i },
  { q: "what problems did the college have with manual scheduling", expect: /Background|Results|Introduction|Product goal/i },
];
