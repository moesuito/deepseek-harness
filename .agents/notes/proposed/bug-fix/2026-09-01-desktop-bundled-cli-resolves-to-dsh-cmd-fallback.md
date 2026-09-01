# Agent Note: Packaged Electron CLI resolves to the dsh.cmd fallback

Status: proposed

English | [中文](2026-09-01-desktop-bundled-cli-resolves-to-dsh-cmd-fallback.zh.md)

## Problem

The DeepSeek Harness desktop app (apps/desktop/src/main.js) launches the
web backend as a child process: it finds a Node executable, then calls
findDshTarget() to locate the dsh CLI entry, then spawns
"node <cli> web --no-open --port 3080". The app then polls
http://127.0.0.1:3080 until it responds, showing a modal
"Could not connect to the backend server on port 3080" when nothing binds.

The packaged Windows build ships every source file inside
resources/app.asar (see apps/desktop/package.json build.files and
electron-builder's appOutDir=release/win-unpacked). No apps/cli/lib/bin.js
exists on the real filesystem. findDshTarget()'s candidate list therefore
contains three "App resources path" entries that all point at
process.resourcesPath + 'apps/cli/lib/bin.js',
'resourcesPath + 'cli/lib/bin.js', and
'resourcesPath + 'app/apps/cli/lib/bin.js'. None of those paths exist, so
every one fails fs.existsSync(). where.exe dsh is not on PATH either. The
function then returns its last-resort fallback 'dsh.cmd', which the shell
cannot resolve ('dsh.cmd não é reconhecido como um comando interno ou
externo'), so the child exits with code 1 and nothing ever binds 3080. The
app shows the infinite-loading modal and the user clicks OK into the same
error.

This is a defect in the shipped desktop packaging, not the user's system:
the source repo boots fine from apps/cli/lib/bin.js via pnpm, and the
original failure (the EPIPE uncaught exception when the backend closes its
stdout pipe mid-drain) is a separate, already-logged crash.

## Proposal

Correct findDshTarget() so its first App resources candidate resolves the
CLI from inside the asar. process.resourcesPath already points at the
resources/ folder inside the packaged app, and the asar is at
resources/app.asar. The packaged app must resolve the CLI entry there, not
at any apps/cli/lib/bin.js path on disk. The on-disk candidates
(relative, common-repo, and global/user dsh.cmd) remain as fallbacks for
dev, sandbox, or non-packaged boots.

Open questions for whoever finishes this:

- The user reported the .asar file appears loose in the folder and offers to
  open it with a text editor. Confirm whether that is the installer copying
  the asar somewhere it should not, or a benign artifact of how the
  release/ tree is inspected. Do not ship a build where the asar is
  reachable outside the app bundle.
- Decide whether to keep the on-disk fallbacks or make the asar path the
  only Windows candidate, so a future refactor cannot reintroduce the
  fallback that caused this.
- Consider adding a fail-loud, actionable message when the backend never
  binds: the current modal says "Timeout waiting for server on port 3080"
  even when the real cause is that the CLI was never found.

## Alternatives considered

- **Ship a prebuilt dsh.cmd in the asar.** Adds a committed binary asset and
  an extra release artifact to version; the asar already contains the
  compiled JS entry, so this duplicates it.
- **Keep the on-disk fallbacks as the primary candidates.** They never exist
  in a release build, which is exactly the bug.
- **Hardcode the asar path with a literal string.** Less robust than
  process.resourcesPath, which stays correct across electron rebuilds and
  relaunches.

## Acceptance criteria

- The packaged Windows build resolves the backend CLI from inside
  resources/app.asar; the backend binds 127.0.0.1:3080 and the app opens
  without the modal.
- The asar is not reachable or loose outside the app bundle.
- Dev, sandbox, and non-packaged boots still resolve the CLI from the
  on-disk candidates.

## Risks

The asar path must be correct for the shipped layout; an electron-builder
config change to appOutDir or file inclusion could shift it. The fix must
not regress the Linux or non-packaged Windows paths that the on-disk
fallbacks serve.
