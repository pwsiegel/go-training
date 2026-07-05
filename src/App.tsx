import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, NavLink, useLocation, type Location } from 'react-router-dom';
import { useAuth } from './auth';
import { BatchProvider } from './batch';
import { Spinner } from './Spinner';
import { ThemeToggle } from './ThemeToggle';
import { ProblemModalShell } from './ProblemModal';
import { BatchDrawer } from './BatchDrawer';
import { listStudents } from './data/links';
import { Login } from './views/Login';
import './Sidebar.css';
import { Home } from './views/Home';
import { Library } from './views/Library';
import { CollectionView } from './views/Collection';
import { Solve } from './views/Solve';
import { Submissions } from './views/Submissions';
import { SubmissionDetail } from './views/SubmissionDetail';
import { History } from './views/History';
import { Teacher } from './views/Teacher';
import { ProfileModal } from './views/Profile';
import { Play } from './views/Play';
import { Review } from './views/Review';
import { GameReview } from './views/GameReview';

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'sidebar-link active' : 'sidebar-link';
}

function subNavClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'sidebar-link sidebar-sublink active' : 'sidebar-link sidebar-sublink';
}

/** `/` lands teachers on the teacher view by default. The "Student view" swap
 * passes `fromTeacher` so it can reach the student Home without bouncing back. */
function RootRoute() {
  const { profile } = useAuth();
  const location = useLocation();
  const fromTeacher = (location.state as { fromTeacher?: boolean } | null)?.fromTeacher;
  if (profile?.role === 'teacher' && !fromTeacher) return <Navigate to="/teacher" replace />;
  return <Home />;
}

function Sidebar() {
  const { user, profile, signOutUser } = useAuth();
  const { pathname } = useLocation();
  const isTeacher = pathname.startsWith('/teacher');
  const [canTeach, setCanTeach] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  useEffect(() => {
    if (user) listStudents(user.uid).then((s) => setCanTeach(s.length > 0)).catch(() => {});
  }, [user]);
  return (
    <aside className="sidebar">
      <Link to={isTeacher ? '/teacher' : '/'} className="sidebar-brand">tsumego</Link>
      <nav className="sidebar-links" aria-label="Primary">
        {isTeacher ? (
          <NavLink to="/teacher" end className={navClass}>Students</NavLink>
        ) : (
          <>
            <NavLink to="/" end className={navClass}>Home</NavLink>
            <div className="sidebar-group">
              <span className="sidebar-group-label">Tsumego</span>
              <NavLink to="/library" className={subNavClass}>Library</NavLink>
              <NavLink to="/submissions" end className={subNavClass}>Submissions</NavLink>
              <NavLink to="/history" className={subNavClass}>History</NavLink>
            </div>
            <NavLink to="/play" className={navClass}>Play AI</NavLink>
            <NavLink to="/review" className={navClass}>Review</NavLink>
          </>
        )}
      </nav>
      <div className="sidebar-foot">
        {profile?.displayName && (
          <button type="button" className="sidebar-name" onClick={() => setShowProfile(true)}>
            {profile.displayName}
          </button>
        )}
        {canTeach && (
          <Link to={isTeacher ? '/' : '/teacher'} state={isTeacher ? { fromTeacher: true } : undefined} className="sidebar-btn">
            {isTeacher ? 'Student view' : 'Teacher view'}
          </Link>
        )}
        <button type="button" className="sidebar-btn" onClick={signOutUser}>Sign out</button>
        <ThemeToggle />
      </div>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </aside>
  );
}

export default function App() {
  const { user, profile, loading, signOutUser } = useAuth();
  const location = useLocation();
  const backgroundLocation = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation;

  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!user) return <Login />;
  if (!profile) {
    return (
      <div className="center-screen">
        <p>Signed in as {user.email}, but this account isn’t authorized.</p>
        <button onClick={signOutUser}>Sign out</button>
      </div>
    );
  }

  // The batch drawer ("current submission") belongs to the tsumego workflow only.
  const effectivePath = (backgroundLocation ?? location).pathname;
  const showBatch = /^\/(library|submissions|history|solve)(\/|$)/.test(effectivePath);

  return (
    <BatchProvider>
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">
          <Routes location={backgroundLocation ?? location}>
            <Route path="/" element={<RootRoute />} />
            <Route path="/library" element={<Library />} />
            <Route path="/library/:slug" element={<CollectionView />} />
            <Route path="/solve/:slug/:id" element={<Solve />} />
            <Route path="/submissions" element={<Submissions />} />
            <Route path="/submissions/:id" element={<SubmissionDetail />} />
            <Route path="/history" element={<History />} />
            <Route path="/play" element={<Play />} />
            <Route path="/review" element={<Review />} />
            <Route path="/review/:id" element={<GameReview />} />
            <Route path="/teacher" element={<Teacher />} />
            <Route path="/teacher/:studentUid" element={<Teacher />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {backgroundLocation && (
            <Routes>
              <Route path="/solve/:slug/:id" element={<ProblemModalShell><Solve /></ProblemModalShell>} />
            </Routes>
          )}
        </main>
        {showBatch && <BatchDrawer />}
      </div>
    </BatchProvider>
  );
}
