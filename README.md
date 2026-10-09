# Education Management System

Single-institute School / College Management System. One installation serves one institution.
Requirements: `docs/requirements-v2.md` (rule IDs such as F10, L9 and T13 are referenced in code and tests).

## Status: Releases 1 to 5 (People, Fees, Attendance, Exams, Website), Teaching grid, Timetable, Year end and Dashboard

| Area | Done in this sprint |
|---|---|
| Database | MySQL 8 schema for R1 (34 tables) + migration runner with checksum protection |
| Auth | Email or mobile + password (L6), scrypt hashing, lockout after 5 failures, rotating refresh tokens with reuse detection, logout / logout everywhere, forced password change (L10), email reset (L7, L11) |
| Permissions | Module + action + scope engine, 15 default roles, field policies seeded, feature flags enforced in API and UI, developer-only console (S1) |
| Workspaces | Staff / Parent switch for staff whose children study here (L14 to L17) |
| Staff | Add, edit, roles, temporary password + WhatsApp message (L9), disable / enable (L5) |
| Academics | Academic years (one current), classes, sections, subjects (school classes seeded: Nursery to Class 10) |
| Settings | School details, brand colour (contrast-checked), SMTP |
| Audit | Log of every important action, kept 2 years |
| Admin app | React PWA, mobile bottom navigation + desktop sidebar, login, setup checklist, staff, academics, settings, developer console |
| Students | Student 360 (overview, parent, history), enrollment per academic year, automatic admission numbers, edit, class/section moves |
| Parents | One parent login per mobile number, sibling detection, parent edit, login details over WhatsApp, Staff/Parent link when a staff member's mobile matches |
| Active/inactive | Inactive students hidden from lists (ST2), searchable and reactivated by admin (ST3), parent login auto-disabled when no child is active and restored on reactivation (ST5) |
| Data scopes | Class teachers see their sections, subject teachers the sections they teach, parents their own children; field rules hide parent contact details from teachers (most permissive role wins) |
| Teaching | Class teacher and subject teacher assignment per section, subjects |
| Imports | Excel templates (with this school's classes and roles), row-by-row error report, all-or-nothing commit, parents + students and staff |
| Notices | Notices to everyone / staff / all parents / chosen classes or sections; class teachers draft for their own sections; publish creates alerts |
| Alerts | Notification centre with unread badge |
| Fee setup | Default plan per year (Yearly / Half-yearly / Quarterly), installment due dates, tuition per class, bus routes with yearly fee, one-time fees per class, concession types |
| Fee rules | Equal split in whole hundreds, first installment takes the remainder (F12 to F14); per-student fixed discounts; details lock after first payment (F10); plan lock (F4); previous-year dues paid into their own year (F29, F30) |
| Collection | Staff choose fees and amounts; tuition clears the oldest installment first; overpayment rejected; cash / UPI / cheque / bank / card with reference |
| Receipts | Gapless numbers per year (`RCPT/2026-27/00001`), A5 PDF generated on demand and never stored, ₹ and amount in words, balance frozen at payment time, share to WhatsApp from phone, void keeps the number |
| Reports | Today / month / outstanding / overdue, collection by method, dues per student with WhatsApp reminder, Excel exports |
| Opening balances | Excel import of plan, discounts and amounts paid before the app (separate `OPN/` receipts, not counted as collection) |
| Teaching grid | Per academic year: subjects of each class, class teacher and subject teacher of every section, on one screen for all classes; one teacher per section + subject; assigned fresh each year |
| Timetable | Bell schedules per class group (periods, breaks, lunch; same timings Mon to Sat); Saturdays-off setting; fill slots by subject, teacher comes from the grid; clashes blocked by clock time across groups, including when timings or the grid change; copy a day to all days; teacher "My week"; parent sees child's timetable |
| Public website | Home page of 11 sections (banner slider, welcome, principal, highlights, facilities, notices, events, gallery, videos, testimonials, admissions) that can be reordered, hidden and edited; About, Contact (form, address, map, WhatsApp), Privacy and custom pages; Events with photo albums and YouTube videos; header and footer menus; social links; school logo; contact form saved, emailed to the school and offered to the visitor as a WhatsApp message; page titles injected for search engines and link previews |
| Year end | Next year created as "planned" while the current year runs; fee setup copied exactly (dates moved forward) and bell schedules optionally copied; teachers assigned fresh; promotion per section with bulk actions (promote, keep in class with a required reason, leaving with TC, Class 10 completed), changeable until the switch; roll numbers alphabetical, by admission number or by hand; switch checklist; the switch closes the old year, records every student's fees for it, and makes leavers and completers inactive |
| Closed years | Read-only (classes, teachers, fee setup, discounts); unpaid fees stay collectible as "Previous year due"; only the Institution Admin can void a receipt that pays a closed year or give a waiver (reason required, latest unpaid installment first, Fee = Paid + Waived + Still due) |
| Attendance | Once a day by the class teacher (or any teacher of the section); everyone starts Present, tap absentees; works offline on the phone and sends automatically when back online; teachers can change up to 3 days back, admins any time; in-app alert to the parent for each absence and an office list with WhatsApp buttons; holidays and Saturdays off excluded; percentage = present days / marked working days (Late = present, Half day = half, Leave = not present); month report per section; Excel import per section and month |
| Leave | Parents apply for a child (up to 30 days back), the class teacher approves and those days become Leave; staff apply for themselves, the admin approves |
| Staff attendance | Self check-in on the phone only within the set distance of the school (time and distance recorded, no Late rule); admin can correct; month view for each staff member |
| Dashboard | Staff home with an academic-year filter: counts (students, boys and girls, staff, new admissions, parents, sections), attendance today and a Monday to Saturday chart (students and staff), fees collected against the total with today / month / due / overdue and a monthly chart, holidays and events in the next 30 days, student and staff birthdays in the next week (WhatsApp wishes), staff leave today and in the next two weeks; counts on the Go to tiles. Each part is shown only to people allowed to see it |
| Exams | FA1, FA2, SA1, FA3, FA4, SA2 per year (FA out of 20, SA out of 80), plus unit tests and pre-finals for tracking only; exam schedule per class and subject, shown to teachers, parents and on the dashboard |
| Marks | Subject teachers enter marks on the phone (AB for absent), submit; the principal approves or sends back, then publishes each section; parents are notified; corrections after publishing go through the principal and the parent is told |
| Results | Editable grade scales (Telangana primary A+ to C, high school A1 to E); per class: show marks, grades or both, final formula (per term, year-end, or weights), pass mark; rank in section and class (ties share) |
| Report cards | A4 PDF: student details and photo, every exam per subject, final and grade, ranks, co-scholastic grades, term attendance, class teacher's remarks, grade key, signatures; one student or a whole section; pre-primary skills report |
| Leaving students | Relieving checklist with TC and bonafide number and date; recording it makes the student inactive |
| Exports | Excel and PDF of every main list: students, staff, attendance month, absentees, leave, exam results, fee dues and fee collection (with totals), leaving students; same access rules and hidden fields as the screen |
| Fee reminder emails | Off by default; once a day after 9 am, one email per parent for fees due in N days and overdue fees (repeated every N days); never the same reminder twice; send one by hand from Fee dues |
| Search engines | `/robots.txt` and `/sitemap.xml` of published website pages, events and albums |
| Phones | Typing boxes use 16px text on touch screens so iPhone does not zoom in; pinch-zoom still allowed |
| HR records | Employment type, bank, IFSC, PAN, UAN, ESI number, emergency contact, last working day on each staff member's page; leave types with yearly allowances (Casual 12, Sick 6, Leave without pay) and balances that start fresh every academic year |
| Salaries | Pay items of your own (earnings, deductions, paid by the school), each a fixed amount, % of Basic or % of Gross, with an optional cap and "reduced for loss-of-pay"; salary templates copied to a person and edited; salary history with a start date |
| Payroll | Monthly draft for all active staff; the accountant types loss-of-pay days (attendance and unpaid leave are shown as a suggestion and can fill the column in one tap); one-off additions and deductions per payslip; finalise sends payslips to staff; mark as paid (records the salary expense); reopen with a reason; salary register and bank transfer list in Excel/PDF |
| Payslips | A4 PDF with earnings, deductions, net pay in words, employer PF, masked bank account; staff see their own under My payslips |
| Expenses | Spending register with categories, vouchers (`EXP/2026-27/00001`), method and reference, bill photo or PDF; approval rule chosen by the school (none, above a limit, or every expense); monthly totals and biggest categories; Excel/PDF |
| Transport | Vehicles with seats, driver (a staff member) and helper; a bus per route; stops in order with landmark, pickup and drop time; each bus student given a stop; parents see route, stop, times, bus, driver and helper phone on the child's page; drivers see "My bus" with their students and parents' phones; bus list in Excel/PDF |
| Fuel and service | Fuel fills (litres, odometer, km per litre) and services/repairs per vehicle; each entry is saved as a Transport & fuel expense under the school's approval rule; cancelling an entry cancels its expense |
| Stock | Items by category and unit, counted or not counted; opening stock, stock in (optionally saved as an expense), give out, count correction, undo a purchase; history with balance; low-stock alert in the app; Excel/PDF |
| Sales counter | Class book sets at one price and single items (books, uniform, ID card); paid at the counter; gapless receipt numbers per year (`SALE/2026-27/00001`) and A5 PDF; stock goes down by itself and cannot go below zero; cancelling keeps the number and puts stock back; daily totals by method; Excel/PDF |
| Security | Checked against a full checklist (see SECURITY.md): login signing key never an example value, example developer password must be changed, common passwords refused, HS256-only tokens, strict headers and CSP, CORS to the app's address only, rate limits, safe links, plain-text email subjects, production dependencies with 0 known vulnerabilities |
| Access & roles | Developer only: for every role (including Institution Admin and Principal) set each module to No access / View / View & edit, or each action with whose records it covers; create, copy, rename, switch off and delete roles; per-person exceptions (give or take away) on top of their roles; applies at once and is logged |
| Login as | Developer only: open the app as any staff member, parent, student or driver and do what they can do; their name goes on the action, the log records the developer; a bar shows whose login is in use with "Back to my login"; ends only when pressed |
| Activity log | Developer only: sign-ins, sign-outs and wrong passwords; every change with before and after; Excel/PDF and receipt, payslip and report card downloads; filters by India date, type, area, person and "done through Login as"; device and IP; Excel/PDF; kept 2 years, then deleted |
| Upgrades | New permissions added by a release are granted to the default roles on existing installations, without overwriting admin changes |
| Tests | 179 end-to-end tests, each test file on its own fresh database, passing on MySQL 8.0, MariaDB 10.11 and MariaDB 10.3 |
| Support | `npm run doctor` checks the whole setup; startup errors explain the fix; screens warn when an older copy of the server is answering |
| Deploy | Hostinger Node.js Web App (one app serves screens + API, creates its own tables on start); optional Docker files for a VPS |

**Next: the small gaps (exports of every list, fee due reminders by email, website sitemap), then Release 6, HR, payroll and expenses.** Promotion to the next academic year (ST7) and carrying fees into it are planned with the year-end work.

### Decisions made during Release 2
- **Plan lock (F4):** the plan is locked once the academic year has started, *except* for fee accounts created after the start (new admissions, or a school starting mid-year), which may change plan until their first payment.
- **Unlock after void:** voiding receipts does not unlock discounts. An admin can unlock once every receipt for the year is void (audited).
- **Accountants** can run imports (needed for opening balances).
- **Receipt PDFs** use the bundled DejaVu Sans font (for the ₹ sign) and PDFKit, so they work on Hostinger without a browser engine.

## Install

**New here or updating? Read START-HERE.md first.**

See **INSTALL.md** for step-by-step setup with **XAMPP** (local) and **Hostinger** (live).

Quick start (database `ems` already created):

```bash
cp .env.example .env     # Windows: copy .env.example .env
npm install
npm run dev              # website: http://localhost:5173/  app: http://localhost:5173/app  API: :3000/api/v1
```

Production build (what Hostinger runs): `npm run build` then `npm start`:
- School website: http://localhost:3000/
- Staff and parent app: http://localhost:3000/app (login at /app/login)

## Technical decisions (changes from the requirements document)

| Decision | Reason |
|---|---|
| **Kysely + mysql2 instead of Prisma** | Prisma needs engine binaries downloaded at install/runtime, which fails on locked-down servers. Kysely is pure TypeScript, typed from the live schema (`DATABASE_URL=mysql://root:@localhost:3306/ems npm run db:types -w @ems/api`), and our SQL files are the migrations. |
| **Plain SQL migrations** (`apps/api/migrations/NNNN_name.sql`) | Exact control over MySQL features we rely on (CHECK constraints, generated columns). Applied files are checksummed; editing an applied file is refused. Files run statement by statement with recorded progress, so a failed migration resumes at the failed statement after a fix (MySQL cannot roll back table changes). |
| **Email outbox + small in-process worker** | No Redis needed yet. BullMQ + Redis arrive in R2 for PDF rendering and imports. |
| **React Router instead of TanStack Router** | Simpler for this size of app; can be swapped later without API changes. |
| **npm workspaces** | npm comes with Node.js and is Hostinger's default. |
| **MySQL 8 and MariaDB both supported** | XAMPP ships MariaDB; Hostinger runs MySQL. Collation `utf8mb4_unicode_ci`, JSON read through `readJson()`. |
| **scrypt (built into Node) instead of Argon2** | No native module to compile on Windows or Hostinger. OWASP-equivalent low-memory parameters (16 MB per hash) suit shared hosting. |
| **PDFKit for receipts** | Pure JavaScript; no headless browser, which Hostinger cannot run. |
| **Website and app in one build, two downloads** | `/app/*` loads the staff/family app; every other path loads the public site. Each is downloaded separately, so visitors get a small, fast site. The server injects each public page's title and description for search engines. |
| **One process serves screens and API** | One Hostinger Web App, one domain, no CORS setup. |
| **Migrations + seed run on start** (`AUTO_MIGRATE`) | Hostinger has no deploy hook for database steps. |

## Conventions

- API responses: `{ success, data, meta? }`; errors: `{ success: false, code, message, details? }`.
- Database changes: new numbered file in `apps/api/migrations/`; SQL must work on MySQL 8 and MariaDB 10.4+.
- Every endpoint is protected by default; mark public ones with `@Public()`.
- Protect business endpoints with `@RequirePermission('module', 'action')`; this also enforces the module's feature flag.
- Header `X-Workspace: staff | parent | student` selects the active workspace; permissions are evaluated for that workspace only.
- Internal numeric IDs never leave the API for people records; use `public_id` (ULID).
- All datetimes are stored in UTC.
- Log important actions with `AuditService.log()`.
