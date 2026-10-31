import os
import matplotlib
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# Register DejaVu fonts from matplotlib
ttf_dir = os.path.join(matplotlib.get_data_path(), 'fonts', 'ttf')
pdfmetrics.registerFont(TTFont('DejaVuSans', os.path.join(ttf_dir, 'DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('DejaVuSans-Bold', os.path.join(ttf_dir, 'DejaVuSans-Bold.ttf')))
pdfmetrics.registerFont(TTFont('DejaVuSans-Oblique', os.path.join(ttf_dir, 'DejaVuSans-Oblique.ttf')))
pdfmetrics.registerFont(TTFont('DejaVuSans-BoldOblique', os.path.join(ttf_dir, 'DejaVuSans-BoldOblique.ttf')))

# Numbered canvas for footer
class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_footer(num_pages)
            super().showPage()
        super().save()

    def draw_footer(self, page_count):
        self.saveState()
        self.setFont('DejaVuSans', 7.1)
        self.setFillColor(colors.HexColor('#666666'))
        # Left footer
        self.drawString(51.35, 30.89, "Department Scheduling System with AI Integration \u2014 Preliminary Technical Report")
        # Right footer
        page_text = f"Page {self._pageNumber}"
        self.drawRightString(595.28 - 50.69, 30.89, page_text)
        self.restoreState()

def build_pdf(filename):
    # Page setup
    left_margin = 51.35
    right_margin = 50.69
    top_margin = 44.0
    bottom_margin = 48.0
    printable_width = 595.28 - left_margin - right_margin # 493.24 pt

    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        leftMargin=left_margin,
        rightMargin=right_margin,
        topMargin=top_margin,
        bottomMargin=bottom_margin
    )

    styles = getSampleStyleSheet()

    # Custom styles
    style_title = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='DejaVuSans-Bold',
        fontSize=18.0,
        leading=23.0,
        textColor=colors.HexColor('#0F2540'),
        alignment=1, # Center
        spaceAfter=9
    )

    style_subtitle = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='DejaVuSans',
        fontSize=9.5,
        leading=13.5,
        textColor=colors.HexColor('#555555'),
        alignment=1, # Center
        spaceAfter=12
    )

    style_project_direction = ParagraphStyle(
        'ProjectDirection',
        parent=styles['Normal'],
        fontName='DejaVuSans',
        fontSize=8.8,
        leading=12.5,
        textColor=colors.HexColor('#222222'),
        spaceAfter=9
    )

    style_heading = ParagraphStyle(
        'SectionHeading',
        parent=styles['Normal'],
        fontName='DejaVuSans-Bold',
        fontSize=12.5,
        leading=16.0,
        textColor=colors.HexColor('#17365D'),
        spaceBefore=10,
        spaceAfter=5,
        keepWithNext=True
    )

    style_body = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontName='DejaVuSans',
        fontSize=8.6,
        leading=12.2,
        textColor=colors.HexColor('#222222'),
        spaceAfter=5
    )

    style_bullet = ParagraphStyle(
        'BulletItem',
        parent=styles['Normal'],
        fontName='DejaVuSans',
        fontSize=8.6,
        leading=12.0,
        textColor=colors.HexColor('#222222'),
        leftIndent=15,
        firstLineIndent=-10,
        spaceAfter=3
    )

    style_numbered = ParagraphStyle(
        'NumberedItem',
        parent=styles['Normal'],
        fontName='DejaVuSans',
        fontSize=8.6,
        leading=12.0,
        textColor=colors.HexColor('#222222'),
        leftIndent=15,
        firstLineIndent=-15,
        spaceAfter=3.5
    )

    style_th = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='DejaVuSans-Bold',
        fontSize=7.4,
        leading=10.0,
        textColor=colors.HexColor('#17365D')
    )

    style_td = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='DejaVuSans',
        fontSize=7.3,
        leading=9.8,
        textColor=colors.HexColor('#1A1A1A')
    )

    style_td_bold = ParagraphStyle(
        'TableCellBold',
        parent=styles['Normal'],
        fontName='DejaVuSans-Bold',
        fontSize=7.3,
        leading=9.8,
        textColor=colors.HexColor('#1A1A1A')
    )

    style_concluding = ParagraphStyle(
        'Concluding',
        parent=styles['Normal'],
        fontName='DejaVuSans',
        fontSize=7.7,
        leading=11.0,
        textColor=colors.HexColor('#555555'),
        spaceBefore=10
    )

    table_header_bg = colors.HexColor('#DCE6F1')
    table_border_color = colors.HexColor('#B7C3D0')

    base_table_style = TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), table_header_bg),
        ('GRID', (0, 0), (-1, -1), 0.45, table_border_color),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3.0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3.0),
        ('LEFTPADDING', (0, 0), (-1, -1), 5.0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5.0),
    ])

    story = []

    # Title & Subtitle
    story.append(Paragraph("Department Scheduling System with AI<br/>Integration", style_title))
    story.append(Paragraph("Updated Technical Proposal, Data-Gathering Guide, AI Architecture, Dashboard and Analytics Concept", style_subtitle))
    story.append(Paragraph("<b>Project direction:</b> A GPT-style conversational scheduling system that generates and manages department schedules while providing dashboards, reports, and data analytics.", style_project_direction))

    # 1. Project Feasibility
    story.append(Paragraph("1. Project Feasibility", style_heading))
    story.append(Paragraph("The requested system is technically feasible. A GPT-style interface can be combined with a structured scheduling engine, database, dashboards, reports, and analytics. The language model should assist users rather than independently decide whether a timetable is valid.", style_body))
    story.append(Paragraph("A dedicated scheduling/optimization layer should enforce exact constraints such as faculty availability, room capacity, section conflicts, required teaching hours, and department rules. The AI layer can interpret requests, explain results, recommend adjustments, and assist with revisions.", style_body))

    # 2. Recommended Technology Stack
    story.append(Paragraph("2. Recommended Technology Stack", style_heading))
    story.append(Paragraph("If the department does not have a required programming language or framework, the following is a suitable starting proposal. The final stack should be confirmed after reviewing school IT standards, deployment requirements, and available infrastructure.", style_body))

    # Table 2
    col_w2 = [80, 135, printable_width - 80 - 135]
    t2_data = [
        [Paragraph("Layer", style_th), Paragraph("Recommended Technology", style_th), Paragraph("Purpose", style_th)],
        [Paragraph("Frontend", style_td_bold), Paragraph("React + TypeScript", style_td), Paragraph("GPT-style interface, spreadsheet-like schedule editor, dashboards, forms, and reports.", style_td)],
        [Paragraph("Backend", style_td_bold), Paragraph("Node.js + TypeScript", style_td), Paragraph("Business logic, APIs, authentication, scheduling operations, reporting, and AI orchestration.", style_td)],
        [Paragraph("Database", style_td_bold), Paragraph("PostgreSQL", style_td), Paragraph("Faculty, subjects, sections, rooms, schedules, constraints, users, logs, and historical data.", style_td)],
        [Paragraph("AI Layer", style_td_bold), Paragraph("OpenAI API or suitable LLM provider", style_td), Paragraph("Natural-language interaction, explanations, recommendations, and controlled schedule assistance.", style_td)],
        [Paragraph("Scheduling Engine", style_td_bold), Paragraph("Constraint-based optimization", style_td), Paragraph("Generates feasible schedules while enforcing hard constraints and optimizing defined preferences.", style_td)],
        [Paragraph("Analytics", style_td_bold), Paragraph("React-compatible charting library", style_td), Paragraph("Interactive dashboards, workload summaries, room utilization, and trends.", style_td)],
        [Paragraph("Deployment", style_td_bold), Paragraph("Cloud hosting appropriate to requirements", style_td), Paragraph("Web access, database hosting, API deployment, monitoring, and backups.", style_td)],
    ]
    t2 = Table(t2_data, colWidths=col_w2, repeatRows=1)
    t2.setStyle(base_table_style)
    story.append(t2)
    story.append(Spacer(1, 6))

    # 3. GPT-Style User Experience
    story.append(Paragraph("3. GPT-Style User Experience", style_heading))
    story.append(Paragraph("The preferred interface can resemble a modern AI assistant. Users can type requests in natural language while the system returns structured results such as schedules, tables, charts, reports, and conflict explanations.", style_body))
    story.append(Paragraph("\u2022 <b>Conversational input:</b> Users provide scheduling instructions or ask questions in natural language.", style_bullet))
    story.append(Paragraph("\u2022 <b>Structured output:</b> The system can return schedules, conflict lists, dashboard cards, charts, or reports.", style_bullet))
    story.append(Paragraph("\u2022 <b>Schedule actions:</b> Users can request generation, revision, filtering, or conflict explanations.", style_bullet))
    story.append(Paragraph("\u2022 <b>Spreadsheet workspace:</b> Users can directly review and edit generated schedules.", style_bullet))
    story.append(Paragraph("\u2022 <b>Controlled AI actions:</b> Requested changes are validated by the scheduling engine before being applied.", style_bullet))
    story.append(Spacer(1, 4))

    # Table 3
    col_w3 = [110, printable_width - 110]
    t3_data = [
        [Paragraph("User", style_th), Paragraph("Example", style_th)],
        [Paragraph("User request", style_td_bold), Paragraph("Generate the department schedule using the uploaded faculty availability and room data.", style_td)],
        [Paragraph("System", style_td_bold), Paragraph("Draft schedule generated. Two unresolved conflicts require review.", style_td)],
        [Paragraph("User request", style_td_bold), Paragraph("Show the conflicts and suggest alternatives.", style_td)],
        [Paragraph("System", style_td_bold), Paragraph("Conflict details and feasible alternative slots are presented.", style_td)],
    ]
    t3 = Table(t3_data, colWidths=col_w3, repeatRows=1)
    t3.setStyle(base_table_style)
    story.append(t3)
    story.append(Spacer(1, 6))

    # 4. Recommended System Architecture
    story.append(Paragraph("4. Recommended System Architecture", style_heading))
    col_w4 = [155, printable_width - 155]
    t4_data = [
        [Paragraph("Component", style_th), Paragraph("Responsibility", style_th)],
        [Paragraph("GPT-Style Frontend", style_td_bold), Paragraph("Conversation, schedule workspace, dashboards, reports, filters, and user actions.", style_td)],
        [Paragraph("Application Backend", style_td_bold), Paragraph("Authentication, permissions, validation, APIs, workflow management, and audit logging.", style_td)],
        [Paragraph("AI Orchestration", style_td_bold), Paragraph("Converts natural-language requests into structured system actions and explanations.", style_td)],
        [Paragraph("Scheduling / Optimization Engine", style_td_bold), Paragraph("Evaluates assignments, enforces hard constraints, and optimizes defined objectives.", style_td)],
        [Paragraph("Database", style_td_bold), Paragraph("Stores master data, schedules, constraints, user actions, reports, and historical records.", style_td)],
        [Paragraph("Analytics Layer", style_td_bold), Paragraph("Calculates workload, room utilization, conflicts, trends, and approved metrics.", style_td)],
    ]
    t4 = Table(t4_data, colWidths=col_w4, repeatRows=1)
    t4.setStyle(base_table_style)
    story.append(t4)
    story.append(Spacer(1, 6))

    # 5. AI vs. Scheduling Optimization
    story.append(Paragraph("5. AI vs. Scheduling Optimization", style_heading))
    col_w5 = [printable_width / 2.0, printable_width / 2.0]
    t5_data = [
        [Paragraph("AI Layer", style_th), Paragraph("Scheduling / Optimization Layer", style_th)],
        [Paragraph("Understands natural-language requests.", style_td), Paragraph("Checks exact scheduling constraints.", style_td)],
        [Paragraph("Explains conflicts and results.", style_td), Paragraph("Prevents faculty, room, and section conflicts.", style_td)],
        [Paragraph("Suggests possible adjustments.", style_td), Paragraph("Tests whether changes are feasible.", style_td)],
        [Paragraph("Answers questions about schedule data.", style_td), Paragraph("Calculates and validates assignments.", style_td)],
        [Paragraph("Assists the user.", style_td), Paragraph("Produces a valid or constraint-compliant schedule.", style_td)],
    ]
    t5 = Table(t5_data, colWidths=col_w5, repeatRows=1)
    t5.setStyle(base_table_style)
    story.append(t5)
    story.append(Spacer(1, 6))

    # 6. Scheduling Rules and Constraints
    story.append(Paragraph("6. Scheduling Rules and Constraints", style_heading))
    col_w6 = [120, printable_width - 120]
    t6_data = [
        [Paragraph("Type", style_th), Paragraph("Examples", style_th)],
        [Paragraph("Hard Constraints", style_td_bold), Paragraph("No faculty double-booking; no room double-booking; room capacity must accommodate the section; faculty must be available; required subject hours must be scheduled; section conflicts must be prevented.", style_td)],
        [Paragraph("Soft Constraints", style_td_bold), Paragraph("Preferred teaching periods; balanced workload; minimizing gaps; preferred rooms; faculty preferences; minimizing changes from an existing schedule.", style_td)],
    ]
    t6 = Table(t6_data, colWidths=col_w6, repeatRows=1)
    t6.setStyle(base_table_style)
    story.append(t6)
    story.append(Spacer(1, 6))

    # 7. Data-Gathering Structure
    story.append(Paragraph("7. Data-Gathering Structure", style_heading))
    story.append(Paragraph("Separate worksheets are recommended instead of one large spreadsheet. This makes validation, database import, and schedule generation easier.", style_body))
    col_w7 = [130, printable_width - 130]
    t7_data = [
        [Paragraph("Dataset", style_th), Paragraph("Required Information", style_th)],
        [Paragraph("Faculty", style_td_bold), Paragraph("ID, name, program, position, subjects, teaching load, availability, restrictions.", style_td)],
        [Paragraph("Subjects", style_td_bold), Paragraph("Code, name, program, year, units, duration, meetings/week, room requirements.", style_td)],
        [Paragraph("Sections", style_td_bold), Paragraph("Section code, program, year level, student count, enrolled subjects.", style_td)],
        [Paragraph("Rooms", style_td_bold), Paragraph("ID, room number, type, capacity, equipment, availability, restrictions.", style_td)],
        [Paragraph("Time Slots", style_td_bold), Paragraph("Official days, start/end times, breaks, allowed periods.", style_td)],
        [Paragraph("Faculty Availability", style_td_bold), Paragraph("Available/unavailable periods per faculty member.", style_td)],
        [Paragraph("Subject Requirements", style_td_bold), Paragraph("Hours, frequency, preferred periods, room type, special requirements.", style_td)],
        [Paragraph("Scheduling Rules", style_td_bold), Paragraph("Policies, mandatory conditions, restrictions, preferences.", style_td)],
        [Paragraph("Existing Schedule", style_td_bold), Paragraph("Current or previous schedule for reference and comparison.", style_td)],
    ]
    t7 = Table(t7_data, colWidths=col_w7, repeatRows=1)
    t7.setStyle(base_table_style)
    story.append(t7)
    story.append(Spacer(1, 6))

    # 8. Core Data Templates
    story.append(Paragraph("8. Core Data Templates", style_heading))
    col_w8 = [90, printable_width - 90]
    t8_data = [
        [Paragraph("Dataset", style_th), Paragraph("Suggested Fields", style_th)],
        [Paragraph("Faculty", style_td_bold), Paragraph("Faculty ID; Name; Department/Program; Position; Subjects Handled; Maximum Teaching Load; Preferred Schedule; Unavailable Periods; Special Restrictions.", style_td)],
        [Paragraph("Subjects", style_td_bold), Paragraph("Subject Code; Subject Name; Program; Year Level; Units; Hours per Meeting; Meetings per Week; Preferred Days; Required Room Type; Special Requirements.", style_td)],
        [Paragraph("Sections", style_td_bold), Paragraph("Section Code; Program; Year Level; Number of Students; Subjects; Special Scheduling Rules.", style_td)],
        [Paragraph("Rooms", style_td_bold), Paragraph("Room ID; Room Number; Room Type; Capacity; Equipment; Available Days; Available Time; Special Restrictions.", style_td)],
    ]
    t8 = Table(t8_data, colWidths=col_w8, repeatRows=1)
    t8.setStyle(base_table_style)
    story.append(t8)
    story.append(Spacer(1, 6))

    # 9. Faculty Availability Template
    story.append(Paragraph("9. Faculty Availability Template", style_heading))
    col_w9 = [65, 75, 65, 65, 75, printable_width - (65 + 75 + 65 + 65 + 75)]
    t9_data = [
        [Paragraph("Faculty ID", style_th), Paragraph("Day", style_th), Paragraph("Start", style_th), Paragraph("End", style_th), Paragraph("Status", style_th), Paragraph("Notes", style_th)],
        [Paragraph("FAC-001", style_td), Paragraph("Monday", style_td), Paragraph("7:30 AM", style_td), Paragraph("10:30 AM", style_td), Paragraph("Available", style_td), Paragraph("", style_td)],
        [Paragraph("FAC-001", style_td), Paragraph("Monday", style_td), Paragraph("10:30 AM", style_td), Paragraph("12:00 PM", style_td), Paragraph("Unavailable", style_td), Paragraph("Other assignment", style_td)],
        [Paragraph("FAC-001", style_td), Paragraph("Tuesday", style_td), Paragraph("1:00 PM", style_td), Paragraph("4:00 PM", style_td), Paragraph("Available", style_td), Paragraph("", style_td)],
    ]
    t9 = Table(t9_data, colWidths=col_w9, repeatRows=1)
    t9.setStyle(base_table_style)
    story.append(t9)
    story.append(Spacer(1, 6))

    # 10. Dashboard and Data Analytics
    story.append(Paragraph("10. Dashboard and Data Analytics", style_heading))
    story.append(Paragraph("The dashboard can be generated from actual scheduling and department data. Final metrics should be confirmed with the department.", style_body))
    col_w10 = [140, printable_width - 140]
    t10_data = [
        [Paragraph("Dashboard / Report", style_th), Paragraph("Possible Metrics", style_th)],
        [Paragraph("Schedule Overview", style_td_bold), Paragraph("Classes by day, time, program, year, section, faculty, or room.", style_td)],
        [Paragraph("Faculty Workload", style_td_bold), Paragraph("Teaching hours, assigned subjects, schedule distribution, and remaining load.", style_td)],
        [Paragraph("Room Utilization", style_td_bold), Paragraph("Room usage by day/time, capacity utilization, and unused periods.", style_td)],
        [Paragraph("Conflict Monitoring", style_td_bold), Paragraph("Unresolved conflicts, invalid assignments, and scheduling exceptions.", style_td)],
        [Paragraph("Subject Distribution", style_td_bold), Paragraph("Sections, scheduled hours, and distribution by program/year.", style_td)],
        [Paragraph("Schedule Changes", style_td_bold), Paragraph("Changes, approvals, and revisions.", style_td)],
        [Paragraph("Historical Analytics", style_td_bold), Paragraph("Comparison across semesters if historical schedules are retained.", style_td)],
    ]
    t10 = Table(t10_data, colWidths=col_w10, repeatRows=1)
    t10.setStyle(base_table_style)
    story.append(t10)
    story.append(Spacer(1, 5))

    # 11. Reports
    story.append(Paragraph("11. Reports", style_heading))
    reports_list = [
        "Faculty teaching load report",
        "Room utilization report",
        "Section/class schedule report",
        "Subject schedule report",
        "Conflict and exception report",
        "Department-wide schedule summary",
        "Schedule change and revision history",
        "Exportable PDF/Excel reports, subject to final requirements."
    ]
    for r in reports_list:
        story.append(Paragraph(f"\u2022 {r}", style_bullet))
    story.append(Spacer(1, 5))

    # 12. Spreadsheet-Like Schedule Workspace
    story.append(Paragraph("12. Spreadsheet-Like Schedule Workspace", style_heading))
    workspace_list = [
        "Grid-based timetable similar to a spreadsheet.",
        "Filter by faculty, room, section, subject, day, or time.",
        "Direct editing with validation.",
        "Visual indicators for conflicts and pending changes.",
        "AI assistant panel for schedule questions and adjustments.",
        "Review and confirmation before applying AI-assisted changes.",
        "Export and print functionality."
    ]
    for w in workspace_list:
        story.append(Paragraph(f"\u2022 {w}", style_bullet))
    story.append(Spacer(1, 5))

    # 13. End-to-End System Flow
    story.append(Paragraph("13. End-to-End System Flow", style_heading))
    col_w13 = [140, printable_width - 140]
    t13_data = [
        [Paragraph("Step", style_th), Paragraph("Process", style_th)],
        [Paragraph("1. User Input", style_td_bold), Paragraph("User requests schedule generation or asks a scheduling question through the GPT-style interface.", style_td)],
        [Paragraph("2. Data Validation", style_td_bold), Paragraph("System checks whether required faculty, subjects, sections, rooms, availability, and rules are complete.", style_td)],
        [Paragraph("3. Schedule Generation", style_td_bold), Paragraph("Optimization engine generates candidate assignments while enforcing hard constraints.", style_td)],
        [Paragraph("4. AI Explanation", style_td_bold), Paragraph("AI summarizes the schedule and explains conflicts, constraints, or suggested alternatives.", style_td)],
        [Paragraph("5. User Review", style_td_bold), Paragraph("User reviews the schedule in the spreadsheet-like workspace.", style_td)],
        [Paragraph("6. Adjustment", style_td_bold), Paragraph("User requests a change, such as moving a class or avoiding a specific room.", style_td)],
        [Paragraph("7. Validation", style_td_bold), Paragraph("System checks the requested change against applicable constraints.", style_td)],
        [Paragraph("8. Finalization", style_td_bold), Paragraph("Approved schedule is saved and becomes available to dashboards and reports.", style_td)],
    ]
    t13 = Table(t13_data, colWidths=col_w13, repeatRows=1)
    t13.setStyle(base_table_style)
    story.append(t13)
    story.append(Spacer(1, 5))

    # 14. Data Quality Requirements
    story.append(Paragraph("14. Data Quality Requirements", style_heading))
    quality_list = [
        "Use consistent IDs for faculty, subjects, sections, and rooms.",
        "Avoid duplicate records.",
        "Use one standard time format.",
        "Distinguish unavailable periods from preferred periods.",
        "Separate mandatory rules from preferences.",
        "Document exceptions and special cases.",
        "Identify official data sources and responsible department personnel.",
        "Validate student counts, room capacities, faculty loads, and subject requirements."
    ]
    for q in quality_list:
        story.append(Paragraph(f"\u2022 {q}", style_bullet))
    story.append(Spacer(1, 5))

    # 15. Information the Department Should Provide
    story.append(Paragraph("15. Information the Department Should Provide", style_heading))
    story.append(Paragraph("After the data-gathering request is approved, the department can provide the following materials for technical analysis:", style_body))
    info_list = [
        "Faculty master list",
        "Subject/course master list",
        "Section list and student counts",
        "Room list, room types, capacities, and equipment",
        "Official time-slot structure",
        "Faculty availability/unavailability",
        "Subject scheduling requirements",
        "Department scheduling policies and restrictions",
        "Current or previous schedules, if available",
        "Existing forms, templates, or official scheduling documents",
        "Any required programming language, framework, database, hosting environment, or school IT standard."
    ]
    for item in info_list:
        story.append(Paragraph(f"\u2022 {item}", style_bullet))
    story.append(Spacer(1, 5))

    # 16. Questions to Confirm Before Development
    story.append(Paragraph("16. Questions to Confirm Before Development", style_heading))
    col_w16 = [205, printable_width - 205]
    t16_data = [
        [Paragraph("Question", style_th), Paragraph("Why It Matters", style_th)],
        [Paragraph("Is there a required programming language/framework?", style_td_bold), Paragraph("Determines technology restrictions and compatibility.", style_td)],
        [Paragraph("Where will the system be hosted?", style_td_bold), Paragraph("Determines deployment, security, database, and infrastructure.", style_td)],
        [Paragraph("Who are the system users?", style_td_bold), Paragraph("Defines roles, permissions, and workflows.", style_td)],
        [Paragraph("Who can generate, edit, approve, and publish schedules?", style_td_bold), Paragraph("Defines authorization and approval controls.", style_td)],
        [Paragraph("Which rules are mandatory?", style_td_bold), Paragraph("Defines hard constraints.", style_td)],
        [Paragraph("Which preferences should be optimized?", style_td_bold), Paragraph("Defines optimization objectives.", style_td)],
        [Paragraph("What reports and analytics are required?", style_td_bold), Paragraph("Defines dashboard and reporting requirements.", style_td)],
        [Paragraph("Should historical schedules be retained?", style_td_bold), Paragraph("Determines historical analytics and retention design.", style_td)],
        [Paragraph("What information may the AI access?", style_td_bold), Paragraph("Defines AI data boundaries and privacy controls.", style_td)],
    ]
    t16 = Table(t16_data, colWidths=col_w16, repeatRows=1)
    t16.setStyle(base_table_style)
    story.append(t16)
    story.append(Spacer(1, 6))

    # 17. Defining “Optimal Schedule”
    story.append(Paragraph("17. Defining \u201cOptimal Schedule\u201d", style_heading))
    story.append(Paragraph("An \u201coptimal\u201d schedule must be defined using measurable objectives established by the department. Multiple valid schedules may exist. The system therefore needs a clear distinction between mandatory constraints and preferences.", style_body))
    story.append(Paragraph("Possible objectives include minimizing conflicts, reducing schedule gaps, balancing teaching loads, maximizing room utilization, honoring faculty preferences, and minimizing changes from an existing schedule. The department should determine which objectives apply before implementation.", style_body))

    # 18. Recommended Next Steps
    story.append(Paragraph("18. Recommended Next Steps", style_heading))
    steps_list = [
        "1. Complete and approve the data-gathering request.",
        "2. Collect structured data using the proposed worksheets.",
        "3. Identify hard constraints, soft constraints, user roles, dashboards, and required reports.",
        "4. Confirm technology stack and deployment environment.",
        "5. Design the database, scheduling engine, GPT-style interface, dashboards, and reports.",
        "6. Develop and test using actual department data.",
        "7. Validate generated schedules with department personnel before deployment."
    ]
    for s in steps_list:
        story.append(Paragraph(s, style_numbered))

    story.append(Spacer(1, 4))
    story.append(Paragraph("This document is a preliminary technical planning report. The final architecture, AI provider, optimization method, database design, dashboards, reports, and technology stack should be finalized after the department\u2019s actual data, policies, privacy requirements, and infrastructure are reviewed.", style_concluding))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Generated {filename} successfully!")

if __name__ == '__main__':
    target_pdf = r'D:\Clients\SchedAI\Department_Scheduling_System_AI_Data_Gathering_Report_Updated.pdf'
    build_pdf(target_pdf)
