import { useState } from 'react';
import { useAuth } from '../auth';
import { setDisplayName, setRole } from '../data/profile';
import '../Profile.css';

export function Profile() {
  const { user, profile } = useAuth();
  const uid = user!.uid;
  const [name, setName] = useState(profile?.displayName ?? '');
  const [role, setRoleState] = useState<'student' | 'teacher'>(profile?.role ?? 'student');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await setDisplayName(uid, name.trim());
      await setRole(uid, role);
      setFlash('Saved. Reload to update navigation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile">
      <header className="profile-header"><h1>Profile</h1></header>
      <form className="profile-form" onSubmit={save}>
        <label className="profile-row">
          <span className="profile-label">Display name</span>
          <input
            className="profile-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (shown to teachers on submissions)"
            maxLength={64}
          />
        </label>
        <p className="profile-hint">How you appear to teachers when you send them problems.</p>

        <label className="profile-row">
          <span className="profile-label">Default view</span>
          <select className="profile-input" value={role}
            onChange={(e) => setRoleState(e.target.value as 'student' | 'teacher')}>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
          </select>
        </label>
        <p className="profile-hint">Which view loads first. You can switch from the nav bar.</p>

        <p className="profile-email">Signed in as {user?.email}</p>

        <div className="profile-actions">
          <button type="submit" className="profile-save" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {flash && <span className="profile-flash">{flash}</span>}
        </div>
      </form>
    </div>
  );
}
