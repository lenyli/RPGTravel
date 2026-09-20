import { writeFile, mkdir } from 'node:fs/promises';
import { tripJsonSchema } from '../src/protocol/schema';
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/rpg-trip-v1.schema.json',
  JSON.stringify(tripJsonSchema, null, 2) + '\n',
);
console.log('Exported artifacts/rpg-trip-v1.schema.json from schema.ts');
