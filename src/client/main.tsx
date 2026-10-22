import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { AuthProvider, queryClient, useAuth, useMeta } from './lib/state.tsx';
import { Loading, ToastProvider } from './ui/ui.tsx';
import { Layout } from './layout/Layout.tsx';
import { Login } from './pages/Login.tsx';
import { PublicForm } from './pages/PublicForm.tsx';

const Dashboard = lazy(() => import('./pages/Dashboard.tsx'));
const Tasks = lazy(() => import('./pages/Tasks.tsx'));
const TaskTemplates = lazy(() => import('./pages/Tasks.tsx').then((m) => ({ default: m.TaskTemplates })));
const TaskArchive = lazy(() => import('./pages/Tasks.tsx').then((m) => ({ default: m.TaskArchive })));
const Portfolios = lazy(() => import('./pages/Projects.tsx').then((m) => ({ default: m.Portfolios })));
const ProjectTemplates = lazy(() => import('./pages/Projects.tsx').then((m) => ({ default: m.ProjectTemplates })));
const Crm = lazy(() => import('./pages/crm/Crm.tsx'));
const Projects = lazy(() => import('./pages/Projects.tsx'));
const ProjectPage = lazy(() => import('./pages/ProjectPage.tsx'));
const Finance = lazy(() => import('./pages/finance/Finance.tsx'));
const Team = lazy(() => import('./pages/Team.tsx'));
const Calendar = lazy(() => import('./pages/Calendar.tsx'));
const Messenger = lazy(() => import('./pages/Messenger.tsx'));
const Communications = lazy(() => import('./pages/Communications.tsx'));
const Mail = lazy(() => import('./pages/Mail.tsx'));
const Kb = lazy(() => import('./pages/Kb.tsx'));
const Files = lazy(() => import('./pages/Files.tsx'));
const Catalog = lazy(() => import('./pages/Catalog.tsx'));
const Lists = lazy(() => import('./pages/Lists.tsx'));
const Time = lazy(() => import('./pages/Time.tsx'));
const Bp = lazy(() => import('./pages/Bp.tsx'));
const Documents = lazy(() => import('./pages/Documents.tsx'));
const Notes = lazy(() => import('./pages/Notes.tsx'));
const Portal = lazy(() => import('./pages/Portal.tsx'));
const Settings = lazy(() => import('./pages/settings/Settings.tsx'));

function Guard() {
  const { user, loading } = useAuth();
  const { ready } = useMeta();
  if (loading) return <div className="flex h-full items-center justify-center"><Loading label="Запускаем Vela CRM…" /></div>;
  if (!user) return <Login />;
  if (!ready) return <div className="flex h-full items-center justify-center"><Loading label="Загружаем данные…" /></div>;
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="tasks/templates" element={<TaskTemplates />} />
          <Route path="tasks/archive" element={<TaskArchive />} />
          <Route path="tasks/:id" element={<Tasks />} />
          <Route path="crm/*" element={<Crm />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/portfolios" element={<Portfolios />} />
          <Route path="projects/templates" element={<ProjectTemplates />} />
          <Route path="projects/:id" element={<ProjectPage />} />
          <Route path="finance/*" element={<Finance />} />
          <Route path="team/*" element={<Team />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="messenger" element={<Messenger />} />
          <Route path="communications" element={<Communications />} />
          <Route path="mail" element={<Mail />} />
          <Route path="kb" element={<Kb />} />
          <Route path="kb/:id" element={<Kb />} />
          <Route path="files" element={<Files />} />
          <Route path="catalog" element={<Catalog />} />
          <Route path="lists" element={<Lists />} />
          <Route path="lists/:id" element={<Lists />} />
          <Route path="time" element={<Time />} />
          <Route path="bp" element={<Bp />} />
          <Route path="documents" element={<Documents />} />
          <Route path="notes" element={<Notes />} />
          <Route path="portal" element={<Portal />} />
          <Route path="settings/*" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <HashRouter>
            <Routes>
              <Route path="/f/:id" element={<PublicForm />} />
              <Route path="/*" element={<Guard />} />
            </Routes>
          </HashRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
