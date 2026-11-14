import { useEffect, useId, useRef, useState } from 'react';
import { authClient } from '../lib/auth-client';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/** The signed-in Staff member, as Better Auth's session gives it. */
export type User = { name: string; email: string };

/** The avatar on the right of the top bar: who's signed in, and sign-out. */
export function AvatarMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);

  async function signOut() {
    setSigningOut(true);
    setSignOutFailed(false);
    const { error } = await authClient.signOut();
    setSigningOut(false);
    if (error) setSignOutFailed(true);
  }

  return (
    <div className="avatar-menu" ref={root}>
      <button
        className="avatar-menu__button"
        type="button"
        aria-label={`Account: ${user.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        {initials(user.name)}
      </button>
      {open && (
        <div className="avatar-menu__panel" id={menuId} role="menu" aria-label="Account">
          <div className="avatar-menu__who">
            <span className="avatar-menu__name">{user.name}</span>
            <span className="avatar-menu__email">{user.email}</span>
          </div>
          <button
            className="avatar-menu__item"
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          {signOutFailed && (
            <p className="form-error" role="alert">
              Signing out didn’t work. Try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
