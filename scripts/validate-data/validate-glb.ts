/** Validate GLB files with the Khronos glTF validator. Usage: npx tsx scripts/validate-data/validate-glb.ts <file...> */
import { readFile } from 'node:fs/promises';
import validator from 'gltf-validator';
for (const file of process.argv.slice(2)) {
  const data = await readFile(file);
  const report = await validator.validateBytes(new Uint8Array(data), { maxIssues: 5 });
  const { numErrors, numWarnings, numInfos } = report.issues;
  console.log(`${file}: errors=${numErrors} warnings=${numWarnings} infos=${numInfos}`);
  for (const m of report.issues.messages.slice(0, 5))
    console.log(`   [${m.severity}] ${m.code}: ${m.message} (${m.pointer})`);
}
