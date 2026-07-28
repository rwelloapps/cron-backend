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

function getGitRevision() {
  if (cached) return cached;

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
  };
  return cached;
}

module.exports = {
  getGitRevision,
};
