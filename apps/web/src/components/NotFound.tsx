import { Link } from '@tanstack/react-router';
import { buttonVariants } from '#/components/ui/button';

/** A not-found screen, with the way back home. */
export function NotFound({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto my-16 grid max-w-md justify-items-center gap-3 px-6 text-center">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{note}</p>
      <Link className={buttonVariants({ variant: 'outline' })} to="/">
        Back to your Channels
      </Link>
    </div>
  );
}

/** A path the app doesn't know. */
export function PageNotFound() {
  return <NotFound title="Page not found" note="Check the link." />;
}
