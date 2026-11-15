import { useState } from 'react';
import { Avatar, AvatarFallback } from '#/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { authClient } from '../lib/auth-client';
import { isThemeChoice, setThemeChoice, useThemeChoice } from '../lib/theme';
import { FormError } from './FormError';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/** The signed-in Staff member, as Better Auth's session gives it. */
export type User = { name: string; email: string };

/** The avatar on the right of the top bar: who's signed in, the theme, and sign-out. */
export function AvatarMenu({ user }: { user: User }) {
  const theme = useThemeChoice();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function signOut() {
    setSigningOut(true);
    setSignOutFailed(false);
    const { error } = await authClient.signOut();
    setSigningOut(false);
    if (error) setSignOutFailed(true);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${user.name}`}
        className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Avatar className="rounded-md after:rounded-md after:border-0">
          <AvatarFallback className="rounded-md bg-sidebar-primary text-small font-bold text-sidebar-primary-foreground">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid gap-0.5 py-1.5">
            <span className="text-sm font-semibold text-foreground">{user.name}</span>
            <span className="text-small [overflow-wrap:anywhere]">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value: unknown) => {
              if (isThemeChoice(value)) setThemeChoice(value);
            }}
          >
            <DropdownMenuRadioItem value="system" closeOnClick={false}>
              System
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light" closeOnClick={false}>
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" closeOnClick={false}>
              Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/* Stays open on click, so a failure message has somewhere to show. */}
        <DropdownMenuItem closeOnClick={false} disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
        {signOutFailed ? (
          <FormError className="m-1">Signing out didn’t work. Try again.</FormError>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
