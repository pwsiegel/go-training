import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { Spinner } from '../Spinner';
import { ProblemCard } from '../ProblemCard';
import { listProblems } from '../data/library';
import { problemStatuses, type ProblemStatus } from '../data/study';
import { toStones } from '../stones';
import type { LibProblem } from '../data/model';
import '../Collection.css';

const PAGE_SIZE = 75;

export function CollectionView() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const location = useLocation();
  const [problems, setProblems] = useState<LibProblem[] | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ProblemStatus>>(new Map());
  const [page, setPage] = useState(0);

  const [prevSlug, setPrevSlug] = useState(slug);
  if (slug !== prevSlug) { setPrevSlug(slug); setPage(0); }

  useEffect(() => { if (slug) listProblems(slug).then(setProblems); }, [slug]);
  useEffect(() => { problemStatuses(user!.uid).then(setStatuses); }, [user]);

  const sorted = useMemo(
    () => (problems ? [...problems].sort((a, b) => a.source_board_idx - b.source_board_idx) : []),
    [problems],
  );

  if (problems === null) return <div className="picker"><Spinner /></div>;

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * PAGE_SIZE;
  const visible = sorted.slice(start, start + PAGE_SIZE);

  return (
    <div className="picker">
      <div className="picker-header">
        <h1>{problems[0]?.collection ?? slug}</h1>
        <p className="picker-meta">{sorted.length} problem{sorted.length === 1 ? '' : 's'}</p>
      </div>

      <ul className="problem-card-grid">
        {visible.map((p) => {
          const status = statuses.get(p.id);
          const verdict = status ? (status.lastVerdict ?? 'pending') : null;
          return (
            <li key={p.id}>
              <Link to={`/solve/${slug}/${p.id}`} state={{ backgroundLocation: location }} className="problem-card-link">
                <ProblemCard
                  stones={toStones(p.stones)}
                  collection={p.collection}
                  number={p.source_board_idx + 1}
                  verdict={verdict}
                />
              </Link>
            </li>
          );
        })}
      </ul>

      {pageCount > 1 && (
        <div className="picker-pager">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={clampedPage === 0}>‹ Prev</button>
          <span className="picker-pager-num">Page {clampedPage + 1} of {pageCount}</span>
          <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={clampedPage >= pageCount - 1}>Next ›</button>
        </div>
      )}
    </div>
  );
}
