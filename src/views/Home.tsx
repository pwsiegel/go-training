import { useAuth } from '../auth';
import './Home.css';

export function Home() {
  const { profile } = useAuth();
  return (
    <div className="home">
      <h1>Welcome{profile?.displayName ? `, ${profile.displayName}` : ''}</h1>
      <p className="home-hint">
        Pick something from the sidebar — solve tsumego, play a game, or review your games.
      </p>
    </div>
  );
}
