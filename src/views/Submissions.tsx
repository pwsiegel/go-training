import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { loadStudentData, type StudentData, type SubmissionView } from '../data/study';
import { listTeachers } from '../data/links';
import { ToSubmitSection } from '../ToSubmitSection';
import type { UserDoc } from '../data/model';
import '../Submissions.css';

const SENT_PER_PAGE = 12;

export function Submissions() {
  const { user } = useAuth();
  const uid = user!.uid;
  const [data, setData] = useState<StudentData | null>(null);
  const [teachers, setTeachers] = useState<UserDoc[] | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    loadStudentData(uid).then(setData);
    listTeachers(uid).then(setTeachers);
  }, [uid]);

  const teacherName = (tuid: string) => teachers?.find((t) => t.uid === tuid)?.displayName ?? 'teacher';

  if (data === null) return <div className="submissions"><Spinner /></div>;

  const subs = data.submissions;
  const pageCount = Math.max(1, Math.ceil(subs.length / SENT_PER_PAGE));
  const p = Math.min(page, pageCount - 1);
  const visible = subs.slice(p * SENT_PER_PAGE, (p + 1) * SENT_PER_PAGE);

  return (
    <div className="submissions">
      <h1>Submissions</h1>

      <ToSubmitSection />

      <section className="home-section">
        <div className="section-heading"><h2>Sent</h2></div>
        <div className="section-body">
          {subs.length === 0
            ? <p className="dim">Nothing in flight. Save problems from the solver to send them.</p>
            : <>
                <ul className="submissions-list">
                  {visible.map((s) => <SentRow key={s.submission.id} view={s} teacherName={teacherName} />)}
                </ul>
                {pageCount > 1 && (
                  <div className="pager">
                    <button onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0}>‹ Prev</button>
                    <span className="muted">Page {p + 1} of {pageCount}</span>
                    <button onClick={() => setPage(Math.min(pageCount - 1, p + 1))} disabled={p >= pageCount - 1}>Next ›</button>
                  </div>
                )}
              </>}
        </div>
      </section>
    </div>
  );
}

function SentRow({ view, teacherName }: { view: SubmissionView; teacherName: (uid: string) => string }) {
  const total = view.items.length;
  const reviewed = view.items.filter((it) => it.verdict).length;
  const label = view.state === 'pending' ? 'Pending review' : view.state === 'returned' ? 'Ready to view' : 'Read';
  return (
    <li>
      <Link to={`/submissions/${view.submission.id}`} className="submissions-row-link">
        <div className="submissions-row-main">
          <span className={`submissions-state state-${view.state}`}>{label}</span>
          <span className="submissions-row-teacher">{teacherName(view.submission.teacherUid)}</span>
          <span className="submissions-row-when">submitted {new Date(view.submission.sentAt).toLocaleString()}</span>
        </div>
        <div className="submissions-row-meta">
          {view.state === 'pending' ? `${reviewed} of ${total} reviewed` : `${total} problem${total === 1 ? '' : 's'}`}
        </div>
      </Link>
    </li>
  );
}
