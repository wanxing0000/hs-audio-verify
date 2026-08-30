const PRODUCTION_API_BASE = 'https://api.hsvoiceguide.online';
const DEFAULT_API_BASE = PRODUCTION_API_BASE;
const overrideFile = require('./apiBase.override.js');
const lanFile = require('./apiBase.lan.js');

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function readFileBase(mod) {
  if (!mod || !mod.apiBase) return null;
  const value = String(mod.apiBase).trim();
  return value ? trimSlash(value) : null;
}

function detectPlatform() {
  try {
    const info = wx.getSystemInfoSync();
    return info && info.platform ? info.platform : 'devtools';
  } catch (e) {
    return 'devtools';
  }
}

function resolveApiBase(opts) {
  opts = opts || {};
  const override = opts.override !== undefined ? opts.override : readFileBase(overrideFile);
  if (override) return trimSlash(override);
  const platform = opts.platform !== undefined ? opts.platform : detectPlatform();
  if (platform && platform !== 'devtools') {
    const lan = opts.lan !== undefined ? opts.lan : readFileBase(lanFile);
    if (lan) return trimSlash(lan);
  }
  return DEFAULT_API_BASE;
}

function getApiBase() {
  return resolveApiBase();
}

module.exports = {
  PRODUCTION_API_BASE,
  DEFAULT_API_BASE,
  imageBase: 'https://art.hearthstonejson.com/v1/render/latest/zhCN/256x',
  getApiBase,
  resolveApiBase,
  get apiBase() {
    return getApiBase();
  },
};
