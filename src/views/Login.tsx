import { useAuth } from '../auth';
import '../Profile.css';

export function Login() {
  const { signIn } = useAuth();
  return (
    <div className="login">
      <div className="login-card">
        <h1 className="login-brand">tsumego</h1>
        <p className="login-sub">Sign in to access your problem library and reviews.</p>
        <button className="login-btn" onClick={signIn}>Sign in with Google</button>
      </div>
    </div>
  );
}
