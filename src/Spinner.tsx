import './Spinner.css';

/** Small spinning indicator for sections that are still fetching.
 * `label` renders next to the spinner for screenreader / sighted-user
 * clarity; omit it for a bare dot. */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  );
}
