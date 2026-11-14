// Part of `pnpm lint`: every `@ts-expect-error` and every `eslint-disable` comment must say
// why after `--`, e.g. `// @ts-expect-error -- the library's types miss the overload` or
// `// eslint-disable-next-line no-restricted-syntax -- syncs with document events`. Biome
// bans `@ts-ignore` and requires a reason on `biome-ignore`, but has no rule for these.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.ts', '*.tsx'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((path) => path.length > 0 && !path.startsWith('.claude/skills/') && existsSync(path));

const bare = /@ts-expect-error\s*(?:\*\/)?\s*$/;
// An eslint-disable comment (any form) with no `-- reason` after it.
const eslintDisable = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b/;
const withReason = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b[^\n]*?--\s*\S/;
const problems: string[] = [];
for (const path of files) {
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (bare.test(line)) problems.push(`${path}:${index + 1}  @ts-expect-error`);
      if (eslintDisable.test(line) && !withReason.test(line)) {
        problems.push(`${path}:${index + 1}  eslint-disable`);
      }
    });
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`${problem} needs a reason after \`--\``);
  }
  process.exit(1);
}
