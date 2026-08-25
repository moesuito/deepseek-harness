#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DESKTOP_DIR = join(REPO_ROOT, 'apps/desktop');

function run(cmd, cwd = REPO_ROOT) {
  console.log(`[EXEC] ${cmd} (cwd: ${cwd})`);
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseSemver(versionStr) {
  const match = versionStr.match(/^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/);
  if (!match) return { major: 0, minor: 1, patch: 1 };
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

async function main() {
  console.log('=== DeepSeek Harness Upstream Sync & Release Workflow ===');

  // 1. Fetch upstream
  console.log('Fetching upstream origin/master...');
  try {
    run('git fetch origin master');
  } catch (e) {
    console.error('Failed to fetch origin master:', e.message);
    process.exit(1);
  }

  // 2. Check for new commits
  const newCommits = run('git log HEAD..origin/master --oneline');
  if (!newCommits) {
    console.log('No new upstream commits found. Everything is already up to date!');
    return;
  }

  console.log('New upstream commits detected:');
  console.log(newCommits);

  // 3. Merge upstream
  console.log('Merging origin/master into local master...');
  run('git merge origin/master --no-edit -m "chore(sync): sync upstream deepseek-ai/deepseek-harness"');

  // 4. Determine version bump
  const rootPkgPath = join(REPO_ROOT, 'package.json');
  const desktopPkgPath = join(DESKTOP_DIR, 'package.json');

  const desktopPkg = JSON.parse(readFileSync(desktopPkgPath, 'utf8'));
  const currentVersion = desktopPkg.version || '0.1.1';
  const { major, minor, patch } = parseSemver(currentVersion);

  const commitList = newCommits.toLowerCase();
  let nextVersion;

  if (commitList.includes('breaking change') || commitList.includes('major:')) {
    nextVersion = `${major + 1}.0.0`;
  } else if (commitList.includes('feat:') || commitList.includes('feature:') || commitList.includes('minor:')) {
    nextVersion = `${major}.${minor + 1}.0`;
  } else {
    // Minor daily patches: increment patch monotonically (e.g. 0.1.2, 0.1.3, ... 0.1.457)
    nextVersion = `${major}.${minor}.${patch + 1}`;
  }

  console.log(`Version bump: ${currentVersion} -> ${nextVersion}`);

  // 5. Update package.json files
  desktopPkg.version = nextVersion;
  writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, 2) + '\n');

  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
    rootPkg.version = nextVersion;
    writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
  }

  // 6. Build packages and desktop app
  console.log('Building DeepSeek Harness core and desktop app...');
  run('pnpm install', REPO_ROOT);
  run('pnpm run build', REPO_ROOT);

  console.log('Packaging Linux .deb installer...');
  run('pnpm run dist:deb', DESKTOP_DIR);

  console.log('Packaging Windows .exe installer...');
  run('pnpm run dist:win', DESKTOP_DIR);

  // 7. Commit & push
  console.log('Committing changes to fork...');
  run('git add -A', REPO_ROOT);
  run(`git commit -m "chore(release): bump version to v${nextVersion} and sync upstream"`, REPO_ROOT);
  run('git push fork master', REPO_ROOT);

  // 8. Publish GitHub Release
  const debFile = join(DESKTOP_DIR, `release/deepseek-harness_${nextVersion}_amd64.deb`);
  const exeFile = join(DESKTOP_DIR, `release/DeepSeek Harness Setup ${nextVersion}.exe`);

  const releaseNotes = `## DeepSeek Harness Desktop v${nextVersion} 🚀

Automated release synchronized with upstream \`deepseek-ai/deepseek-harness\`.

### Upstream Commits Included:
\`\`\`
${newCommits}
\`\`\`

### 📥 Downloads:
- **Linux (.deb)**: \`deepseek-harness_${nextVersion}_amd64.deb\`
- **Windows (.exe)**: \`DeepSeek Harness Setup ${nextVersion}.exe\`
`;

  console.log(`Creating GitHub Release v${nextVersion}-desktop...`);
  run(`gh release create v${nextVersion}-desktop "${debFile}#DeepSeek Harness (Linux .deb)" "${exeFile}#DeepSeek Harness Installer (Windows .exe)" --repo moesuito/deepseek-harness --title "DeepSeek Harness Desktop v${nextVersion}" --notes "${releaseNotes.replace(/"/g, '\\"')}"`, REPO_ROOT);

  // 9. Install locally on Linux
  if (existsSync(debFile)) {
    console.log('Updating local Linux installation...');
    try {
      run(`sudo dpkg -i "${debFile}"`, REPO_ROOT);
    } catch (e) {
      console.warn('Local dpkg install skipped/failed:', e.message);
    }
  }

  console.log(`=== Successfully synchronized and released v${nextVersion}-desktop! ===`);
}

main().catch((err) => {
  console.error('Fatal error during sync and release:', err);
  process.exit(1);
});
