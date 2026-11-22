import { Badge } from '#/components/ui/badge';
import { environmentLabel } from '#/lib/environment';
import { meta } from '#/lib/meta';

/**
 * "Staging" beside the Ping wordmark on staging, so nobody mistakes it for production.
 * Nothing on production or in local development. The server sets the title to match.
 */
export function EnvironmentBadge() {
  const label = environmentLabel(meta('ping-environment'));
  if (!label) return null;
  return (
    <Badge variant="tag" className="border-chrome-foreground/40 text-chrome-foreground">
      {label}
    </Badge>
  );
}
