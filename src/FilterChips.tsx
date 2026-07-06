import './FilterChips.css';

export type Chip = { key: string; label: string };

/** Multi-select toggle chips for filtering a list. Shared by game review and the
 * teacher's per-student filtering. */
export function FilterChips({ chips, selected, onToggle, label = 'Filter' }: {
  chips: Chip[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  label?: string;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="filter-chips" role="group" aria-label={label}>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          className={selected.has(c.key) ? 'filter-chip active' : 'filter-chip'}
          aria-pressed={selected.has(c.key)}
          onClick={() => onToggle(c.key)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
