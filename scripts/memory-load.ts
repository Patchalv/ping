// A short load for measuring the app's memory (docs/deploy-runbook.md › Memory): signs in
// several sessions, then keeps each one busy for a while. Watch memory meanwhile, with
// `docker stats` locally or the Fly dashboard's Memory graph on staging.
//
//   node scripts/memory-load.ts <base-url> <password> <email> [<email> ...]
//
// Env: SESSIONS (default 12), SECONDS (default 60). Prints no email addresses.
const [baseUrl, password, ...emails] = process.argv.slice(2);
if (!baseUrl || !password || emails.length === 0) {
  console.error('Usage: node scripts/memory-load.ts <base-url> <password> <email> [<email> ...]');
  process.exit(2);
}
const sessions = Number(process.env.SESSIONS ?? '12');
const seconds = Number(process.env.SECONDS ?? '60');

async function signIn(email: string, index: number): Promise<string> {
  for (;;) {
    const cookie = await trySignIn(email, index);
    if (cookie !== undefined) return cookie;
    // On Fly, Fly sets Fly-Client-IP itself, so every sign-in shares one rate-limit bucket.
    console.log(`Sign-in ${index} rate-limited; waiting 10s.`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

/** The session cookie, or undefined when the rate limiter refused the attempt. */
async function trySignIn(email: string, index: number): Promise<string | undefined> {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl ?? '',
      // A different client IP per session, so locally the rate limiter lets them all in.
      'fly-client-ip': `10.9.${Math.floor(index / 250)}.${(index % 250) + 1}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 429) return undefined;
  if (!res.ok) throw new Error(`Sign-in ${index} failed: HTTP ${res.status}`);
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

// One at a time, so a rate-limited sign-in can wait without failing the others.
const cookies: string[] = [];
for (let i = 0; i < sessions; i++) {
  cookies.push(await signIn(emails[i % emails.length] ?? '', i));
}
console.log(`${cookies.length} sessions signed in. Loading for ${seconds}s…`);

const deadline = Date.now() + seconds * 1000;
let requests = 0;
await Promise.all(
  cookies.map(async (cookie) => {
    while (Date.now() < deadline) {
      const paths = ['/api/auth/get-session', '/', '/healthz'];
      await Promise.all(
        paths.map((path) =>
          fetch(`${baseUrl}${path}`, { headers: { cookie } }).then((r) => r.text()),
        ),
      );
      requests += paths.length;
    }
  }),
);
console.log(`Done: ${requests} requests.`);
