const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI;

const log = {
  info: (msg, meta) => {
    if (isElectron() && window.electronAPI.logInfo) {
      window.electronAPI.logInfo(msg, meta);
    } else {
      console.info('[INFO]', msg, meta || '');
    }
  },
  warn: (msg, meta) => {
    if (isElectron() && window.electronAPI.logWarn) {
      window.electronAPI.logWarn(msg, meta);
    } else {
      console.warn('[WARN]', msg, meta || '');
    }
  },
  error: (msg, meta) => {
    if (isElectron() && window.electronAPI.logError) {
      window.electronAPI.logError(msg, meta);
    } else {
      console.error('[ERROR]', msg, meta || '');
    }
  },
  debug: (msg, meta) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[DEBUG]', msg, meta || '');
    }
  },
};

export default log;
