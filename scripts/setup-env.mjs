import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const template = await readFile(
  new URL('../.env.example', import.meta.url),
  'utf8',
);
const content = template
  .replaceAll('REPLACE_OPERATOR_PASSWORD', randomBytes(24).toString('hex'))
  .replaceAll('REPLACE_APP_PASSWORD', randomBytes(24).toString('hex'));
try {
  await writeFile(new URL('../.env', import.meta.url), content, {
    flag: 'wx',
    mode: 0o600,
  });
  console.log('Created .env with random local credentials');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists; kept existing values');
}
