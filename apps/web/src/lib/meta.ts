/**
 * A meta tag's content from index.html. The server adds runtime settings as meta tags
 * (Sentry, the environment), so one build serves staging and prod. Empty or missing: undefined.
 */
export function meta(name: string): string | undefined {
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || undefined;
}
