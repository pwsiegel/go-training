import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { listGames, deleteGame } from '../data/games';
import type { GameDoc, GameSource } from '../data/model';
import { sgfInfo } from '../sgf';
import { Spinner } from '../Spinner';
import './Review.css';

const SOURCE_LABEL: Record<GameSource, string> = { 'go-training': 'Go Training' };
const scoreLabel = (lead: number) => `${lead >= 0 ? 'B' : 'W'}+${Math.abs(lead).toFixed(1)}`;
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function Review() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameDoc[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    listGames(user.uid).then((g) => { if (active) setGames(g); }).catch(() => { if (active) setGames([]); });
    return () => { active = false; };
  }, [user]);

  const remove = async (id: string) => {
    if (!window.confirm('Delete this game?')) return;
    await deleteGame(id);
    setGames((gs) => (gs ? gs.filter((g) => g.id !== id) : gs));
  };

  if (games === null) return <div className="center-screen"><Spinner /></div>;

  if (games.length === 0) {
    return (
      <div className="review">
        <h1>Games</h1>
        <p className="review-empty">
          No saved games yet. Play a game on the <Link to="/play">Play</Link> page and choose
          “Review this game” when you finish.
        </p>
      </div>
    );
  }

  const bySource: Partial<Record<GameSource, GameDoc[]>> = {};
  for (const g of games) (bySource[g.source] ??= []).push(g);
  const groups = Object.entries(bySource) as [GameSource, GameDoc[]][];

  return (
    <div className="review">
      <h1>Games</h1>
      {groups.map(([src, list]) => (
        <section key={src} className="review-group">
          <h2>{SOURCE_LABEL[src] ?? src}</h2>
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
              {list.map((g) => {
                const info = sgfInfo(g.sgf);
                return (
                  <tr key={g.id} className="review-row" onClick={() => navigate(`/review/${g.id}`)}>
                    <td>{info.playerBlack} <span className="review-rank">[{info.rankBlack}]</span></td>
                    <td>{info.playerWhite} <span className="review-rank">[{info.rankWhite}]</span></td>
                    <td className="review-muted">{shortDate(g.createdAt)}</td>
                    <td className="num">{g.moveCount}</td>
                    <td className="num">{g.finalScore !== null ? scoreLabel(g.finalScore) : '—'}</td>
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
        </section>
      ))}
    </div>
  );
}
