import { useMemo, useRef, useState } from 'react';
import { saveGame } from '../data/games';
import type { GameDoc } from '../data/model';
import { mainlineMovesFromSgf, sgfInfo, toSgf } from '../sgf';
import './UploadGameModal.css';

/** Paste (or pick a file of) SGF, adjust the metadata, save it as an
 * uploaded game for review. The metadata fields auto-populate from the SGF's
 * tags when present and stay blank when not; the stored SGF is regenerated as
 * a clean main line carrying the (possibly edited) metadata. */
export function UploadGameModal({ ownerUid, onClose, onSaved }: {
  ownerUid: string;
  onClose: () => void;
  onSaved: (game: GameDoc) => void;
}) {
  const [sgfText, setSgfText] = useState('');
  const [name, setName] = useState('');
  const [playerBlack, setPlayerBlack] = useState('');
  const [rankBlack, setRankBlack] = useState('');
  const [playerWhite, setPlayerWhite] = useState('');
  const [rankWhite, setRankWhite] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    if (!sgfText.trim()) return null;
    return { info: sgfInfo(sgfText), moves: mainlineMovesFromSgf(sgfText) };
  }, [sgfText]);

  const applySgf = (text: string) => {
    setSgfText(text);
    setError('');
    if (!text.trim()) return;
    const info = sgfInfo(text);
    setName(info.name);
    setPlayerBlack(info.playerBlack);
    setRankBlack(info.rankBlack);
    setPlayerWhite(info.playerWhite);
    setRankWhite(info.rankWhite);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    applySgf(await file.text());
  };

  const problem = !parsed ? null
    : parsed.moves.length === 0 ? 'No moves found — is this an SGF game record?'
      : parsed.info.hasSetup ? 'SGFs with setup stones (handicap placements, problems) aren’t supported yet.'
        : parsed.info.boardSize != null && parsed.info.boardSize !== 19 ? `Only 19×19 games are supported (this is ${parsed.info.boardSize}×${parsed.info.boardSize}).`
          : null;

  const save = async () => {
    if (!parsed || problem) return;
    setSaving(true);
    setError('');
    try {
      const { info, moves } = parsed;
      const sgf = toSgf(moves, {
        komi: info.komi ?? 7.5,
        rules: info.rules || 'Chinese',
        name: name.trim(),
        playerBlack: playerBlack.trim(),
        playerWhite: playerWhite.trim(),
        rankBlack: rankBlack.trim(),
        rankWhite: rankWhite.trim(),
        date: info.date,
        result: info.result,
      });
      const played = info.date ? Date.parse(info.date) : NaN;
      const game = await saveGame({
        ownerUid,
        source: 'upload',
        createdAt: Number.isFinite(played) ? played : Date.now(),
        sgf,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      onSaved(game);
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : 'Could not save the game.');
    }
  };

  return (
    <div className="review-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="review-modal upload-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Upload game"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="review-modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2>Upload game</h2>

        <textarea
          className="upload-sgf"
          placeholder="Paste SGF here…"
          value={sgfText}
          onChange={(e) => applySgf(e.target.value)}
          spellCheck={false}
        />
        <div className="upload-file-row">
          <button type="button" onClick={() => fileRef.current?.click()}>Choose .sgf file…</button>
          <input
            ref={fileRef}
            type="file"
            accept=".sgf"
            style={{ display: 'none' }}
            onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          {parsed && !problem && (
            <span className="upload-parsed">
              {parsed.moves.length} moves{parsed.info.result && ` · ${parsed.info.result}`}
              {parsed.info.date && ` · ${parsed.info.date}`}
            </span>
          )}
        </div>

        <label className="upload-field">
          <span>Game name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="upload-player-row">
          <label className="upload-field">
            <span>Black player</span>
            <input value={playerBlack} onChange={(e) => setPlayerBlack(e.target.value)} />
          </label>
          <label className="upload-field upload-field-rank">
            <span>Rank</span>
            <input value={rankBlack} onChange={(e) => setRankBlack(e.target.value)} placeholder="e.g. 5k" />
          </label>
        </div>
        <div className="upload-player-row">
          <label className="upload-field">
            <span>White player</span>
            <input value={playerWhite} onChange={(e) => setPlayerWhite(e.target.value)} />
          </label>
          <label className="upload-field upload-field-rank">
            <span>Rank</span>
            <input value={rankWhite} onChange={(e) => setRankWhite(e.target.value)} placeholder="e.g. 5k" />
          </label>
        </div>

        {problem && <p className="review-error">{problem}</p>}
        {error && <p className="review-error">{error}</p>}

        <div className="upload-actions">
          <button type="button" onClick={save} disabled={saving || !parsed || !!problem}>
            {saving ? 'Saving…' : 'Save game'}
          </button>
        </div>
      </div>
    </div>
  );
}
