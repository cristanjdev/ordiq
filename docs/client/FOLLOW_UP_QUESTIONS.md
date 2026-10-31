# Client Follow-Up Questions (ORDIQ — MSEUF College of Engineering)

**Prepared for:** Jamir Ivan V. Obcemea, Jayron G. Abrigo, Jan Karl Renchie R. Villanueva, and Gian Xavier N. Lagrama
**Prepared by:** Cristan Jade Jumawan
**Reference:** Quotation `Q-2026-002` & [`docs/IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) (Section 11)

---

Hi Jamir and team,

Development of **ORDIQ** is underway on the foundational architecture and synthetic engineering college fixtures so our timeline stays on track. As noted in your manuscript, several institutional rules, data formats, and evaluation parameters require confirmation from the College of Engineering and your group.

Please share your answers to the items below as you confirm them (we do not need to wait for all 22 at once—you can send them in batches):

### Priority 1: Package, Data Authorization & Access (Needed for Phase 1)
1. **Q-01 (Package):** Please confirm which package is finalized: **Basic**, **Standard** (assumed in our current build), or **Premium**?
2. **Q-20 (Data Privacy & Legal Authorization):** Does the University Legal Office authorization cover sharing the department's scheduling dataset with the developer and sending pseudonymized codes (`FAC-001` instead of faculty names) to a paid cloud AI API? If data cannot leave a school machine at all, we will switch to the **Premium** local-LLM setup.
3. **Q-10 (1st Sem A.Y. 2026–2027 Dataset):** Do you already have the 1st Semester A.Y. 2026–2027 schedule and faculty/room/offering lists? What file format are they currently in (Excel, CSV, portal export, or PDF/scan)?
4. **Q-18 (Dean-Only Access vs. Coordinators/Scheduling Officer):** Should login remain strictly **Dean-only**, with Program Coordinators and the Scheduling Officer reviewing PDF/Excel exports, or will any other role log in during the pilot?

### Priority 2: College of Engineering Scheduling Rules (Needed before Week 3 / Phase 2)
5. **Q-02 (Approved Hard Rules):** What are the College of Engineering's officially approved mandatory scheduling rules beyond our standard catalogue (`HC-01` to `HC-15`)?
6. **Q-03 (Official Time Grid & Teaching Days):** Survey comments mention **7:30 AM starts**, **8:30 PM ends**, a **12:00 NN – 1:30 PM break**, and **Monday–Saturday (6-day)** classes on a **30-minute grid**. Please confirm the official start/end times, break windows, and teaching days.
7. **Q-05 (Meeting Patterns):** Do lecture/lab subjects follow fixed day patterns (e.g., `MWF`, `TTh`, or single 3-hour blocks) at the exact same time on each meeting day?
8. **Q-06 (Teaching Load Calculation):** How are maximum teaching loads computed per employment type (`Full-Time Permanent`, `Full-Time Non-Permanent`, `Part-Time`, `Visiting`)? How do laboratory contact hours convert to load units, and is overload permitted?
9. **Q-07 (External Classes — GenEd, PATHFIT, Other Buildings):** How do we receive the schedules for classes outside the College of Engineering's control (General Education, PATHFIT, NSTP) so we can lock those time blocks for each section? Are any rooms inside the Engineering building shared with other colleges?
10. **Q-08 (Faculty Assignment Mode):** Are faculty pre-assigned to subjects/sections before timetable plotting, or should ORDIQ assign qualified faculty automatically (or support both)?
11. **Q-09 (Cross-College Faculty & Combined Sections):** Do any of the 44 engineering faculty teach courses in other colleges (requiring external unavailability blocks)? Can multiple sections be merged into a single combined lecture class?
12. **Q-12 (Soft Preferences & Priority Mode):** Which candidate soft preferences (`SC-01` to `SC-16`, including student survey items like avoiding evening classes for lower years or spreading major/math subjects) are approved? Should they be optimized via **weighted penalties** or a **strict priority hierarchy**?
13. **Q-22 (Waivable Exceptions):** Double-booking (`HC-01` Faculty, `HC-02` Room, `HC-03` Section) is never waivable. Which other rules may the Dean waive with a documented exception reason?

### Priority 3: Paper Alignment, Reports, Evaluation & Hosting (Phases 4–8)
14. **Q-17 (Manuscript Alignment):** Will you update the manuscript text to reflect the panel-requested **Machine Learning module**, **Generative AI assistant**, **Dean-only MFA access**, and the **Next.js + Python OR-Tools + PostgreSQL** stack?
15. **Q-19 (Standalone Web App):** Please confirm that a self-contained web application (with zero integration into the university portal) satisfies the manuscript's definition of a "standalone" tool.
16. **Q-11 (Faculty Preference Survey):** How will faculty preferences be collected (e.g., Google Forms / Excel sheet imported by the Dean)?
17. **Q-13 (Rule Sign-Off):** Who signs off on the approved constraints and soft preference weights for the study?
18. **Q-14 (Report Layouts & Portal Encoding Fields):** Could you share samples of the college's existing schedule forms and the exact column order the Scheduling Officer uses when encoding into the university portal?
19. **Q-15 (AI Provider Account):** Who will hold the OpenAI/Anthropic billing account for the ₱100–₱300/month API usage?
20. **Q-21 (Evaluation Criteria & Usability Instrument):** What are the prespecified pass/fail criteria and usability questionnaire (e.g., ISO/IEC 25010 / SUS) for Evaluation Stages 1, 2, and 3?
21. **Q-04 (Hosting Target):** For turnover and defense, will ORDIQ be hosted on a cloud VPS or a university machine?
22. **Q-16 (Start Date, Defense Date & Support Window):** What is the target final defense date in 2027 so we can align the 60-day free support window accordingly?

