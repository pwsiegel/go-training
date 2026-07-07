import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { deleteGame, gameOutcome, listGames } from '../data/games';
import { deleteReviewsForGame } from '../data/reviews';
import { listStudents } from '../data/links';
import { foxAvailable, listFoxAccounts } from '../data/fox';
import type { FoxAccountDoc, GameDoc, UserDoc } from '../data/model';
import { movesFromSgf, sgfInfo } from '../sgf';
import { replay } from '../goRules';
import { Board } from '../Board';
import { Spinner } from '../Spinner';
import { FilterChips } from '../FilterChips';
import { ManagePlayersModal } from './ManagePlayersModal';
import './Review.css';

const LOCAL_AI = 'local-ai';
const PAGE_SIZE = 32;
const dedupeById = (gs: GameDoc[]) => Array.from(new Map(gs.map((g) => [g.id, g])).values());
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
 * game was shorter) plus players, date, moves, and result. A missing `onDelete`
 * (e.g. a student's shared game) renders the card without the delete control.
 * `outcome` (win/loss for one of the viewer's own accounts) tints the border
 * and result. */
function GameCard({ game, outcome, onOpen, onDelete }: {
  game: GameDoc;
  outcome: 'win' | 'loss' | null;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const moves = useMemo(() => movesFromSgf(game.sgf), [game.sgf]);
  const stones = useMemo(() => replay(moves.slice(0, 30)).stones, [moves]);
  const info = sgfInfo(game.sgf);
  return (
    <div
      className={`game-card${outcome ? ` game-card--${outcome}` : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      {onDelete && (
        <button
          type="button"
          className="game-card-del"
          aria-label="Delete game"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          ×
        </button>
      )}
      <div className="game-card-board">
        <Board stones={stones} displayOnly thumbnail />
      </div>
      <div className="game-card-meta">
        <div className="game-card-players">
          {info.playerBlack} <span className="review-rank">[{info.rankBlack}]</span>{' '}vs{' '}
          {info.playerWhite} <span className="review-rank">[{info.rankWhite}]</span>
        </div>
        <div className="game-card-sub">
          {shortDate(game.createdAt)} · {moves.length} moves ·{' '}
          <span className={outcome ? `game-result game-result--${outcome}` : undefined}>
            {resultLabel(game)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Game review browser. In student view it's your own games, filtered by your
 * Fox accounts + vs-KataGo, and deletable. In teacher view it's your students'
 * shared games only — one read-only "shared by <student>" filter each. */
export function Review({ teacherMode = false }: { teacherMode?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameDoc[] | null>(null);
  const [accounts, setAccounts] = useState<FoxAccountDoc[]>([]);
  // Fox uids of accounts the viewer owns — their own accounts (student view),
  // or, in teacher view, the "my account" accounts of every linked student.
  const [myUids, setMyUids] = useState<Set<number>>(new Set());
  const [students, setStudents] = useState<UserDoc[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [foxOk, setFoxOk] = useState(false);
  const [managing, setManaging] = useState(false);
  const [page, setPage] = useState(0);
  const [prevSelected, setPrevSelected] = useState(selected);

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    let active = true;
    if (teacherMode) {
      listStudents(uid)
        .then(async (ss) => {
          const [gameLists, accountLists] = await Promise.all([
            Promise.all(ss.map((s) => listGames(s.uid).catch(() => []))),
            Promise.all(ss.map((s) => listFoxAccounts(s.uid).catch(() => []))),
          ]);
          if (!active) return;
          setStudents(ss);
          setAccounts([]);
          setGames(dedupeById(gameLists.flat()));
          setMyUids(new Set(accountLists.flat().filter((a) => a.isMine).map((a) => a.uid)));
          setSelected(new Set(ss.map((s) => `student:${s.uid}`)));
        })
        .catch(() => { if (active) setGames([]); });
    } else {
      Promise.all([listGames(uid), listFoxAccounts(uid)])
        .then(([own, a]) => {
          if (!active) return;
          setStudents([]);
          setAccounts(a);
          setGames(own);
          setMyUids(new Set(a.filter((x) => x.isMine).map((x) => x.uid)));
          setSelected(new Set([LOCAL_AI, ...a.map((x) => String(x.uid))]));
        })
        .catch(() => { if (active) setGames([]); });
      foxAvailable().then((ok) => { if (active) setFoxOk(ok); });
    }
    return () => { active = false; };
  }, [user, teacherMode]);

  const hasLocalAi = useMemo(() => !!games?.some((g) => g.source === 'go-training'), [games]);

  // Student view: your Fox accounts + vs-KataGo. Teacher view: one read-only
  // "shared by <student>" chip per linked student.
  const chips = useMemo(() => {
    if (teacherMode) return students.map((s) => ({ key: `student:${s.uid}`, label: `shared by ${s.displayName}` }));
    const list = accounts.map((a) => ({ key: String(a.uid), label: a.username }));
    if (hasLocalAi) list.push({ key: LOCAL_AI, label: 'vs KataGo' });
    return list;
  }, [teacherMode, students, accounts, hasLocalAi]);

  const visible = useMemo(() => {
    if (!games) return [];
    return games
      .filter((g) => {
        if (teacherMode) return selected.has(`student:${g.ownerUid}`);
        if (g.source === 'go-training') return selected.has(LOCAL_AI);
        return (g.blackUid != null && selected.has(String(g.blackUid)))
          || (g.whiteUid != null && selected.has(String(g.whiteUid)));
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [games, selected, teacherMode]);

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

  // Reload after a Manage-players change (student view only); auto-select any
  // newly-added player.
  const reload = async () => {
    if (!user) return;
    const [own, a] = await Promise.all([listGames(user.uid), listFoxAccounts(user.uid)]);
    setGames(own);
    setAccounts(a);
    setMyUids(new Set(a.filter((x) => x.isMine).map((x) => x.uid)));
    setSelected((s) => new Set([...s, ...a.map((x) => String(x.uid))]));
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this game?')) return;
    await deleteGame(id);
    if (user) await deleteReviewsForGame(user.uid, id);
    setGames((gs) => (gs ? gs.filter((g) => g.id !== id) : gs));
  };

  if (games === null) return <div className="center-screen"><Spinner /></div>;

  const emptyMessage = teacherMode
    ? (students.length === 0 ? 'No linked students yet.' : 'No games shared by the selected students.')
    : (accounts.length === 0 && !hasLocalAi
        ? (foxOk ? 'Add a player with “Manage players” to import games.' : 'No games yet.')
        : 'No games match the selected filters.');

  return (
    <div className="review">
      <div className="review-head">
        <h1>{teacherMode ? 'Shared games' : 'Games'}</h1>
        {!teacherMode && foxOk && (
          <button type="button" className="review-manage" onClick={() => setManaging(true)}>
            Manage players
          </button>
        )}
      </div>

      <FilterChips chips={chips} selected={selected} onToggle={toggle} label="Filter games" />

      {visible.length === 0 ? (
        <p className="review-empty">{emptyMessage}</p>
      ) : (
        <>
        <div className="review-grid">
          {paged.map((g) => (
            <GameCard
              key={g.id}
              game={g}
              outcome={gameOutcome(g, myUids)}
              onOpen={() => navigate(`/review/${g.id}`)}
              onDelete={teacherMode ? undefined : () => remove(g.id)}
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
