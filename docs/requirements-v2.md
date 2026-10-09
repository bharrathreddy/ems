# Education Management System
## Final Requirements, Business Rules & Build Plan

| Item | Value |
|---|---|
| Document version | 2.0 (replaces v1.0 "Universal Education Management System") |
| Status | Requirements locked for R1 and R2. Report card details to be finalised later. |
| Product type | Single-institute School / College Management System (ERP) |
| First target | Telangana State Board school (classes up to 10) |
| Database | MySQL 8.4 LTS only (InnoDB, utf8mb4) |
| Language | English only (for now) |
| Online payments | Not in scope (offline collection with receipts) |

---

## Table of Contents

1. Summary of changes from v1.0
2. Product summary
3. Deployment model
4. Institution types
5. Users, roles and permissions
6. Identity and login rules
7. Student lifecycle
8. Academic structure
9. Fee management rules
10. Receipts
11. Attendance
12. Exams and report cards
13. Public website and CMS
14. Communication and notifications
15. Bulk import and export
16. Audit, privacy and data retention
17. UI / UX standards
18. Technology stack
19. Architecture and database conventions
20. Release plan (every release deployable)
21. R1 database schema (MySQL DDL)
22. R2 database schema, fees (MySQL DDL)
23. Critical test cases
24. Open items

---

## 1. Summary of Changes from v1.0

| Area | v1.0 | v2.0 (final) |
|---|---|---|
| Tenancy | Multi-tenant SaaS, many institutions in one database | **One institution per installation.** Each branch is a separate installation. No `institution_id` columns. |
| Super Admin | Platform owner managing many institutions | **Developer-only console** for one installation (modules, settings, health, backups). |
| Public signup | Institutions create accounts | **No signup.** All users are created by the institution. |
| Parent identity | Undefined | **One family account per family**, linked to all children. |
| Staff who are parents | Undefined | **Same account**, switch between Staff and Parent views. |
| Fees | Generic fee heads and structures | Exact rules for tuition plans, bus fee, one-time fees, discounts, allocation and carry-forward (Section 9). |
| Receipts | Stored PDFs | **PDF generated on demand, never stored.** |
| Online payments | Gateway | **Out of scope.** Record offline payments only. |
| Plans/subscriptions, impersonation across tenants | Included | Removed. |
| Language | Multi-language | English only. |

---

## 2. Product Summary

A clean, mobile-first School / College Management System used by **one institution per installation**. Staff manage academics, fees, attendance and exams. Families (and college students) log in to see fees, receipts, attendance, marks and notices. The institution also gets a public website whose content is managed from the admin panel.

Core principle:

> **User + Role + Permission + Scope + Configuration**

Permissions are never hard-coded to role names. Every check happens on the backend. The frontend only hides what the user cannot use.

---

## 3. Deployment Model

| Rule | Detail |
|---|---|
| D1 | One installation (server + database) serves exactly one institution. |
| D2 | A branch or campus of the same group is a **separate installation** with its own database. |
| D3 | The same codebase is deployed for every institution. Differences come only from configuration. |
| D4 | Hosting provider to be decided. The system runs on any Linux VPS using Docker Compose. |
| D5 | Each installation has its own domain or subdomain, HTTPS, backups and monitoring. |
| D6 | Environments: `staging` and `production` per installation (staging can be shared for testing). |

---

## 4. Institution Types

The Super Admin sets the institution type once during setup.

| Type | Classes | Default login holder | Notes |
|---|---|---|---|
| School | Up to Class 10 (Nursery, LKG, UKG, 1 to 10) | Family (parent) account | Students do not get their own login. |
| College | Above Class 10 (Intermediate, Degree, etc.) | Institution chooses: **Student** or **Parent** (one of them) | Login holder can see fees and attendance. |

Rule I1: Any class above 10 is handled in College mode.
Rule I2: Exam patterns, class lists and terminology are configuration, so other states/boards can be added later without code changes.

---

## 5. Users, Roles and Permissions

### 5.1 Super Admin (Developer)

Hidden developer console. Not visible to the institution's users.

- Set institution type and core settings
- Enable or disable modules (feature flags)
- Manage the Institution Admin account(s)
- Configure SMTP, contact WhatsApp number and contact email (Admin can also do this)
- View system health, failed jobs, email failures, backups, audit logs
- Manage public website content (Admin can also do this)

Rule S1: The Institution Admin can never change Super Admin settings or feature flags.

### 5.2 Default Roles (editable, unlimited custom roles allowed)

Institution Admin, Principal, Vice Principal, Accountant, HR Manager, Teacher, Class Teacher, Exam Coordinator, Librarian, Transport Manager, Driver, Receptionist, Non-Teaching Staff, Parent (Family), Student (college only).

### 5.3 Permission Model

A permission is **Module + Action**, granted to a role with a **Scope**.

| Part | Examples |
|---|---|
| Module | students, families, staff, fees, payments, attendance, exams, marks, cms, settings, users, roles, reports, imports |
| Action | view, create, edit, delete, approve, publish, print, export, import, collect, void, configure, assign |
| Scope | all, class, section, subject, assigned_students, own_records, own_children, assigned_route |

### 5.4 Field-Level Permissions

Sensitive fields are controlled per role: `hidden`, `view` or `edit`.

| Field group | Teacher | Class Teacher | Accountant | Family |
|---|---|---|---|---|
| Student name, class | view | view | view | own children |
| Parent phone, address | hidden | view | view | own |
| Fees | hidden | hidden | edit | own children (view) |
| Marks | own subject | all subjects of class | hidden | own children (published only) |

Field rules apply everywhere data leaves the API: screens, search, exports, reports, PDFs.

### 5.5 Feature Flags

A user can use a feature only if **module enabled AND user permitted**. Disabled modules disappear from navigation, dashboards, search and quick actions, and their API endpoints return `403 FEATURE_DISABLED`.

---

## 6. Identity and Login Rules

### 6.1 One User Table

Every person who can log in is one row in `users`.

| Rule | Detail |
|---|---|
| L1 | `email` is unique across all users (if present). |
| L2 | `mobile` is unique across all users (if present). |
| L3 | A person has **one** account even if they are both staff and parent. |
| L4 | Passwords are stored only as Argon2id hashes. Never logged, never stored in plain text. |
| L5 | Any account can be **disabled** by an authorised user. Disabled users cannot log in; their sessions are revoked immediately. |

### 6.2 Staff Login

| Rule | Detail |
|---|---|
| L6 | Staff log in with **email + password** or **mobile + password**. |
| L7 | Forgot password for staff works **only by email** (reset link). |

### 6.3 Family / Student Login

| Rule | Detail |
|---|---|
| L8 | One **family account** per family, using the family's mobile number. All the family's children are linked to it. |
| L9 | Staff generate a temporary password. The system builds a WhatsApp message with the login link, username (mobile) and temporary password, and opens WhatsApp (`wa.me`) for staff to send. |
| L10 | First login forces a password change. |
| L11 | If the family/student has added an email, they can reset their own password by email. |
| L12 | If not, authorised staff **regenerate** a temporary password and resend it on WhatsApp (L9 again). |
| L13 | College: login holder is either the **student** (mobile or email) or the **parent**, as configured by the institution. |

Credential message template (editable by Admin):

```text
Dear {{family_name}},
Login for {{institution.name}}:
Link: {{login_url}}
Username: {{mobile}}
Password: {{temp_password}}
Please change your password after first login.
```

### 6.4 Staff Who Are Also Parents

| Rule | Detail |
|---|---|
| L14 | Admin links a staff member's own children to the staff member's account (backend action). |
| L15 | After login, a **workspace switcher** shows: `Staff` and `Parent`. |
| L16 | In Parent workspace, the user sees **only their own linked children**, with family-level access, even if their staff role has wider access. |
| L17 | Every API call carries the active workspace. Permissions are evaluated for that workspace only. |

### 6.5 Login Security

- Login throttling and failed-attempt counter; temporary lock after repeated failures
- Session list with "log out from all devices"
- Short-lived access token + rotating refresh token (stored hashed in MySQL)
- Login audit (success and failure, IP, device)

---

## 7. Student Lifecycle

| Rule | Detail |
|---|---|
| ST1 | Student status: **active** or **inactive**. |
| ST2 | Inactive students are hidden from all lists, searches, attendance sheets and dashboards. |
| ST3 | Admin can search inactive students explicitly and **reactivate** them. |
| ST4 | Past payments of inactive students **still count** in collection and finance reports. |
| ST5 | When **all** children of a family are inactive, the family login is **disabled automatically**. It is re-enabled automatically when any child is reactivated (unless manually disabled). |
| ST6 | A student belongs to classes through **enrollments per academic year**. Historical records are never overwritten. |
| ST7 | Promotion creates a new enrollment for the next year (promote, detain, transfer, leave). |
| ST8 | All student data (class, fees, attendance, marks) is kept **academic-year-wise**. |

---

## 8. Academic Structure

| Item | Rule |
|---|---|
| Academic year | Default June to April. Start and end dates configurable. One year is marked current. |
| Classes | Nursery, LKG, UKG, Class 1 to 10 for schools. Ordered by level. |
| Sections | Per class (A, B, C...). |
| Subjects | Per class per academic year. |
| Teacher assignment | Teacher + academic year + class + section + subject. |
| Class teacher | One staff member per section per academic year. Gets class-wide scope through permissions, not hard-coded screens. |

---

## 9. Fee Management Rules

### 9.1 Fee Categories

| Category | Set at | Split into installments? | Discount allowed? |
|---|---|---|---|
| **Tuition (term) fee** | Per class, per academic year | Yes, by the student's plan | Yes, fixed amount per student |
| **Bus fee** | Per route, per academic year | **No.** One amount per year | Yes, fixed amount per student (separate from tuition) |
| **One-time fees** (exam, admission, books, uniform, etc.) | Fee type + amount per class, per academic year | No | **No.** Same for every student in the class |

"Term fee" and "tuition fee" mean the same thing.

### 9.2 Tuition Plans

| Rule | Detail |
|---|---|
| F1 | Available plans: **Yearly** (1 installment), **Half-yearly** (2), **Quarterly** (4). No monthly plan. |
| F2 | For each academic year, the Admin/Super Admin sets the **default plan**. Every student gets it automatically. |
| F3 | Admin can change the plan for an individual student. |
| F4 | A student's plan is **locked once the academic year start date has passed**. Exception (agreed during build): a fee account created after the start date (new admission or mid-year onboarding) may change plan until its first payment. |
| F5 | For each academic year, the Admin sets a **due date and label for every installment of every plan** (e.g. Quarterly: Q1 June 10, Q2 Sept 10, Q3 Dec 10, Q4 Feb 10). |
| F6 | Plans and due dates of a past year never change when a new year is configured. |

### 9.3 Discounts (Concessions)

| Rule | Detail |
|---|---|
| F7 | Discounts are given **per student**, as a **fixed amount** (no percentage). |
| F8 | Tuition discount and bus discount are **separate** values. |
| F9 | Optional **concession type** label (e.g. Sibling, Staff child, Management). Admin manages the list. |
| F10 | A discount can be added or changed **only while the student has no payment** recorded for that academic year. After the first payment it is locked. |
| F11 | The original class fee is never changed. The discount is stored separately and the net amount is calculated. |

### 9.4 Installment Split Rule

| Rule | Detail |
|---|---|
| F12 | Net tuition = Class tuition fee − Tuition discount. |
| F13 | Net tuition is split equally across the plan's installments, in **whole hundreds** (no paise, no odd amounts). |
| F14 | The **first installment absorbs** the remainder. |

Algorithm:

```text
n          = number of installments in plan
net        = class_tuition - tuition_discount
base       = floor(net / n / 100) * 100        -- every installment except the first
first      = net - base * (n - 1)              -- first absorbs the remainder
```

Examples:

| Class fee | Discount | Net | Plan | Installments |
|---|---|---|---|---|
| 30,000 | 0 | 30,000 | Quarterly | 7,500 + 7,500 + 7,500 + 7,500 |
| 30,000 | 3,000 | 27,000 | Quarterly | **6,900** + 6,700 + 6,700 + 6,700 |
| 30,000 | 0 | 30,000 | Half-yearly | 15,000 + 15,000 |
| 25,000 | 0 | 25,000 | Quarterly | **6,400** + 6,200 + 6,200 + 6,200 |
| 30,000 | 0 | 30,000 | Yearly | 30,000 |

### 9.5 Bus Fee

| Rule | Detail |
|---|---|
| F15 | Admin creates routes and sets the bus fee **per route per academic year**. |
| F16 | A student assigned to a route gets that route's fee as **one due item** for the year. |
| F17 | Bus discount (fixed amount) reduces that one item. Locked after first payment (F10). |
| F18 | Partial payments are allowed on the bus fee. |

### 9.6 One-Time Fees

| Rule | Detail |
|---|---|
| F19 | Admin creates fee types (Exam fee, Admission fee, Books, Uniform, etc.). |
| F20 | Admin sets the amount for a class and academic year, with an optional due date. All active students in that class get the due item. |
| F21 | No individual exemption or reduction. |
| F22 | Students who join the class later automatically receive the class's existing one-time fees for that year. |

### 9.7 Collecting Payments

| Rule | Detail |
|---|---|
| F23 | Payments are recorded offline. Methods: Cash, UPI, Cheque, Bank transfer, Card (POS). Reference number for non-cash. |
| F24 | **Staff choose which fee(s)** the payment goes to (Tuition, Bus, a specific one-time fee, or Previous year due). One receipt can cover several fees with an amount entered for each. |
| F25 | Within **Tuition**, the amount clears the **oldest unpaid installment first** automatically. |
| F26 | **Partial payments** are allowed for every fee. |
| F27 | The amount entered for a fee cannot exceed that fee's outstanding balance (no advance or excess payments). |
| F28 | Payments are never edited or deleted. Mistakes are corrected by **voiding** the receipt with a reason. Voiding reverses its allocations. |

Worked example (net tuition 30,000, Quarterly plan, 7,500 per installment):

| Step | Q1 | Q2 | Q3 | Q4 | Total due |
|---|---|---|---|---|---|
| Start | 7,500 | 7,500 | 7,500 | 7,500 | 30,000 |
| Pays 5,000 to Tuition | 2,500 left | 7,500 | 7,500 | 7,500 | 25,000 |
| Pays 10,000 to Tuition | 0 | 0 | 7,500 | 7,500 | 15,000 |
| Pays 3,000 to Tuition | 0 | 0 | 4,500 left | 7,500 | 12,000 |

In the second payment, 2,500 clears the rest of Q1 and the remaining 7,500 clears Q2. The receipt lists both lines: "Tuition Q1 2,500" and "Tuition Q2 7,500".

### 9.8 Previous Year Dues

| Rule | Detail |
|---|---|
| F29 | Unpaid balances of a past academic year are shown in the current year as **"Previous year due"** (per fee). |
| F30 | When paid, the money is allocated to the **original year's** fee items. Each year's books remain correct. |
| F31 | Previous year dues appear first in the collection screen so staff see them. |

### 9.9 Late Fine

F32: **No late fine.** Due dates are used only for "Overdue" status, dashboards and reminders.

### 9.10 Fee Status Definitions

| Status | Meaning |
|---|---|
| Not due | Due date in the future, unpaid |
| Due | Due date today or passed, partially or fully unpaid |
| Partially paid | Some amount paid, balance remaining |
| Paid | Balance zero |

### 9.11 Finance Reports (R2)

- Daily collection (by date, method, staff)
- Outstanding by class / section / student (current year and previous years)
- Collection by fee category (tuition, bus, each one-time fee)
- Discount report (by concession type)
- Voided receipts report
- Student fee statement (all years)

---

## 10. Receipts

| Rule | Detail |
|---|---|
| R1 | A receipt is created for every payment, with a **gapless sequential number** per academic year. Default format: `RCPT/2026-27/00001` (prefix configurable). |
| R2 | The receipt PDF is **generated on demand** from the saved payment record. **No PDF file is stored** on the server. The balance printed on a receipt is saved with the payment, so reprints never change. |
| R3 | Staff share it on WhatsApp: on mobile via the phone's Share sheet (PDF attached directly); on desktop by downloading and attaching in WhatsApp. |
| R4 | Families (and college login holders) can **view or download** receipts after login. |
| R5 | A voided receipt keeps its number and shows a clear **VOID** mark with reason, date and user. |

Receipt contents: institution logo, name, address, phone; receipt number and date; student name, admission number, class and section; academic year; each fee paid (with installment labels, e.g. "Tuition Q1 (2026-27)"); amount per line; total in figures and words; payment method and reference; collected by; balance remaining after this payment; signature area.

---

## 11. Attendance

| Rule | Detail |
|---|---|
| A1 | Student daily attendance: Present, Absent, Late, Half day, Leave, Holiday. Period/subject mode can be enabled later. |
| A2 | Academic calendar with holidays and working days per academic year. |
| A3 | Fast marking: all students default to Present; teacher taps the absentees. Works offline and syncs when online. |
| A4 | Staff attendance: Present, Absent, Late, Half day, Leave. |
| A5 | Families (and college login holders) see attendance and monthly percentage. |
| A6 | Bulk import from Excel (Section 15.3). |

---

## 12. Exams and Report Cards

| Rule | Detail |
|---|---|
| E1 | Default pattern: **Telangana State Board** with FA1, FA2, FA3, FA4 (formative) and SA1, SA2 (summative). Exams, max marks, weightage and grade scale are configurable. |
| E2 | Teachers enter marks only for their assigned class/section/subject. |
| E3 | Workflow: Enter → Submit → Review → Approve → Publish. |
| E4 | Published marks cannot be edited silently. Corrections go through an audited correction request. |
| E5 | Families see marks only after publish. |
| E6 | Report card decided (planning session): FA out of 20 and SA out of 80; unit tests and pre-finals for tracking only; editable grade scales (primary A+ to C, high school A1 to E) with marks, grades or both per class; each exam shown plus a combined final (formula per class: per term, year-end or weights); co-scholastic areas (4 Telangana areas, admin edits, class teachers may add for their class); pre-primary skills report; subject teacher enters and submits, principal approves and publishes; corrections via principal with family notified; rank in section and class; card shows term attendance, class teacher's remarks and photo; leaving students get a TC and bonafide checklist (certificates prepared outside the app); exam schedule visible to teachers and families. Absent = AB (counts as 0); pass mark 35%. |

---

## 13. Public Website and CMS

| Rule | Detail |
|---|---|
| W1 | Public pages are visible to everyone. Content is managed by the **Admin or Super Admin**. |
| W2 | Only users created by the institution can log in. There is **no public registration**. |
| W3 | Pages: Home, About, Academics, Admissions information, Events, Gallery, Videos (YouTube links), Announcements/News, Contact, Policies, custom pages. |
| W4 | Home page sections can be shown/hidden and reordered (drag and drop). |
| W5 | Header and footer links and social links can be shown/hidden, renamed and reordered. |
| W6 | Gallery can be linked to an existing event, a new event, or no event. |
| W7 | SEO fields per page: title, meta description, OG image. Sitemap generated automatically. |

### 13.1 Contact Form

| Rule | Detail |
|---|---|
| W8 | Fields: Name, Mobile (optional), Message. |
| W9 | On submit: the message is **saved** in the admin panel, **emailed** to the configured contact email (SMTP), and WhatsApp opens on the visitor's device with the message **pre-filled** to the institution's configured WhatsApp number. |
| W10 | Contact email and WhatsApp number are set by the Admin or Super Admin. |
| W11 | Spam protection: rate limit per IP plus a honeypot field. |

Automatic WhatsApp delivery (without the visitor tapping Send) needs the WhatsApp Business API and is a later item.

---

## 14. Communication and Notifications

| Channel | Status |
|---|---|
| In-app notification centre | R1 |
| Email (SMTP, queued, with templates and delivery log) | R1 |
| WhatsApp (manual share via `wa.me` link / share sheet) | R1 (credentials), R2 (receipts) |
| WhatsApp Business API (automatic) | Later (R8) |
| SMS (needs DLT registration in India) | Later (R8) |
| Push notifications | With mobile apps (R9) |

Announcements: title, content (rich text), audience (all, staff, families, class, section), publish and expiry dates.

---

## 15. Bulk Import and Export

### 15.1 Import Process (all imports)

1. Download Excel template
2. Upload filled file
3. System validates every row
4. Error preview (row number, column, reason) downloadable as Excel
5. Confirm
6. Import runs in a **single transaction**: all valid or nothing. Never a silent partial import.
7. Import log kept (who, when, file name, counts)

### 15.2 Imports Available

| Import | Release | Key columns |
|---|---|---|
| Families + Students | R1 | Admission no, student name, DOB, gender, class, section, roll no, father name, mother name, family mobile, email, address |
| Staff | R1 | Employee code, name, email, mobile, designation, department, joining date |
| Opening fee balances | R2 | Admission no, academic year, plan, tuition discount, bus route, bus discount, amount already paid per fee category |
| Attendance | R3 | Admission no, then one column per date with P/A |

Rule IM1: Families are matched by mobile number. Two students with the same family mobile are linked to the same family account.
Rule IM2: Imported opening payments are recorded as a special "Opening balance" receipt type (separate number series), so they are visible but distinct from real collections.

### 15.3 Attendance Excel Format

| Admission No | Student Name | 2026-07-01 | 2026-07-02 | 2026-07-03 | ... |
|---|---|---|---|---|---|
| 1023 | Ravi Kumar | P | P | A | ... |

One sheet per class-section per month. Templates are generated by the system with student rows pre-filled.

### 15.4 Export

Every list and report can be exported to Excel and PDF (respecting field permissions).

---

## 16. Audit, Privacy and Data Retention

| Rule | Detail |
|---|---|
| AU1 | Every important action is logged: user, workspace, action, module, record, time, IP, device, before/after values where relevant. |
| AU2 | Audit logs are read-only for everyone in the app. |
| AU3 | Financial records are never deleted. Corrections use void. |
| AU4 | Sensitive documents are stored privately and served only through permission-checked, short-lived links. |
| AU5 | Students are minors. Collect only what the institution needs. Aadhaar and similar IDs are optional fields, never mandatory. |
| AU6 | Data is archived by academic year, not deleted. |
| AU7 | Automated nightly database backup to off-server storage, with a monthly restore test. Last backup status visible in the Super Admin console. |

---

## 17. UI / UX Standards

Design direction: clean, minimal, premium. Neutral palette (zinc/slate), one institution accent colour, Inter typeface, 8px spacing grid, subtle borders, soft cards, no heavy gradients or shadows.

| Area | Standard |
|---|---|
| Mobile shell | Bottom navigation: Home, Search, Tasks, Alerts, Profile. Filters and forms in bottom sheets. Sticky primary action. Lists as cards. |
| Desktop shell | Collapsible sidebar, command palette (Ctrl/Cmd + K), data tables with column chooser and saved filters. |
| Workspace switcher | Visible in header for users with both Staff and Parent access. |
| Branding | Institution colour checked for contrast automatically; adjusted for buttons and text if unreadable. |
| States | Every screen has loading (skeleton), empty (with action), error (with retry), success (toast) and no-permission states. |
| Responsive | Tested at 320, 360, 390, 414 px, tablet, desktop. Single-column forms on mobile. |
| Accessibility | WCAG AA: keyboard navigation, visible focus, labels, contrast, reduced motion. |
| PWA | Installable on phones; attendance marking works offline. |

Signature flows to perfect first:

1. **Fee collection in 3 taps:** search student, see dues grouped by fee (previous year first), enter amounts, choose method, save, share receipt.
2. **Attendance in 10 seconds:** all Present by default, tap absentees, submit.
3. **Student 360:** sticky header (photo, class, status, quick actions) with tabs shown only if permitted.
4. **Family home:** child switcher, fees due, latest attendance, notices, receipts.

---

## 18. Technology Stack

| Layer | Choice | Reason |
|---|---|---|
| Repository | Turborepo + pnpm monorepo | Admin app, public site, API and future mobile app share types and UI |
| API | NestJS (TypeScript) on Node.js 22 LTS | Modular domains, guards for permissions, built-in Swagger |
| Database | **MySQL 8.4 LTS**, InnoDB, `utf8mb4_0900_ai_ci` | Requirement. CTEs, window functions and JSON support |
| ORM / migrations | Prisma (versioned migrations); Kysely for complex report SQL | Safe repeatable deployments, typed queries |
| Queue / cache | Redis + BullMQ | Emails, imports, PDF rendering, reminders. Holds no business data |
| Auth | Argon2id; short-lived JWT access token + rotating refresh token stored hashed in MySQL | Works for web (httpOnly cookie) and mobile (bearer) |
| Authorisation | CASL + custom scope resolver + response field filter | Module/action/scope/field rules in one place |
| Admin app | React + Vite + TypeScript, TanStack Router + TanStack Query, PWA | App-like, fast, deploys as static files |
| Public website | Next.js (server-rendered) | SEO for public pages |
| UI kit | Tailwind CSS + shadcn/ui (Radix), lucide icons, TanStack Table, React Hook Form + Zod, Tiptap editor, dnd-kit, Recharts, cmdk, Sonner, vaul | Accessible, consistent, mobile-friendly |
| PDF | HTML templates (Handlebars) rendered by Playwright, streamed to the user, never saved | Receipts, report cards, certificates |
| Excel | ExcelJS | Import templates, validation reports, exports |
| Email | Nodemailer over SMTP, queued, MJML templates | Configurable SMTP |
| File storage | Local disk (dev), S3-compatible private bucket (prod), signed URLs | Photos, documents |
| Hosting | Linux VPS, Docker Compose, Caddy (automatic HTTPS) | Provider to be decided |
| CI/CD | GitHub Actions: test, build, migrate, deploy | Every release repeatable |
| Monitoring | Sentry, structured logs (Pino), Uptime Kuma, BullMQ dashboard | Errors, jobs, uptime |
| Backups | Nightly MySQL dump + binlogs to off-server storage, monthly restore test | Data safety |
| Mobile (later) | Expo (React Native) on the same `/api/v1` | No backend rewrite |

### 18.1 Repository Structure

```text
apps/
  api/            NestJS API
  admin/          React + Vite admin and family app (PWA)
  web/            Next.js public website
packages/
  ui/             shared design system components
  schemas/        shared Zod schemas and types
  api-client/     generated from OpenAPI
  config/         eslint, tsconfig, tailwind preset
infra/
  docker-compose.yml, Caddyfile, backup scripts
```

### 18.2 API Domains

```text
apps/api/src/modules/
  auth/  users/  roles/  settings/  features/  audit/  files/
  academics/  students/  families/  staff/  imports/
  announcements/  notifications/
  fees/  payments/  receipts/          (R2)
  attendance/  timetable/              (R3)
  exams/  marks/  report-cards/        (R4)
  cms/  contact/                       (R5)
```

---

## 19. Architecture and Database Conventions

### 19.1 API Standards

- Base path `/api/v1/`. Breaking changes go to `/api/v2/`.
- JSON responses: `{ "success": true, "data": {}, "meta": {} }`
- Errors: `{ "success": false, "code": "FORBIDDEN", "message": "..." }`
- Server-side pagination, filtering, sorting, search on every list
- Rate limiting on auth, contact form and imports
- OpenAPI documentation generated from code
- Every request passes: authentication → active workspace → feature flag → permission → scope → field filter

### 19.2 MySQL Conventions

| Convention | Rule |
|---|---|
| Engine / charset | InnoDB, `utf8mb4`, `utf8mb4_0900_ai_ci` |
| Primary keys | `id BIGINT UNSIGNED AUTO_INCREMENT` |
| Public IDs | `public_id CHAR(26)` ULID on records exposed in URLs (students, users, payments). Internal IDs are never exposed. |
| Timestamps | `created_at`, `updated_at` as `DATETIME(3)` in **UTC**; displayed in institution time zone (Asia/Kolkata) |
| Actors | `created_by`, `updated_by` on business tables |
| Soft delete | `deleted_at` only on master data. Never on financial or audit tables. |
| Money | `DECIMAL(12,2)`. UI works in whole rupees. |
| Status fields | `ENUM` for fixed sets, lookup tables for admin-managed lists |
| Flexible data | `JSON` columns for settings and custom fields; generated columns + index when a JSON field must be filtered |
| Sequences | `number_sequences` table locked with `SELECT ... FOR UPDATE` for gapless numbers |
| Migrations | Only through versioned migrations in CI. No manual schema imports on production. |
| Audit table | Append-only; the application DB user has no `UPDATE`/`DELETE` grant on it |

---

## 20. Release Plan (Every Release Deployable)

Each release ships to production only when it meets the **Definition of Done**:

- All migrations run cleanly on a copy of production data
- Automated tests pass, including the permission and fee test cases (Section 23)
- Demo data seed works
- Backup taken and restore verified
- Swagger docs updated
- 1 to 2 weeks of real use by a pilot school on staging, with issues fixed

Durations assume a team of 3 to 4 developers.

| Release | Scope | What the school can do after it | Est. |
|---|---|---|---|
| **R1 Foundation & People** | Design system and app shells (mobile + desktop), auth (staff email/mobile, family mobile), password generation + WhatsApp share, forced change, email reset, sessions, roles, permissions, scopes, field rules, feature flags, Super Admin console, institution settings and branding, SMTP, audit log, files, academic years, classes, sections, subjects, teacher assignments, class teachers, students (Student 360 basic), families, staff, staff-parent workspace switch, active/inactive rules, imports (families+students, staff), announcements, notification centre | Go paperless on records. Families log in and see children's profiles and notices. | 8 to 10 weeks |
| **R2 Fees & Receipts** | Tuition plans and due dates, class tuition fees, bus routes and route fees, one-time fee types, discounts and concession types, installment generation, collection screen, oldest-first allocation, previous year dues, receipts (on-demand PDF, WhatsApp share), void, opening balance import, finance reports, family fee view and receipt download, due reminders by email | Collect and track every rupee, share receipts instantly. | 5 to 6 weeks |
| **R3 Attendance & Timetable** | Academic calendar and holidays, daily student attendance (offline-capable), staff attendance, leave requests, attendance Excel import, timetable with conflict checks, attendance reports, family attendance view | Daily attendance on phones, families see it same day. | 4 to 5 weeks |
| **R4 Exams & Report Cards** | (After report card brainstorm.) Telangana FA/SA pattern, exam schedule, marks entry, submit/approve/publish, correction requests, report card PDF, certificates (bonafide, study, TC), family marks view | Run the exam cycle digitally. | 5 to 6 weeks |
| **R5 Public Website & CMS** | Home section builder, header/footer/social links, pages, events, gallery, videos, news, contact form (save + email + WhatsApp pre-fill), SEO, sitemap | Institution runs its own website from the admin panel. | 4 to 5 weeks |
| **R6 HR, Payroll & Expenses** | Employee HR records, leave types, salary structure, LOP from attendance, payroll run, payslips, expenses with approval | Monthly payroll and spending control. | 5 to 6 weeks |
| **R7 Operations** | Transport operations (vehicles, drivers, stops, documents, fuel), inventory, library | Back-office operations. | 5 to 6 weeks |
| **R8 Advanced** | Custom fields UI, form builder, workflow builder, report builder, WhatsApp Business API, SMS, online payment gateway, Telugu language | Deeper configuration and automation. | 8 to 10 weeks |
| **R9 Mobile Apps** | Expo apps for families and teachers, push notifications | Native apps on the same API. | 6 to 8 weeks |

Note: bus **routes** are created in R2 because the bus fee depends on them. Full transport operations come in R7.

---

## 21. R1 Database Schema (MySQL DDL)

Validated on MySQL 8.0.46 (compatible with 8.4 LTS). In the project, this is applied through versioned Prisma migrations, not by importing the file manually.

Key design points:

- `users` holds every login. `email` and `mobile` are each unique, and at least one is required.
- `families.user_id` is the family's login. For a staff member's own children, it points to the **staff member's** `user_id`, which enables the Staff / Parent switch.
- `students.user_id` is used only in College mode when the student is the login holder.
- `enrollments` links a student to a class and section **per academic year**, so history is never overwritten.
- Only one academic year can be current (enforced by a unique generated column).
- `credential_issues` logs who generated a temporary password and when. The password itself is never stored.

```sql
-- =========================================================
-- R1 SCHEMA: Foundation & People   (MySQL 8.4, InnoDB, utf8mb4)
-- =========================================================
SET NAMES utf8mb4;

-- ---------- Institution & configuration ----------

CREATE TABLE institution_settings (
  id                    TINYINT UNSIGNED NOT NULL DEFAULT 1,
  institution_type      ENUM('school','college') NOT NULL DEFAULT 'school',
  name                  VARCHAR(200) NOT NULL,
  short_name            VARCHAR(50)  NULL,
  logo_file_id          BIGINT UNSIGNED NULL,
  favicon_file_id       BIGINT UNSIGNED NULL,
  address               VARCHAR(500) NULL,
  phone                 VARCHAR(20)  NULL,
  contact_email         VARCHAR(190) NULL,
  contact_whatsapp      VARCHAR(20)  NULL,
  website_url           VARCHAR(255) NULL,
  timezone              VARCHAR(50)  NOT NULL DEFAULT 'Asia/Kolkata',
  currency              CHAR(3)      NOT NULL DEFAULT 'INR',
  college_login_holder  ENUM('student','parent') NOT NULL DEFAULT 'student',
  brand_primary         CHAR(7)      NULL,
  brand_secondary       CHAR(7)      NULL,
  smtp_config           JSON         NULL,   -- password encrypted at application level
  updated_by            BIGINT UNSIGNED NULL,
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_inst_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE feature_flags (
  module_key   VARCHAR(50) NOT NULL,
  is_enabled   TINYINT(1)  NOT NULL DEFAULT 0,
  updated_by   BIGINT UNSIGNED NULL,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (module_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE settings (
  setting_group VARCHAR(50)  NOT NULL,   -- e.g. 'auth', 'notifications', 'receipts'
  setting_key   VARCHAR(100) NOT NULL,
  value         JSON         NOT NULL,
  is_developer_only TINYINT(1) NOT NULL DEFAULT 0,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_group, setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE number_sequences (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  seq_key       VARCHAR(50)  NOT NULL,   -- 'receipt', 'opening_receipt', 'admission', 'employee'
  scope_key     VARCHAR(50)  NOT NULL DEFAULT 'global',  -- e.g. academic year name '2026-27'
  prefix        VARCHAR(30)  NOT NULL DEFAULT '',
  next_value    INT UNSIGNED NOT NULL DEFAULT 1,
  pad_length    TINYINT UNSIGNED NOT NULL DEFAULT 5,
  PRIMARY KEY (id),
  UNIQUE KEY uq_seq (seq_key, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- Identity ----------

CREATE TABLE users (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id             CHAR(26)     NOT NULL,
  name                  VARCHAR(150) NOT NULL,
  email                 VARCHAR(190) NULL,
  mobile                VARCHAR(15)  NULL,
  password_hash         VARCHAR(255) NULL,
  must_change_password  TINYINT(1)   NOT NULL DEFAULT 1,
  is_super_admin        TINYINT(1)   NOT NULL DEFAULT 0,
  status                ENUM('active','disabled','auto_disabled') NOT NULL DEFAULT 'active',
  email_verified_at     DATETIME(3)  NULL,
  failed_login_count    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until          DATETIME(3)  NULL,
  last_login_at         DATETIME(3)  NULL,
  password_changed_at   DATETIME(3)  NULL,
  created_by            BIGINT UNSIGNED NULL,
  updated_by            BIGINT UNSIGNED NULL,
  created_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public (public_id),
  UNIQUE KEY uq_users_email  (email),
  UNIQUE KEY uq_users_mobile (mobile),
  KEY ix_users_status (status),
  CONSTRAINT chk_users_identifier CHECK (email IS NOT NULL OR mobile IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE roles (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_key     VARCHAR(60)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  description  VARCHAR(255) NULL,
  workspace    ENUM('staff','parent','student') NOT NULL DEFAULT 'staff',
  is_system    TINYINT(1)   NOT NULL DEFAULT 0,   -- system roles cannot be deleted
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_key (role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE permissions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  module_key   VARCHAR(50)  NOT NULL,
  action       VARCHAR(30)  NOT NULL,
  description  VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_perm (module_key, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE role_permissions (
  role_id        BIGINT UNSIGNED NOT NULL,
  permission_id  BIGINT UNSIGNED NOT NULL,
  scope          ENUM('all','class','section','subject','assigned_students',
                      'own_records','own_children','assigned_route') NOT NULL DEFAULT 'all',
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_roles (
  user_id     BIGINT UNSIGNED NOT NULL,
  role_id     BIGINT UNSIGNED NOT NULL,
  valid_from  DATE NULL,
  valid_to    DATE NULL,       -- temporary roles
  assigned_by BIGINT UNSIGNED NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role_id),
  KEY ix_ur_role (role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE field_policies (
  role_id     BIGINT UNSIGNED NOT NULL,
  entity      VARCHAR(50) NOT NULL,   -- 'student', 'family', 'staff'
  field_key   VARCHAR(80) NOT NULL,   -- 'family.mobile', 'student.address', 'fees'
  access      ENUM('hidden','view','edit') NOT NULL,
  PRIMARY KEY (role_id, entity, field_key),
  CONSTRAINT fk_fp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sessions (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             BIGINT UNSIGNED NOT NULL,
  refresh_token_hash  CHAR(64)     NOT NULL,
  device_label        VARCHAR(150) NULL,
  ip_address          VARCHAR(45)  NULL,
  user_agent          VARCHAR(255) NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at        DATETIME(3)  NULL,
  expires_at          DATETIME(3)  NOT NULL,
  revoked_at          DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sess_token (refresh_token_hash),
  KEY ix_sess_user (user_id, revoked_at),
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_reset_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64)    NOT NULL,
  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_prt_token (token_hash),
  CONSTRAINT fk_prt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Log of temporary password generation. The password itself is NEVER stored here.
CREATE TABLE credential_issues (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  issued_by   BIGINT UNSIGNED NOT NULL,
  channel     ENUM('whatsapp_manual','copy','email') NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ci_user (user_id),
  CONSTRAINT fk_ci_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ci_by   FOREIGN KEY (issued_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE login_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NULL,
  identifier   VARCHAR(190) NOT NULL,     -- email or mobile entered
  success      TINYINT(1)   NOT NULL,
  reason       VARCHAR(50)  NULL,         -- 'bad_password', 'disabled', 'locked'
  ip_address   VARCHAR(45)  NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ll_user (user_id, created_at),
  KEY ix_ll_ident (identifier, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NULL,
  workspace    ENUM('staff','parent','student','developer','system') NOT NULL,
  module_key   VARCHAR(50)  NOT NULL,
  action       VARCHAR(50)  NOT NULL,
  entity_type  VARCHAR(50)  NULL,
  entity_id    BIGINT UNSIGNED NULL,
  before_data  JSON NULL,
  after_data   JSON NULL,
  ip_address   VARCHAR(45)  NULL,
  user_agent   VARCHAR(255) NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity_type, entity_id),
  KEY ix_audit_user (user_id, created_at),
  KEY ix_audit_module (module_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE files (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)     NOT NULL,
  disk           ENUM('local','s3') NOT NULL,
  storage_path   VARCHAR(500) NOT NULL,
  original_name  VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  size_bytes     INT UNSIGNED NOT NULL,
  visibility     ENUM('public','private') NOT NULL DEFAULT 'private',
  module_key     VARCHAR(50)  NULL,
  entity_type    VARCHAR(50)  NULL,
  entity_id      BIGINT UNSIGNED NULL,
  uploaded_by    BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_files_public (public_id),
  KEY ix_files_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- Academic structure ----------

CREATE TABLE academic_years (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name         VARCHAR(20) NOT NULL,      -- '2026-27'
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  is_current   TINYINT(1) NOT NULL DEFAULT 0,
  status       ENUM('planned','active','closed') NOT NULL DEFAULT 'planned',
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  current_flag TINYINT GENERATED ALWAYS AS (IF(is_current = 1, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ay_name (name),
  UNIQUE KEY uq_ay_one_current (current_flag),   -- only one current year
  CONSTRAINT chk_ay_dates CHECK (end_date > start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE classes (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(50) NOT NULL,    -- 'Nursery', 'LKG', 'Class 5'
  level_order    SMALLINT NOT NULL,       -- sort and promotion order
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_class_name (name),
  KEY ix_class_order (level_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sections (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  class_id    BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(20) NOT NULL,       -- 'A', 'B'
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_section (class_id, name),
  CONSTRAINT fk_section_class FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE subjects (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  code        VARCHAR(20)  NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subject_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE class_subjects (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL,
  subject_id        BIGINT UNSIGNED NOT NULL,
  display_order     SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (academic_year_id, class_id, subject_id),
  CONSTRAINT fk_cs_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_cs_class   FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_cs_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- People ----------

CREATE TABLE staff (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)     NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  employee_code    VARCHAR(30)  NOT NULL,
  designation      VARCHAR(100) NULL,
  department       VARCHAR(100) NULL,
  qualification    VARCHAR(200) NULL,
  experience_years DECIMAL(4,1) NULL,
  joining_date     DATE NULL,
  gender           ENUM('male','female','other') NULL,
  dob              DATE NULL,
  address          VARCHAR(500) NULL,
  photo_file_id    BIGINT UNSIGNED NULL,
  status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
  custom_data      JSON NULL,
  created_by       BIGINT UNSIGNED NULL,
  updated_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at       DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_public (public_id),
  UNIQUE KEY uq_staff_user (user_id),
  UNIQUE KEY uq_staff_code (employee_code),
  KEY ix_staff_status (status),
  CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE teacher_assignments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  staff_id          BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  subject_id        BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ta (academic_year_id, section_id, subject_id, staff_id),
  KEY ix_ta_staff (staff_id, academic_year_id),
  CONSTRAINT fk_ta_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ta_staff   FOREIGN KEY (staff_id) REFERENCES staff(id),
  CONSTRAINT fk_ta_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT fk_ta_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE class_teachers (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  staff_id          BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (academic_year_id, section_id),
  KEY ix_ct_staff (staff_id),
  CONSTRAINT fk_ct_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ct_section FOREIGN KEY (section_id) REFERENCES sections(id),
  CONSTRAINT fk_ct_staff   FOREIGN KEY (staff_id) REFERENCES staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One family = one login account (users row). A staff member's own family
-- points to the staff member's user_id, which enables the Staff/Parent switch.
CREATE TABLE families (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)     NOT NULL,
  user_id        BIGINT UNSIGNED NULL,
  family_name    VARCHAR(150) NOT NULL,
  father_name    VARCHAR(150) NULL,
  mother_name    VARCHAR(150) NULL,
  guardian_name  VARCHAR(150) NULL,
  primary_mobile VARCHAR(15)  NOT NULL,
  alt_mobile     VARCHAR(15)  NULL,
  email          VARCHAR(190) NULL,
  address        VARCHAR(500) NULL,
  custom_data    JSON NULL,
  created_by     BIGINT UNSIGNED NULL,
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_family_public (public_id),
  UNIQUE KEY uq_family_user (user_id),
  UNIQUE KEY uq_family_mobile (primary_mobile),
  CONSTRAINT fk_family_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE students (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)     NOT NULL,
  admission_no     VARCHAR(30)  NOT NULL,
  family_id        BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NULL,     -- college student login only
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NULL,
  dob              DATE NULL,
  gender           ENUM('male','female','other') NULL,
  blood_group      VARCHAR(5)   NULL,
  admission_date   DATE NULL,
  address          VARCHAR(500) NULL,
  photo_file_id    BIGINT UNSIGNED NULL,
  status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
  inactive_reason  VARCHAR(255) NULL,
  inactive_at      DATETIME(3)  NULL,
  custom_data      JSON NULL,
  created_by       BIGINT UNSIGNED NULL,
  updated_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_public (public_id),
  UNIQUE KEY uq_student_adm (admission_no),
  UNIQUE KEY uq_student_user (user_id),
  KEY ix_student_family (family_id),
  KEY ix_student_status_name (status, first_name),
  FULLTEXT KEY ft_student_name (first_name, last_name, admission_no),
  CONSTRAINT fk_student_family FOREIGN KEY (family_id) REFERENCES families(id),
  CONSTRAINT fk_student_user   FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE enrollments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id        BIGINT UNSIGNED NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL,
  section_id        BIGINT UNSIGNED NOT NULL,
  roll_no           VARCHAR(10) NULL,
  joined_on         DATE NULL,
  status            ENUM('enrolled','promoted','detained','transferred','left','completed')
                    NOT NULL DEFAULT 'enrolled',
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_enroll (student_id, academic_year_id),
  KEY ix_enroll_section (academic_year_id, section_id),
  KEY ix_enroll_class (academic_year_id, class_id),
  CONSTRAINT fk_en_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_en_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_en_class   FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_en_section FOREIGN KEY (section_id) REFERENCES sections(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- Communication ----------

CREATE TABLE announcements (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title         VARCHAR(200) NOT NULL,
  body_html     MEDIUMTEXT   NOT NULL,     -- sanitised before save
  audience      JSON NOT NULL,             -- {"type":"section","ids":[3,4]}
  is_public     TINYINT(1) NOT NULL DEFAULT 0,
  status        ENUM('draft','scheduled','published','archived') NOT NULL DEFAULT 'draft',
  publish_at    DATETIME(3) NULL,
  expire_at     DATETIME(3) NULL,
  created_by    BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_ann_status (status, publish_at),
  CONSTRAINT fk_ann_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE notifications (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  workspace    ENUM('staff','parent','student') NOT NULL,
  category     ENUM('system','academic','finance','communication') NOT NULL,
  title        VARCHAR(200) NOT NULL,
  body         VARCHAR(500) NULL,
  link_path    VARCHAR(255) NULL,
  read_at      DATETIME(3)  NULL,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_notif_user (user_id, read_at, created_at),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_templates (
  template_key  VARCHAR(60)  NOT NULL,     -- 'password_reset', 'fee_reminder'
  subject       VARCHAR(200) NOT NULL,
  body_html     MEDIUMTEXT   NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  updated_by    BIGINT UNSIGNED NULL,
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (template_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_outbox (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  to_email      VARCHAR(190) NOT NULL,
  template_key  VARCHAR(60)  NULL,
  subject       VARCHAR(200) NOT NULL,
  status        ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error    VARCHAR(500) NULL,
  sent_at       DATETIME(3) NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_outbox_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- Imports ----------

CREATE TABLE import_jobs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_type   ENUM('families_students','staff','opening_fees','attendance') NOT NULL,
  file_id       BIGINT UNSIGNED NOT NULL,
  status        ENUM('uploaded','validating','invalid','ready','importing','completed','failed')
                NOT NULL DEFAULT 'uploaded',
  total_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  valid_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  error_rows    INT UNSIGNED NOT NULL DEFAULT 0,
  errors        JSON NULL,               -- [{row, column, message}]
  created_by    BIGINT UNSIGNED NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at  DATETIME(3) NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_imp_file FOREIGN KEY (file_id) REFERENCES files(id),
  CONSTRAINT fk_imp_by   FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

---

## 22. R2 Database Schema: Fees (MySQL DDL)

Key design points:

- `student_fee_accounts`: one row per student per year holding the plan, discounts and bus route.
- `fee_items`: every amount owed is one row (each tuition installment, the bus fee, each one-time fee). `balance` is a stored generated column, so outstanding reports are a simple indexed query.
- `payments` = receipts. Never edited except to void.
- `payment_allocations` records exactly which fee items a receipt paid. A payment received in 2026-27 can allocate to a 2025-26 fee item (rule F30).
- Database `CHECK` constraints block discounts above the fee and payments above the balance, even if application code has a bug.

```sql
-- =========================================================
-- R2 SCHEMA: Fees & Receipts   (MySQL 8.4, InnoDB, utf8mb4)
-- =========================================================

-- Plans: yearly (1), half_yearly (2), quarterly (4)
CREATE TABLE fee_plans (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_key           ENUM('yearly','half_yearly','quarterly') NOT NULL,
  name               VARCHAR(50) NOT NULL,
  installment_count  TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_key (plan_key),
  CONSTRAINT chk_plan_count CHECK (installment_count IN (1,2,4))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Default tuition plan per academic year (rule F2)
CREATE TABLE academic_year_fee_settings (
  academic_year_id     BIGINT UNSIGNED NOT NULL,
  default_fee_plan_id  BIGINT UNSIGNED NOT NULL,
  updated_by           BIGINT UNSIGNED NULL,
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (academic_year_id),
  CONSTRAINT fk_ayfs_ay   FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ayfs_plan FOREIGN KEY (default_fee_plan_id) REFERENCES fee_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Installment labels and due dates per plan per year (rule F5)
CREATE TABLE plan_installments (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  fee_plan_id       BIGINT UNSIGNED NOT NULL,
  installment_no    TINYINT UNSIGNED NOT NULL,
  label             VARCHAR(30) NOT NULL,     -- 'Q1', 'Term 1', 'Annual'
  due_date          DATE NOT NULL,
  PRIMARY KEY (academic_year_id, fee_plan_id, installment_no),
  CONSTRAINT fk_pi_ay   FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_pi_plan FOREIGN KEY (fee_plan_id) REFERENCES fee_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Tuition fee per class per year
CREATE TABLE class_tuition_fees (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  class_id          BIGINT UNSIGNED NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  updated_by        BIGINT UNSIGNED NULL,
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (academic_year_id, class_id),
  CONSTRAINT fk_ctf_ay    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_ctf_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT chk_ctf_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE bus_routes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_route_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Bus fee per route per year (rule F15)
CREATE TABLE route_fees (
  academic_year_id  BIGINT UNSIGNED NOT NULL,
  bus_route_id      BIGINT UNSIGNED NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  due_date          DATE NULL,
  PRIMARY KEY (academic_year_id, bus_route_id),
  CONSTRAINT fk_rf_ay    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_rf_route FOREIGN KEY (bus_route_id) REFERENCES bus_routes(id),
  CONSTRAINT chk_rf_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE concession_types (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,     -- 'Sibling', 'Staff child'
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conc_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE one_time_fee_types (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(100) NOT NULL,     -- 'Exam fee', 'Books'
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_otft_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One-time fee charged to a whole class (rules F19 to F22)
CREATE TABLE class_one_time_fees (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id    BIGINT UNSIGNED NOT NULL,
  class_id            BIGINT UNSIGNED NOT NULL,
  one_time_fee_type_id BIGINT UNSIGNED NOT NULL,
  title               VARCHAR(150) NOT NULL,   -- 'SA1 Exam fee'
  amount              DECIMAL(12,2) NOT NULL,
  due_date            DATE NULL,
  created_by          BIGINT UNSIGNED NOT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_cotf_class (academic_year_id, class_id),
  CONSTRAINT fk_cotf_ay    FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_cotf_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_cotf_type  FOREIGN KEY (one_time_fee_type_id) REFERENCES one_time_fee_types(id),
  CONSTRAINT chk_cotf_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per student per academic year: plan, discounts, route.
-- Plan locked after year start (F4); discounts locked after first payment (F10).
CREATE TABLE student_fee_accounts (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id          BIGINT UNSIGNED NOT NULL,
  student_id                BIGINT UNSIGNED NOT NULL,
  fee_plan_id               BIGINT UNSIGNED NOT NULL,
  tuition_gross             DECIMAL(12,2) NOT NULL,         -- copied from class fee
  tuition_discount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  tuition_concession_type_id BIGINT UNSIGNED NULL,
  bus_route_id              BIGINT UNSIGNED NULL,
  bus_gross                 DECIMAL(12,2) NOT NULL DEFAULT 0,
  bus_discount              DECIMAL(12,2) NOT NULL DEFAULT 0,
  bus_concession_type_id    BIGINT UNSIGNED NULL,
  has_payments              TINYINT(1) NOT NULL DEFAULT 0, -- set on first payment, locks discounts
  created_by                BIGINT UNSIGNED NULL,
  updated_by                BIGINT UNSIGNED NULL,
  created_at                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sfa (academic_year_id, student_id),
  KEY ix_sfa_student (student_id),
  CONSTRAINT fk_sfa_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_sfa_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_sfa_plan    FOREIGN KEY (fee_plan_id) REFERENCES fee_plans(id),
  CONSTRAINT fk_sfa_route   FOREIGN KEY (bus_route_id) REFERENCES bus_routes(id),
  CONSTRAINT fk_sfa_tconc   FOREIGN KEY (tuition_concession_type_id) REFERENCES concession_types(id),
  CONSTRAINT fk_sfa_bconc   FOREIGN KEY (bus_concession_type_id) REFERENCES concession_types(id),
  CONSTRAINT chk_sfa_tdisc  CHECK (tuition_discount >= 0 AND tuition_discount <= tuition_gross),
  CONSTRAINT chk_sfa_bdisc  CHECK (bus_discount >= 0 AND bus_discount <= bus_gross)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every amount a student owes is one row here (tuition installments, bus, one-time).
CREATE TABLE fee_items (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  academic_year_id        BIGINT UNSIGNED NOT NULL,
  student_id              BIGINT UNSIGNED NOT NULL,
  student_fee_account_id  BIGINT UNSIGNED NOT NULL,
  category                ENUM('tuition','bus','one_time') NOT NULL,
  installment_no          TINYINT UNSIGNED NULL,          -- tuition only
  class_one_time_fee_id   BIGINT UNSIGNED NULL,           -- one_time only
  label                   VARCHAR(150) NOT NULL,          -- 'Tuition Q1', 'Bus fee', 'SA1 Exam fee'
  due_date                DATE NULL,
  amount                  DECIMAL(12,2) NOT NULL,
  paid_amount             DECIMAL(12,2) NOT NULL DEFAULT 0, -- maintained in the same transaction as allocations
  balance                 DECIMAL(12,2) GENERATED ALWAYS AS (amount - paid_amount) STORED,
  created_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_fi_tuition (student_fee_account_id, category, installment_no),
  UNIQUE KEY uq_fi_onetime (student_id, class_one_time_fee_id),
  KEY ix_fi_student_due (student_id, academic_year_id, category, installment_no),
  KEY ix_fi_balance (academic_year_id, balance),
  CONSTRAINT fk_fi_ay      FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_fi_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_fi_sfa     FOREIGN KEY (student_fee_account_id) REFERENCES student_fee_accounts(id),
  CONSTRAINT fk_fi_cotf    FOREIGN KEY (class_one_time_fee_id) REFERENCES class_one_time_fees(id),
  CONSTRAINT chk_fi_paid   CHECK (paid_amount >= 0 AND paid_amount <= amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A payment = one receipt. Never updated except to void.
CREATE TABLE payments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(26)     NOT NULL,
  receipt_type      ENUM('regular','opening_balance') NOT NULL DEFAULT 'regular',
  receipt_no        VARCHAR(40)  NOT NULL,
  academic_year_id  BIGINT UNSIGNED NOT NULL,     -- year in which the money was received
  student_id        BIGINT UNSIGNED NOT NULL,
  payment_date      DATE NOT NULL,
  total_amount      DECIMAL(12,2) NOT NULL,
  method            ENUM('cash','upi','cheque','bank_transfer','card') NOT NULL,
  reference_no      VARCHAR(100) NULL,
  remarks           VARCHAR(255) NULL,
  collected_by      BIGINT UNSIGNED NOT NULL,
  status            ENUM('valid','void') NOT NULL DEFAULT 'valid',
  void_reason       VARCHAR(255) NULL,
  voided_by         BIGINT UNSIGNED NULL,
  voided_at         DATETIME(3)  NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pay_public (public_id),
  UNIQUE KEY uq_pay_receipt (receipt_type, receipt_no),
  KEY ix_pay_student (student_id, payment_date),
  KEY ix_pay_date (payment_date, status),
  KEY ix_pay_collector (collected_by, payment_date),
  CONSTRAINT fk_pay_ay        FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_pay_student   FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_pay_collector FOREIGN KEY (collected_by) REFERENCES users(id),
  CONSTRAINT fk_pay_voider    FOREIGN KEY (voided_by) REFERENCES users(id),
  CONSTRAINT chk_pay_amount   CHECK (total_amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- How each payment was split across fee items (may point to a previous year's items, rule F30)
CREATE TABLE payment_allocations (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id   BIGINT UNSIGNED NOT NULL,
  fee_item_id  BIGINT UNSIGNED NOT NULL,
  amount       DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alloc (payment_id, fee_item_id),
  KEY ix_alloc_item (fee_item_id),
  CONSTRAINT fk_alloc_pay  FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_alloc_item FOREIGN KEY (fee_item_id) REFERENCES fee_items(id),
  CONSTRAINT chk_alloc_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

### 22.1 Fee Logic (Service Layer)

**Creating a student's fee account for a year**

```text
1. plan        = student's chosen plan OR academic_year_fee_settings.default_fee_plan_id
2. tuition     = class_tuition_fees(year, student's class)
3. bus         = route_fees(year, route) if a route is assigned, else 0
4. insert student_fee_accounts
5. split net tuition (Section 9.4) and insert one fee_item per installment
   with label and due_date from plan_installments
6. insert one 'bus' fee_item if bus > 0 (amount = bus_gross - bus_discount)
7. insert 'one_time' fee_items for every class_one_time_fees row of that class and year
```

**Changing plan or discount**

```text
Plan change     -> allowed only if today < academic_years.start_date      (F4)
Discount change -> allowed only if student_fee_accounts.has_payments = 0  (F10)
On allowed change -> delete and regenerate that account's tuition/bus fee_items in one transaction
```

**Recording a payment** (single database transaction)

```text
1. Lock the student's open fee_items: SELECT ... FOR UPDATE
2. For each fee category the staff entered an amount for:
     tuition  -> apply to tuition items with balance > 0,
                 ordered by academic year (oldest first), then installment_no   (F25, F31)
     bus      -> the selected year's bus item
     one_time -> the selected one-time item
     reject if amount > outstanding for that category                          (F27)
3. Get next receipt number: SELECT next_value FROM number_sequences
   WHERE seq_key='receipt' AND scope_key='2026-27' FOR UPDATE; then increment  (gapless)
4. INSERT payments, INSERT payment_allocations, UPDATE fee_items.paid_amount
5. SET has_payments = 1 on every student_fee_account touched                    (locks discounts)
6. Write audit_logs
7. COMMIT. Then the receipt PDF can be rendered on demand.
```

**Voiding a receipt**

```text
1. Lock payment and its fee_items
2. Reduce fee_items.paid_amount by each allocation amount
3. Mark payment status='void', reason, voided_by, voided_at (allocations kept for history)
4. Receipt number is NOT reused
5. Audit log
```

Note: `has_payments` stays 1 after a void. Unlocking discounts after a void needs an explicit Admin action (audited). This avoids "void, change discount, re-collect" being used to bypass rule F10.

---

## 23. Critical Test Cases

These run automatically in CI before every release.

### 23.1 Access and Identity

| # | Test |
|---|---|
| T1 | A teacher cannot see fees unless granted. |
| T2 | A teacher cannot see family phone/address when the field is hidden. |
| T3 | A subject teacher cannot enter or edit marks of another subject. |
| T4 | A class teacher can view all subjects of the assigned section only. |
| T5 | A family sees only its own children, through every endpoint, export and PDF. |
| T6 | A staff member in Parent workspace sees only own children, even with an Admin role. |
| T7 | A disabled user cannot log in and existing sessions stop working. |
| T8 | When all children are inactive, the family login is auto-disabled; reactivating a child re-enables it. |
| T9 | Inactive students do not appear in lists, search or attendance sheets. |
| T10 | Institution Admin cannot change feature flags or developer settings. |
| T11 | Disabled module endpoints return `FEATURE_DISABLED`. |
| T12 | Duplicate email or mobile is rejected across all users. |
| T13 | Temporary password forces change on first login. |
| T14 | Staff forgot-password works by email; family self-reset works only if email exists. |

### 23.2 Fees

| # | Test |
|---|---|
| T20 | Net 27,000 Quarterly → 6,900 / 6,700 / 6,700 / 6,700. |
| T21 | Net 25,000 Quarterly → 6,400 / 6,200 / 6,200 / 6,200. Sum always equals net. |
| T22 | Tuition payment clears the oldest installment first, across years. |
| T23 | Payment above a fee's balance is rejected. |
| T24 | Plan change after year start date is rejected. |
| T25 | Discount change after any payment is rejected. |
| T26 | Previous year due paid in the current year is allocated to the old year's items. |
| T27 | Receipt numbers are gapless under concurrent collections (load test). |
| T28 | Voiding restores balances and keeps the receipt number. |
| T29 | A student joining a class mid-year receives existing one-time fees for that class. |
| T30 | Inactive students' payments still appear in collection reports. |
| T31 | Receipt PDF is generated on request and no file is written to storage. |

---

## 24. Open Items

| # | Item | Needed by |
|---|---|---|
| O1 | Report card layout and exact Telangana FA/SA weightage and grade scale (brainstorm session) | Before R4 |
| O2 | Hosting provider and domain for the first school | Before R1 go-live |
| O3 | SMTP account for the first school (or platform SMTP) | Before R1 go-live |
| O4 | Receipt number prefix and format confirmation (default `RCPT/2026-27/00001`) | Before R2 |
| O5 | Sample Excel data from the first school (students, staff, fees paid so far, attendance) | R1 / R2 imports |
| O6 | Default due dates for Half-yearly and Quarterly installments | Before R2 |
| O7 | WhatsApp Business API, SMS (DLT), online payment gateway, Telugu | R8 |
| O8 | College mode details (courses, semesters, fee structure differences) | Before first college customer |

---

*End of document.*
