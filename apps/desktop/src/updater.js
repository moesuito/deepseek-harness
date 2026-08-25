const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { app, dialog } = require('electron');

const REPO_OWNER = 'moesuito';
const REPO_NAME = 'deepseek-harness';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

/**
 * Compare two semantic version strings.
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
function compareSemver(v1, v2) {
  const parse = (v) => {
    const clean = v.replace(/^[vV]/, '').split('-')[0];
    return clean.split('.').map((num) => parseInt(num, 10) || 0);
  };

  const [maj1, min1, pat1] = parse(v1);
  const [maj2, min2, pat2] = parse(v2);

  if (maj1 !== maj2) return maj1 > maj2 ? 1 : -1;
  if (min1 !== min2) return min1 > min2 ? 1 : -1;
  if (pat1 !== pat2) return pat1 > pat2 ? 1 : -1;
  return 0;
}

/**
 * Fetch latest release from GitHub API.
 */
function getLatestRelease() {
  return new Promise((resolve) => {
    const req = https.get(
      GITHUB_API_URL,
      {
        headers: {
          'User-Agent': 'DeepSeek-Harness-Desktop',
          Accept: 'application/vnd.github.v3+json'
        },
        timeout: 6000
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Check if a newer version is available on GitHub Releases.
 */
async function checkForUpdates(currentVersion) {
  try {
    const release = await getLatestRelease();
    if (!release || !release.tag_name) return { hasUpdate: false };

    const remoteTag = release.tag_name;
    const remoteVersion = remoteTag.replace(/^[vV]/, '').split('-')[0];

    if (compareSemver(remoteVersion, currentVersion) > 0) {
      const isLinux = process.platform === 'linux';
      const isWin = process.platform === 'win32';

      let targetAsset = null;
      if (isLinux) {
        targetAsset = release.assets?.find((a) => a.name.endsWith('.deb'));
      } else if (isWin) {
        targetAsset = release.assets?.find((a) => a.name.endsWith('.exe'));
      }

      if (targetAsset) {
        return {
          hasUpdate: true,
          version: remoteVersion,
          releaseName: release.name || remoteTag,
          releaseNotes: release.body || '',
          asset: targetAsset
        };
      }
    }
  } catch (err) {
    console.error('Update check failed:', err);
  }
  return { hasUpdate: false };
}

/**
 * Download a file with redirect support and progress callback.
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(
      url,
      {
        headers: { 'User-Agent': 'DeepSeek-Harness-Desktop' }
      },
      (res) => {
        // Handle HTTP 301 / 302 Redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return downloadFile(res.headers.location, destPath, onProgress)
            .then(resolve)
            .catch(reject);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && onProgress) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            onProgress(percent);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(destPath));
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }
    ).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Apply the downloaded update and relaunch/exit the application.
 */
async function applyUpdate(installerPath) {
  if (process.platform === 'linux') {
    return new Promise((resolve, reject) => {
      // Use pkexec for graphical root privilege prompt
      exec(`pkexec dpkg -i "${installerPath}"`, (err) => {
        if (err) {
          return reject(err);
        }
        app.relaunch();
        app.quit();
        resolve();
      });
    });
  } else if (process.platform === 'win32') {
    // Run the NSIS setup executable and quit
    spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    app.quit();
  }
}

module.exports = {
  checkForUpdates,
  downloadFile,
  applyUpdate
};
