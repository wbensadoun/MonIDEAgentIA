/**
 * Système de logging pour l'application
 * Écrit les logs dans un fichier et affiche dans la console
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

class Logger {
  constructor() {
    this.logFile = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    try {
      const logDir = path.join(app.getPath('userData'), 'logs');
      await fs.mkdir(logDir, { recursive: true });
      
      const timestamp = new Date().toISOString().split('T')[0];
      this.logFile = path.join(logDir, `app-${timestamp}.log`);
      this.initialized = true;
      
      this.info('Logger initialized');
    } catch (error) {
      console.error('[Logger] Failed to initialize:', error);
    }
  }

  _formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}\n`;
  }

  async _write(level, message, meta) {
    const formatted = this._formatMessage(level, message, meta);
    
    // Always log to console
    console.log(formatted.trim());
    
    // Write to file if initialized
    if (this.initialized && this.logFile) {
      try {
        await fs.appendFile(this.logFile, formatted, 'utf8');
      } catch (error) {
        console.error('[Logger] Failed to write to file:', error);
      }
    }
  }

  async info(message, meta) {
    await this._write('INFO', message, meta);
  }

  async warn(message, meta) {
    await this._write('WARN', message, meta);
  }

  async error(message, meta) {
    await this._write('ERROR', message, meta);
  }

  async debug(message, meta) {
    if (process.env.DEBUG) {
      await this._write('DEBUG', message, meta);
    }
  }
}

const logger = new Logger();

module.exports = logger;
