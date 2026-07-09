import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { listCollections } from '../data/library';
import { resumePoints, type ResumePoint } from '../data/study';
import { toStones } from '../stones';
import type { LibCollection } from '../data/model';
import '../Collection.css';

export function Library() {
  const { user } = useAuth();
  const location = useLocation();
  const [collections, setCollections] = useState<LibCollection[] | null>(null);
  const [resume, setResume] = useState<ResumePoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCollections().then(setCollections).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { resumePoints(user!.uid).then(setResume).catch(() => {}); }, [user]);

  if (error) return <div className="library"><p className="error">{error}</p></div>;
  if (collections === null) return <div className="library"><Spinner /></div>;

  return (
    <div className="library">
      <h1>Library</h1>

      {resume.length > 0 && (
        <section className="library-continue">
          <h2>Continue</h2>
          <ul className="continue-grid">
            {resume.map((r) => (
              <li key={r.slug}>
                <Link
                  to={`/solve/${r.slug}/${r.next.id}`}
                  state={{ backgroundLocation: location }}
                  className="continue-card"
                >
                  <div className="continue-card-board">
                    <ProblemCard stones={toStones(r.next.stones)} number={r.next.source_board_idx + 1} />
                  </div>
                  <div className="continue-card-body">
                    <span className="continue-card-name">{r.collection}</span>
                    <span className="continue-card-meta">
                      Resume at #{r.next.source_board_idx + 1} of {r.total}
                    </span>
                    <span className="continue-card-cta">Continue ›</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="library-all">
        {resume.length > 0 && <h2>All collections</h2>}
        <ul className="library-list">
          {collections.map((c) => (
            <li key={c.slug}>
              <Link to={`/library/${c.slug}`} className="library-row">
                <span className="library-row-name">{c.collection}</span>
                <span className="library-row-count">{c.count} problem{c.count === 1 ? '' : 's'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
