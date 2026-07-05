import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { deleteGame, listGames } from '../data/games';
import { foxAvailable, listFoxAccounts } from '../data/fox';
import type { FoxAccountDoc, GameDoc } from '../data/model';
import { KATAGO_ENABLED } from '../data/katago';
import { movesFromSgf, sgfInfo } from '../sgf';
import { replay } from '../goRules';
import { Board } from '../Board';
import { Spinner } from '../Spinner';
import { ManagePlayersModal } from './ManagePlayersModal';
import './Review.css';

const LOCAL_AI = 'local-ai';
const PAGE_SIZE = 32;
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

/** One game as a card: the position at move 30 (or the final position if the
 * game was shorter) plus players, date, moves, and result. */
function GameCard({ game, onOpen, onDelete }: {
  game: GameDoc;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const moves = useMemo(() => movesFromSgf(game.sgf), [game.sgf]);
  const stones = useMemo(() => replay(moves.slice(0, 30)).stones, [moves]);
  const info = sgfInfo(game.sgf);
  return (
    <div
      className="game-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <button
        type="button"
        className="game-card-del"
        aria-label="Delete game"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
      >
        ×
      </button>
      <div className="game-card-board">
        <Board stones={stones} displayOnly thumbnail />
      </div>
      <div className="game-card-meta">
        <div className="game-card-players">
          {info.playerBlack} <span className="review-rank">[{info.rankBlack}]</span>{' '}vs{' '}
          {info.playerWhite} <span className="review-rank">[{info.rankWhite}]</span>
        </div>
        <div className="game-card-sub">
          {shortDate(game.createdAt)} · {moves.length} moves · {resultLabel(game)}
        </div>
      </div>
    </div>
  );
}

export function Review() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameDoc[] | null>(null);
  const [accounts, setAccounts] = useState<FoxAccountDoc[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [foxOk, setFoxOk] = useState(false);
  const [managing, setManaging] = useState(false);
  const [page, setPage] = useState(0);
  const [prevSelected, setPrevSelected] = useState(selected);

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

  // Reset to the first page when the filter changes (adjust state during render).
  if (prevSelected !== selected) {
    setPrevSelected(selected);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // Reload after a Manage-players change; auto-select any newly-added player.
  const reload = async () => {
    if (!user) return;
    const [g, a] = await Promise.all([listGames(user.uid), listFoxAccounts(user.uid)]);
    setGames(g);
    setAccounts(a);
    setSelected((s) => new Set([...s, ...a.map((x) => String(x.uid))]));
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this game?')) return;
    await deleteGame(id);
    setGames((gs) => (gs ? gs.filter((g) => g.id !== id) : gs));
  };

  if (games === null) return <div className="center-screen"><Spinner /></div>;

  return (
    <div className="review">
      <div className="review-head">
        <h1>Games</h1>
        {foxOk && (
          <button type="button" className="review-manage" onClick={() => setManaging(true)}>
            Manage players
          </button>
        )}
      </div>

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
            ? (foxOk ? 'Add a player with “Manage players” to import games.' : 'No games yet.')
            : 'No games match the selected accounts.'}
        </p>
      ) : (
        <>
        <div className="review-grid">
          {paged.map((g) => (
            <GameCard
              key={g.id}
              game={g}
              onOpen={() => navigate(`/review/${g.id}`)}
              onDelete={() => remove(g.id)}
            />
          ))}
        </div>
        {visible.length > PAGE_SIZE && (
          <div className="review-pager">
            <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage === 0}>
              ← Prev
            </button>
            <span className="review-muted">
              {safePage * PAGE_SIZE + 1}–{Math.min(visible.length, (safePage + 1) * PAGE_SIZE)} of {visible.length}
            </span>
            <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1}>
              Next →
            </button>
          </div>
        )}
        </>
      )}

      {managing && user && (
        <ManagePlayersModal
          ownerUid={user.uid}
          accounts={accounts}
          games={games}
          onClose={() => setManaging(false)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
