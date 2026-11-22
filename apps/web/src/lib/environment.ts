/**
 * The label that marks a deployment as not production, from the server's ping-environment
 * meta tag (PING_ENVIRONMENT). Only staging has one: production and local development
 * look the same as ever.
 */
export function environmentLabel(content: string | undefined): string | null {
  return content === 'staging' ? 'Staging' : null;
}
