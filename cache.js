const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, 'cache');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function hashProblem(problemText) {
  const normalized = problemText.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function getCachePath(hash) {
  return path.join(CACHE_DIR, `${hash}.json`);
}

function getCachedSolution(problemText) {
  ensureCacheDir();
  const hash = hashProblem(problemText);
  const cachePath = getCachePath(hash);

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return { ...data, cacheHit: true, cacheHash: hash };
  } catch {
    return null;
  }
}

function setCachedSolution(problemText, solution) {
  ensureCacheDir();
  const hash = hashProblem(problemText);
  const cachePath = getCachePath(hash);

  const payload = {
    hash,
    cachedAt: new Date().toISOString(),
    problemText: problemText.trim(),
    ...solution
  };

  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), 'utf8');
  return hash;
}

module.exports = {
  hashProblem,
  getCachedSolution,
  setCachedSolution
};
