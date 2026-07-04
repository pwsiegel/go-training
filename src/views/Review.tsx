import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { deleteGame, listGames } from '../data/games';
import { foxAvailable, listFoxAccounts, onboardFoxAccount, syncFoxAccount } from '../data/fox';
import type { FoxAccountDoc, GameDoc } from '../data/model';
import { KATAGO_ENABLED } from '../data/katago';
import { movesFromSgf, sgfInfo } from '../sgf';
import { Spinner } from '../Spinner';
import './Review.css';

const LOCAL_AI = 'local-ai';
const scoreLabel = (lead: number) => `${lead >= 0 ? 'B' : 'W'}+${Math.abs(lead).toFixed(1)}`;
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Game result: from the SGF (imported games) or the KataGo score estimate. */
function resultLabel(g: GameDoc): string {
  const re = sgfInfo(g.sgf).result;
  if (re) return re;
  if (g.finalScore != null) return scoreLabel(g.finalScore);
  return '—';
}

export function Review() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameDoc[] | null>(null);
  const [accounts, setAccounts] = useState<FoxAccountDoc[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [foxOk, setFoxOk] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState('');       // action label while running; '' = idle
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([listGames(user.uid), listFoxAccounts(user.uid)])
      .then(([g, a]) => {
        if (!active) return;
        setGames(g);
        setAccounts(a);
        setSelected(new Set([LOCAL_AI, ...a.map((x) => String(x.uid))]));
      })
      .catch(() => { if (active) setGames([]); });
    foxAvailable().then((ok) => { if (active) setFoxOk(ok); });
    return () => { active = false; };
  }, [user]);

  const hasLocalAi = useMemo(() => !!games?.some((g) => g.source === 'go-training'), [games]);

  // Filter chips: one per tracked Fox account, plus Local AI where KataGo runs.
  const chips = useMemo(() => {
    const list = accounts.map((a) => ({ key: String(a.uid), label: a.username }));
    if (KATAGO_ENABLED && hasLocalAi) list.push({ key: LOCAL_AI, label: 'Local AI' });
    return list;
  }, [accounts, hasLocalAi]);

  const visible = useMemo(() => {
    if (!games) return [];
    return games
      .filter((g) => {
        if (g.source === 'go-training') return KATAGO_ENABLED && selected.has(LOCAL_AI);
        return (g.blackUid != null && selected.has(String(g.blackUid)))
          || (g.whiteUid != null && selected.has(String(g.whiteUid)));
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [games, selected]);

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const reload = async () => {
    if (!user) return;
    const [g, a] = await Promise.all([listGames(user.uid), listFoxAccounts(user.uid)]);
    setGames(g);
    setAccounts(a);
  };

  const addAccount = async () => {
    const name = newName.trim();
    if (!user || !name || busy) return;
    setBusy(`Adding ${name}…`); setStatus(''); setError('');
    try {
      const acct = await onboardFoxAccount(user.uid, name);
      setNewName('');
      await reload();
      setSelected((s) => new Set(s).add(String(acct.uid)));
      setStatus(`Added ${acct.username}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add account');
    } finally { setBusy(''); }
  };

  const syncAll = async () => {
    if (!user || busy || accounts.length === 0) return;
    setBusy('Syncing…'); setStatus(''); setError('');
    try {
      let added = 0;
      for (const a of accounts) added += await syncFoxAccount(user.uid, a);
      await reload();
      setStatus(`Synced ${added} new game${added === 1 ? '' : 's'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally { setBusy(''); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this game?')) return;
    await deleteGame(id);
    setGames((gs) => (gs ? gs.filter((g) => g.id !== id) : gs));
  };

  if (games === null) return <div className="center-screen"><Spinner /></div>;

  return (
    <div className="review">
      <h1>Games</h1>

      {foxOk && (
        <div className="review-sync">
          <input
            className="review-add"
            placeholder="Fox username"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addAccount(); }}
            disabled={!!busy}
          />
          <button type="button" onClick={addAccount} disabled={!!busy || !newName.trim()}>
            Add account
          </button>
          <button type="button" onClick={syncAll} disabled={!!busy || accounts.length === 0}>
            {busy === 'Syncing…' ? 'Syncing…' : 'Sync'}
          </button>
          {busy && <span className="review-status">{busy}</span>}
          {!busy && status && <span className="review-status">{status}</span>}
          {!busy && error && <span className="review-error">{error}</span>}
        </div>
      )}

      {chips.length > 0 && (
        <div className="review-filter" role="group" aria-label="Filter by account">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              className={selected.has(c.key) ? 'review-chip active' : 'review-chip'}
              aria-pressed={selected.has(c.key)}
              onClick={() => toggle(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="review-empty">
          {accounts.length === 0 && !hasLocalAi
            ? (foxOk ? 'Add a Fox account above to import games.' : 'No games yet.')
            : 'No games match the selected accounts.'}
        </p>
      ) : (
        <table className="review-table">
          <thead>
            <tr>
              <th>Black</th>
              <th>White</th>
              <th>Date</th>
              <th className="num">Moves</th>
              <th className="num">Result</th>
              <th aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {visible.map((g) => {
              const info = sgfInfo(g.sgf);
              return (
                <tr key={g.id} className="review-row" onClick={() => navigate(`/review/${g.id}`)}>
                  <td>{info.playerBlack} <span className="review-rank">[{info.rankBlack}]</span></td>
                  <td>{info.playerWhite} <span className="review-rank">[{info.rankWhite}]</span></td>
                  <td className="review-muted">{shortDate(g.createdAt)}</td>
                  <td className="num">{movesFromSgf(g.sgf).length}</td>
                  <td className="num">{resultLabel(g)}</td>
                  <td className="review-del-cell">
                    <button
                      type="button"
                      className="review-del"
                      onClick={(e) => { e.stopPropagation(); remove(g.id); }}
                      aria-label="Delete game"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
