import * as path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = process.env.HURL_EXTENSION_PATH || path.resolve(__dirname, '../..');
  const directory = mkdtempSync(path.join(tmpdir(), 'hurl-integration-'));
  const theme = path.join(directory, 'theme');
  const userDirectory = path.join(directory, 'user-data', 'User');
  mkdirSync(userDirectory, { recursive: true });
  // Older VS Code settings editors cannot remove a missing override from an empty file.
  writeFileSync(path.join(userDirectory, 'settings.json'), JSON.stringify({
    '[hurl]': { 'editor.semanticHighlighting.enabled': true },
  }));
  mkdirSync(theme);
  writeFileSync(path.join(theme, 'package.json'), JSON.stringify({
    name: 'hurl-test-theme', publisher: 'hurl-tests', version: '0.0.1', engines: { vscode: '*' },
    contributes: { themes: [{ label: 'Hurl Test Semantic Off', uiTheme: 'vs-dark', path: './theme.json' }] },
  }));
  writeFileSync(path.join(theme, 'theme.json'), JSON.stringify({
    name: 'Hurl Test Semantic Off', semanticHighlighting: false, colors: {},
    tokenColors: [{ scope: 'comment', settings: { foreground: '#778899' } }],
  }));
  try {
    await runTests({
      version: process.env.HURL_VSCODE_VERSION || 'stable',
      extensionDevelopmentPath: [extensionDevelopmentPath, theme],
      extensionTestsPath: path.resolve(__dirname, 'integration'),
      launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
        '--user-data-dir', path.join(directory, 'user-data')],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
