'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const syncDirectoryIfSupported = async (fsImpl, directory) => {
  let handle;
  try { handle = await fsImpl.open(directory, 'r'); await handle.sync(); } catch (error) {
    if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP', 'UNKNOWN'].includes(error?.code)) throw error;
  } finally { await handle?.close?.(); }
};

const writeFileAtomically = async ({ fsImpl, filePath, content }) => {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    await fsImpl.mkdir(directory, { recursive: true });
    handle = await fsImpl.open(temporaryPath, 'w');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await fsImpl.rename(temporaryPath, filePath);
    await syncDirectoryIfSupported(fsImpl, directory);
  } catch (error) {
    await handle?.close?.().catch(() => {});
    await fsImpl.rm?.(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};

const isProcessAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'ESRCH' ? false : true;
  }
};

const reclaimOrphanedLock = async (fsImpl, lockPath) => {
  let owner;
  try {
    owner = Number.parseInt((await fsImpl.readFile(lockPath, 'utf8')).trim(), 10);
  } catch {
    return false;
  }
  // A malformed or inaccessible lock is never removed: it may belong to a live process.
  if (isProcessAlive(owner) !== false) return false;

  // `readFile` followed by `rm` lets a second reclaimer remove a freshly
  // acquired lock. Claim the exact directory entry first. On local Windows
  // volumes rename is atomic, so only one contender can own this token.
  const reclaimedPath = `${lockPath}.${process.pid}.${crypto.randomUUID()}.reclaimed`;
  try {
    await fsImpl.rename(lockPath, reclaimedPath);
  } catch (error) {
    // Another contender already claimed or released the stale entry.
    if (error?.code === 'ENOENT') return false;
    return false;
  }

  try {
    // Revalidate after the atomic claim: never delete an entry that was
    // replaced between the initial liveness check and the rename.
    const claimedOwner = Number.parseInt((await fsImpl.readFile(reclaimedPath, 'utf8')).trim(), 10);
    if (claimedOwner !== owner || isProcessAlive(claimedOwner) !== false) {
      await fsImpl.rename(reclaimedPath, lockPath).catch(() => {});
      return false;
    }
    await fsImpl.rm(reclaimedPath, { force: false });
    return true;
  } catch (error) {
    // The token is private to this reclaimer; never fall back to unlinking
    // the public lock path here.
    return false;
  }
};

const withInterprocessFileLock = async ({ fsImpl, filePath, timeoutMs = 1000, retryMs = 10 }, operation) => {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  let handle;
  while (!handle) {
    try {
      await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
      handle = await fsImpl.open(lockPath, 'wx');
      await handle.writeFile(String(process.pid), 'utf8');
      await handle.sync();
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
        handle = null;
        await fsImpl.rm(lockPath, { force: true }).catch(() => {});
      }
      if (error?.code === 'EEXIST') await reclaimOrphanedLock(fsImpl, lockPath);
      if (error?.code !== 'EEXIST' || Date.now() - startedAt >= timeoutMs) throw new Error('Verrou credential indisponible.', { cause: error });
      await sleep(retryMs);
    }
  }
  try { return await operation(); } finally { await handle.close().catch(() => {}); await fsImpl.rm(lockPath, { force: true }).catch(() => {}); }
};

module.exports = { writeFileAtomically, withInterprocessFileLock, reclaimOrphanedLock };
