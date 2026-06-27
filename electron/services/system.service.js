'use strict';

const os = require('os');
const { readSettingsSafe } = require('./settings.service');
const {
  OLLAMA_BASE_URL,
  fetchOllamaTags,
  readWindowsGpuInfo,
} = require('./ollama.service');

const getSystemAIProfile = async (options = {}) => {
  const settings = await readSettingsSafe();
  const explicitConsent = options?.consent === true;
  if (!explicitConsent && (settings.localAIOptimizationMode !== 'auto' || !settings.localAIHardwareConsent)) {
    return {
      success: false,
      denied: true,
      error: 'Lecture hardware non autorisee. Activez Auto-adaptatif avec consentement explicite.'
    };
  }

  const cpus = os.cpus() || [];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const gpus = await readWindowsGpuInfo();
  let ollama = { available: false, models: [], error: null };

  try {
    const ollamaResponse = await fetchOllamaTags(OLLAMA_BASE_URL, 2500);
    const models = (ollamaResponse.data?.models || []).map((model) => ({
      name: model.name,
      size: model.size,
      sizeGb: Number.isFinite(Number(model.size))
        ? Number((Number(model.size) / 1024 / 1024 / 1024).toFixed(2))
        : null,
      modified: model.modified_at
    }));
    ollama = { available: true, models, error: null };
  } catch (error) {
    ollama = {
      available: false,
      models: [],
      error: error.message
    };
  }

  const ramGb = Number((totalMem / 1024 / 1024 / 1024).toFixed(1));
  const profile = ramGb >= 64 ? 'Workstation' : ramGb >= 32 ? 'High' : ramGb >= 16 ? 'Standard' : 'Low';

  return {
    success: true,
    profile,
    os: {
      platform: process.platform,
      arch: process.arch,
      release: os.release()
    },
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || 'unknown'
    },
    memory: {
      totalGb: ramGb,
      freeGb: Number((freeMem / 1024 / 1024 / 1024).toFixed(1))
    },
    gpu: gpus,
    ollama
  };
};

module.exports = { getSystemAIProfile };
