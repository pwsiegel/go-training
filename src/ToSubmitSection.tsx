import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { useBatch } from './batch';
import { ProblemCard } from './ProblemCard';
import { toStones } from './stones';
import { removeFromBatch, sendBatch } from './data/study';
import { listTeachers } from './data/links';
import { problemIndex, type ProblemIndex } from './data/library';
import type { AttemptDoc, UserDoc } from './data/model';
import './Submissions.css';

/** The "To submit" outbox — shared by the Submissions page and Home. Backed by
 * the batch context so it updates live as problems are saved. */
export function ToSubmitSection() {
  const { user } = useAuth();
  const uid = user!.uid;
  const location = useLocation();
  const { batch, refresh } = useBatch();
  const [index, setIndex] = useState<ProblemIndex | null>(null);
  const [teachers, setTeachers] = useState<UserDoc[] | null>(null);
  const [picked, setPicked] = useState('');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => { problemIndex().then(setIndex); }, []);
  useEffect(() => {
    listTeachers(uid).then((ts) => { setTeachers(ts); setPicked((p) => p || ts[0]?.uid || ''); });
  }, [uid]);

  const teacherName = (tuid: string) => teachers?.find((t) => t.uid === tuid)?.displayName ?? 'teacher';
  const solveHref = (a: AttemptDoc) => {
    const problem = index?.byId.get(a.problemId);
    const slug = index?.slugByCollection.get(problem?.collection ?? a.collection);
    return slug ? `/solve/${slug}/${a.problemId}` : null;
  };
  const nav = batch
    .map((a) => {
      const slug = index?.slugByCollection.get(index?.byId.get(a.problemId)?.collection ?? a.collection);
      return slug ? { slug, id: a.problemId } : null;
    })
    .filter((n): n is { slug: string; id: string } => n !== null);

  // The next problem in the collection after the last drafted one — a "go to"
  // tile so you can keep solving the collection (collection-scoped nav, no batch nav).
  const goTo = useMemo(() => {
    if (!index || batch.length === 0) return null;
    const lastP = index.byId.get(batch[batch.length - 1].problemId);
    if (!lastP) return null;
    const slug = index.slugByCollection.get(lastP.collection);
    if (!slug) return null;
    const inColl = [...index.byId.values()]
      .filter((p) => p.collection === lastP.collection)
      .sort((a, b) => a.source_board_idx - b.source_board_idx);
    const i = inColl.findIndex((p) => p.id === lastP.id);
    const next = i >= 0 ? inColl[i + 1] : undefined;
    return next ? { slug, problem: next } : null;
  }, [index, batch]);

  const send = async () => {
    if (!picked || batch.length === 0) return;
    setSending(true);
    try {
      const n = batch.length;
      await sendBatch(uid, picked);
      refresh();
      setFlash(`Submitted ${n} problem${n === 1 ? '' : 's'} to ${teacherName(picked)}.`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="home-section">
      <div className="section-heading"><h2>To submit</h2></div>
      <div className="section-body">
        {batch.length === 0
          ? <p className="dim">No saved problems. Solve problems in the <Link to="/library">library</Link> and hit Save.</p>
          : (
            <div className="submissions-outbox">
              <div className="submissions-outbox-bar">
                <span />
                {teachers && teachers.length > 0 ? (
                  <div className="submissions-outbox-actions">
                    <label className="submissions-outbox-label">
                      Send to:{' '}
                      <select className="submissions-outbox-select" value={picked}
                        onChange={(e) => setPicked(e.target.value)} disabled={sending}>
                        {teachers.map((t) => <option key={t.uid} value={t.uid}>{t.displayName}</option>)}
                      </select>
                    </label>
                    <button type="button" className="submissions-submit-btn" onClick={send} disabled={sending || !picked}>
                      {sending ? 'Submitting…' : 'Submit'}
                    </button>
                  </div>
                ) : <p className="submissions-outbox-warn">Link a teacher in your profile before submitting.</p>}
              </div>
              {flash && <p className="submissions-flash">{flash}</p>}
              <ul className="problem-card-grid">
                {batch.map((a) => (
                  <OutboxTile key={a.id} attempt={a} index={index} href={solveHref(a)} nav={nav}
                    onRemove={() => removeFromBatch(uid, a.problemId).then(refresh)} />
                ))}
                {goTo && (
                  <li className="submissions-outbox-tile submissions-gotile">
                    <Link to={`/solve/${goTo.slug}/${goTo.problem.id}`} state={{ backgroundLocation: location }} className="submissions-gotile-link">
                      <span className="submissions-gotile-arrow">→</span>
                      <span className="submissions-gotile-label">Go to</span>
                      <span className="submissions-gotile-coll" title={goTo.problem.collection}>{goTo.problem.collection}</span>
                      <span className="submissions-gotile-num">#{goTo.problem.source_board_idx + 1}</span>
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          )}
      </div>
    </section>
  );
}

function OutboxTile({
  attempt, index, href, nav, onRemove,
}: {
  attempt: AttemptDoc; index: ProblemIndex | null; href: string | null;
  nav: { slug: string; id: string }[]; onRemove: () => void;
}) {
  const location = useLocation();
  const problem = index?.byId.get(attempt.problemId) ?? null;
  const card = (
    <ProblemCard
      stones={problem ? toStones(problem.stones) : []}
      moves={attempt.moves.map((m) => ({ x: m.col, y: m.row }))}
      collection={problem?.collection ?? attempt.collection}
      number={problem ? problem.source_board_idx + 1 : undefined}
    />
  );
  return (
    <li className="problem-card-cell">
      <button type="button" className="problem-card-remove" onClick={onRemove}
        aria-label="Remove from submission" title="Remove from submission">×</button>
      {href
        ? <Link to={href} state={{ backgroundLocation: location, nav }} className="problem-card-link">{card}</Link>
        : card}
    </li>
  );
}
