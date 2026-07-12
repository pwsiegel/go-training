import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { Spinner } from '../Spinner';
import {
  listPlayers, recentGames, searchGames,
  type GameFilter, type ProGame, type ProPlayer,
} from '../data/proGames';
import type { GameDoc } from '../data/model';
import './ProGames.css';

const MAX_SUGGESTIONS = 12;

/** A read-only GameDoc handed to GameReview via router state (its `previewGame`
 * path), so a pro game opens in the full review UI without living in `games/`. */
function toGameDoc(g: ProGame): GameDoc {
  return { id: g.id, ownerUid: '', source: 'gogod', createdAt: Date.parse(g.dateSort) || 0, sgf: g.sgf };
}

/** Browse the pro-game reference database (GoGoD): the 10 most recent games on
 * load, with search by player (autocomplete) and/or date range. Results are
 * paginated so no query returns an unbounded set. */
export function ProGames() {
  const navigate = useNavigate();
  const [players, setPlayers] = useState<ProPlayer[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);

  const [games, setGames] = useState<ProGame[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    recentGames(10)
      .then((g) => setGames(g))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { listPlayers().then(setPlayers).catch(() => {}); }, []);

  const suggestions = useMemo(() => {
    const q = nameInput.trim().toLowerCase();
    if (!q) return [];
    const starts: ProPlayer[] = [];
    const contains: ProPlayer[] = [];
    for (const p of players) {
      const n = p.name.toLowerCase();
      if (n.startsWith(q)) starts.push(p);
      else if (n.includes(q)) contains.push(p);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [nameInput, players]);

  /** Resolve the typed name to an exact known player, or report why not. */
  function resolvePlayer(): { player?: string; error?: string } {
    const name = nameInput.trim();
    if (!name) return {};
    const match = players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    return match ? { player: match.name } : { error: `No player named “${name}” — pick one from the list.` };
  }

  function toRecent() {
    setSearching(false);
    setCursor(null);
    setError(null);
    recentGames(10).then(setGames).catch((e) => setError(String(e)));
  }

  async function onSearch() {
    const { player, error: playerError } = resolvePlayer();
    if (playerError) { setError(playerError); return; }
    if (!player && !from && !to) { toRecent(); return; }
    setError(null);
    setLoading(true);
    try {
      const filter: GameFilter = { player, from: from || undefined, to: to || undefined };
      const page = await searchGames(filter);
      setGames(page.games);
      setCursor(page.cursor);
      setSearching(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    const { player } = resolvePlayer();
    const filter: GameFilter = { player, from: from || undefined, to: to || undefined };
    try {
      const page = await searchGames(filter, cursor);
      setGames((prev) => [...prev, ...page.games]);
      setCursor(page.cursor);
    } catch (e) {
      setError(String(e));
    }
  }

  function clearAll() {
    setNameInput('');
    setFrom('');
    setTo('');
    toRecent();
  }

  return (
    <div className="progames">
      <h1>Pro games</h1>

      <div className="progames-controls">
        <div className="progames-field progames-combobox">
          <label htmlFor="pg-player">Player</label>
          <input
            id="pg-player"
            type="text"
            placeholder="e.g. Cho Chikun"
            value={nameInput}
            autoComplete="off"
            onChange={(e) => { setNameInput(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
          />
          {showSuggest && suggestions.length > 0 && (
            <ul className="progames-suggestions">
              {suggestions.map((p) => (
                <li key={p.name}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setNameInput(p.name); setShowSuggest(false); }}
                  >
                    <span>{p.name}</span>
                    <span className="progames-count">{p.games}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="progames-field">
          <label htmlFor="pg-from">From</label>
          <input id="pg-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="progames-field">
          <label htmlFor="pg-to">To</label>
          <input id="pg-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="progames-actions">
          <button type="button" className="progames-search" onClick={onSearch}>Search</button>
          <button type="button" className="progames-clear" onClick={clearAll}>Clear</button>
        </div>
      </div>

      <p className="progames-caption">
        {searching ? `${games.length}${cursor ? '+' : ''} result${games.length === 1 ? '' : 's'}` : '10 most recent games'}
      </p>

      {error && <p className="progames-error">{error}</p>}

      {loading ? (
        <div className="progames-loading"><Spinner /></div>
      ) : (
        <table className="progames-table">
          <thead>
            <tr>
              <th>Date</th><th>Black</th><th>White</th><th>Event</th><th>Result</th><th>Moves</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr
                key={g.id}
                className="progames-row"
                onClick={() => navigate(`/review/${encodeURIComponent(g.id)}`,
                  { state: { game: toGameDoc(g), from: '/pro-games' } })}
              >
                <td className="progames-date">{g.dateDisplay || g.year || '—'}</td>
                <td>{g.black || '—'}{g.blackRank && <span className="progames-rank"> {g.blackRank}</span>}</td>
                <td>{g.white || '—'}{g.whiteRank && <span className="progames-rank"> {g.whiteRank}</span>}</td>
                <td className="progames-event">{[g.event, g.round].filter(Boolean).join(' · ') || '—'}</td>
                <td>{g.result || '—'}</td>
                <td className="progames-moves">{g.numMoves ?? '—'}</td>
              </tr>
            ))}
            {games.length === 0 && (
              <tr><td colSpan={6} className="progames-empty">No games found.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {searching && cursor && !loading && (
        <button type="button" className="progames-more" onClick={loadMore}>Load more</button>
      )}
    </div>
  );
}
