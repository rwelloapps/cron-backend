'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

let cached = null;

function readEnv(keys) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    return '';
  }
}

function formatAgo(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 60) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function resolveCommittedAt(commit) {
  const fromEnv = readEnv(['GIT_COMMITTED_AT', 'GIT_COMMIT_DATE', 'COMMIT_TIMESTAMP']);
  if (fromEnv) {
    const d = new Date(fromEnv);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (!commit) return null;
  const iso = git(['show', '-s', '--format=%cI', commit]) || git(['log', '-1', '--format=%cI', commit]);
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Resolve current git revision for health responses.
 * Prefers deploy env vars when `.git` is unavailable on the server.
 * Relative age is computed fresh on each call.
 */
function getGitRevision() {
  if (!cached) {
    const envCommit = readEnv(['GIT_COMMIT', 'GIT_SHA', 'COMMIT_SHA', 'SOURCE_VERSION']);
    const envBranch = readEnv(['GIT_BRANCH', 'BRANCH_NAME', 'CI_COMMIT_REF_NAME']);

    const commit = envCommit || git(['rev-parse', 'HEAD']);
    let branch = envBranch || git(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') {
      branch = envBranch || git(['name-rev', '--name-only', 'HEAD']) || 'HEAD';
    }

    cached = {
      git_commit: commit || null,
      git_commit_short: commit ? commit.slice(0, 7) : null,
      git_branch: branch || null,
      git_committed_at: resolveCommittedAt(commit),
    };
  }

  let updated_ago = null;
  let updated_ago_seconds = null;
  if (cached.git_committed_at) {
    const ms = Date.now() - new Date(cached.git_committed_at).getTime();
    if (Number.isFinite(ms)) {
      updated_ago_seconds = Math.max(0, Math.floor(ms / 1000));
      updated_ago = formatAgo(ms);
    }
  }

  return {
    ...cached,
    updated_ago,
    updated_ago_seconds,
  };
}

module.exports = {
  getGitRevision,
};
