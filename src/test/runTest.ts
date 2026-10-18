import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = process.env.HURL_EXTENSION_PATH || path.resolve(__dirname, '../..');
  await runTests({
    version: 'stable',
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve(__dirname, 'integration'),
    launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
  });
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
