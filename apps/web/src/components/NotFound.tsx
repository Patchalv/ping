import { AppLink } from './AppLink';

/** A not-found screen, with the way back home. */
export function NotFound({ title, note }: { title: string; note: string }) {
  return (
    <div className="not-found">
      <h1 className="not-found__title">{title}</h1>
      <p className="not-found__note">{note}</p>
      <AppLink className="button" href="/">
        Back to your Channels
      </AppLink>
    </div>
  );
}

/** A path the app doesn't know. */
export function PageNotFound() {
  return <NotFound title="Page not found" note="Check the link." />;
}
