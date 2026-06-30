import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { loadStudentData, type StudentData } from '../data/study';
import { listTeachers } from '../data/links';
import { ToSubmitSection } from '../ToSubmitSection';
import type { UserDoc } from '../data/model';
import '../Submissions.css';

export function Home() {
  const { user, profile } = useAuth();
  const uid = user!.uid;
  const [data, setData] = useState<StudentData | null>(null);
  const [teachers, setTeachers] = useState<UserDoc[] | null>(null);

  useEffect(() => {
    loadStudentData(uid).then(setData);
    listTeachers(uid).then(setTeachers);
  }, [uid]);

  const teacherName = (tuid: string) => teachers?.find((t) => t.uid === tuid)?.displayName ?? 'teacher';
  // "Ready to view" = teacher has reviewed it and the student hasn't acked.
  const ready = (data?.submissions ?? []).filter((s) => s.state === 'returned');

  return (
    <div className="submissions">
      <h1>Welcome, {profile?.displayName}</h1>

      <ToSubmitSection />

      <section className="home-section">
        <div className="section-heading"><h2>Ready to view</h2></div>
        <div className="section-body">
          {data === null ? <Spinner /> : ready.length === 0
            ? <p className="dim">Nothing new — your teacher hasn’t returned a submission to read.</p>
            : <ul className="submissions-list">
                {ready.map((s) => (
                  <li key={s.submission.id}>
                    <Link to={`/submissions/${s.submission.id}`} className="submissions-row-link">
                      <div className="submissions-row-main">
                        <span className="submissions-state state-returned">Ready to view</span>
                        <span className="submissions-row-teacher">{teacherName(s.submission.teacherUid)}</span>
                        <span className="submissions-row-when">submitted {new Date(s.submission.sentAt).toLocaleString()}</span>
                      </div>
                      <div className="submissions-row-meta">{s.items.length} problem{s.items.length === 1 ? '' : 's'}</div>
                    </Link>
                  </li>
                ))}
              </ul>}
        </div>
      </section>
    </div>
  );
}
