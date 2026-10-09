import type React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import AppShell, { NAV } from './components/AppShell';
import { ForcedPasswordPage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from './pages/AuthPages';
import HomePage from './pages/HomePage';
import AcademicsPage from './pages/AcademicsPage';
import StaffPage from './pages/StaffPage';
import SettingsPage from './pages/SettingsPage';
import DeveloperPage from './pages/DeveloperPage';
import StudentsPage from './pages/StudentsPage';
import Student360Page from './pages/Student360Page';
import ImportsPage from './pages/ImportsPage';
import AnnouncementsPage from './pages/AnnouncementsPage';
import CollectPage from './pages/CollectPage';
import DuesPage from './pages/DuesPage';
import ReceiptsPage from './pages/ReceiptsPage';
import FeeSetupPage from './pages/FeeSetupPage';
import TeachingPage from './pages/TeachingPage';
import TimetablePage from './pages/TimetablePage';
import TimetableSetupPage from './pages/TimetableSetupPage';
import WebsitePage from './pages/WebsitePage';
import AttendancePage from './pages/AttendancePage';
import MarkAttendancePage from './pages/MarkAttendancePage';
import LeavePage from './pages/LeavePage';
import ExamsPage from './pages/ExamsPage';
import MarksPage, { MarkSheetPage } from './pages/MarksPage';
import PayrollPage from './pages/PayrollPage';
import TransportPage from './pages/TransportPage';
import StockPage from './pages/StockPage';
import SalesPage from './pages/SalesPage';
import { ActivityPage, LoginAsPage } from './pages/DeveloperToolsPage';
import AccessPage from './pages/AccessPage';
import HomeworkPage from './pages/HomeworkPage';
import EnquiriesPage from './pages/EnquiriesPage';
import ClassPhotosPage from './pages/ClassPhotosPage';
import HallTicketsPage from './pages/HallTicketsPage';
import ExpensesPage from './pages/ExpensesPage';
import MyPayslipsPage from './pages/MyPayslipsPage';
import LeavingStudentsPage from './pages/LeavingStudentsPage';
import YearEndPage, { PromoteSectionPage, RollsPage } from './pages/YearEndPage';
import { useParams } from 'react-router-dom';
import { AlertsPage, NotFoundPage, ProfilePage, SearchPage, TasksPage } from './pages/MiscPages';

const PAGES: Record<string, () => React.JSX.Element> = {
  '/academics': AcademicsPage, '/staff': StaffPage, '/settings': SettingsPage, '/developer': DeveloperPage,
  '/students': StudentsPage, '/imports': ImportsPage, '/announcements': AnnouncementsPage,
  '/teaching': TeachingPage, '/timetable': TimetablePage, '/website': WebsitePage, '/attendance': AttendancePage, '/exams': ExamsPage,
  '/fees/collect': CollectPage, '/fees/dues': DuesPage, '/fees/receipts': ReceiptsPage, '/fees/setup': FeeSetupPage,
  '/payroll': PayrollPage, '/expenses': ExpensesPage, '/payslips': MyPayslipsPage, '/transport': TransportPage, '/stock': StockPage, '/sales': SalesPage, '/login-as': LoginAsPage, '/access': AccessPage, '/activity': ActivityPage, '/homework': HomeworkPage, '/hall-tickets': HallTicketsPage, '/enquiries': EnquiriesPage,
};

export default function App() {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return <div className="grid min-h-dvh place-items-center text-ink-muted" aria-busy="true">Loading…</div>;
  }
  if (auth.status === 'anonymous') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (auth.me?.mustChangePassword) return <ForcedPasswordPage />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        {NAV.filter((n) => n.to in PAGES && n.show(auth)).map((n) => {
          const Page = PAGES[n.to];
          return <Route key={`${n.to}-${n.label}`} path={n.to} element={<Page />} />;
        })}
        {auth.me?.workspace === 'staff' && (auth.can('students.photo') || auth.can('students.edit')) && <Route path="/students/photos" element={<ClassPhotosPage />} />}
        {auth.can('students.view') && <Route path="/students/:id" element={<Student360Page />} />}
        {auth.can('timetable.manage') && <Route path="/timetable/setup" element={<TimetableSetupPage />} />}
        {yearEndAllowed(auth) && <><Route path="/year-end" element={<YearEndPage />} /><Route path="/year-end/section/:id" element={<SectionRoute />} /><Route path="/year-end/rolls" element={<RollsPage />} /></>}
        {auth.can('attendance.mark') && <Route path="/attendance/mark/:id" element={<MarkAttendancePage />} />}
        {auth.me?.workspace === 'staff' && <Route path="/leave" element={<LeavePage />} />}
        {auth.can('marks.view') && auth.me?.workspace === 'staff' && <><Route path="/marks" element={<MarksPage />} /><Route path="/marks/sheet" element={<MarkSheetPage />} /></>}
        {auth.me?.permissions['students.view'] === 'all' && auth.me?.workspace === 'staff' && <Route path="/students/leaving" element={<LeavingStudentsPage />} />}
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

function SectionRoute() { const { id } = useParams(); return <PromoteSectionPage key={id} sectionId={Number(id)} />; }
export const yearEndAllowed = (a: ReturnType<typeof useAuth>) => a.me?.workspace === 'staff' && (!!a.me?.user.isSuperAdmin || a.me?.permissions['roles.configure'] === 'all');
