import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../Spinner';
import { listCollections } from '../data/library';
import type { LibCollection } from '../data/model';
import '../Collection.css';

export function Library() {
  const [collections, setCollections] = useState<LibCollection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCollections().then(setCollections).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="library"><p className="error">{error}</p></div>;
  if (collections === null) return <div className="library"><Spinner /></div>;

  return (
    <div className="library">
      <h1>Library</h1>
      <ul className="library-list">
        {collections.map((c) => (
          <li key={c.slug}>
            <Link to={`/library/${c.slug}`} className="library-row">
              <span className="library-row-name">{c.collection}</span>
              <span className="library-row-count">{c.count} problem{c.count === 1 ? '' : 's'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
