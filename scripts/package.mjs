import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rm,
  readFile,
  writeFile,
  rename,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
await mkdir('artifacts', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const pages = process.argv.includes('--pages');
const filename = `RPGTravel-${version}-${pages ? 'github-pages' : 'static'}.zip`;
const name = `artifacts/${filename}`;
const temporary = await mkdtemp('artifacts/.package-');
try {
  const candidate = resolve(temporary, filename);
  execFileSync(
    'zip',
    [
      '-q',
      '-r',
      candidate,
      '.',
      '-x',
      '*/._*',
      '._*',
      '*/.DS_Store',
      '.DS_Store',
    ],
    {
      cwd: pages ? 'dist-pages' : 'dist',
      env: { ...process.env, COPYFILE_DISABLE: '1' },
    },
  );
  execFileSync('unzip', ['-tq', candidate], { stdio: 'pipe' });
  const data = await readFile(candidate);
  await writeFile(
    `${candidate}.sha256`,
    `${createHash('sha256').update(data).digest('hex')}  ${filename}\n`,
  );
  await rename(candidate, name);
  await rename(`${candidate}.sha256`, `${name}.sha256`);
  console.log(name, data.length, 'bytes');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
