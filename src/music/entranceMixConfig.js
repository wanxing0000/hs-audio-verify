/**
 * Unified entrance-preview mix. Preview optimization only —
 * not official Hearthstone mix timing. Do not special-case CardID.
 */
const ENTRANCE_MIX_VERSION = 3;

const ENTRANCE_MIX = {
  musicVolume: 0.7,
  voiceVolume: 1,
  voiceDelayMs: 0,
  leadingPaddingMs: 0,
  targetRate: 48000,
};

/** Max Music start skip for Entrance Combo only (ms). Never scan past this. */
const MAX_MUSIC_START_COMPENSATION_MS = 150;

/** Analysis hop / window length (ms) inside the cap. */
const MUSIC_START_WINDOW_MS = 10;

/** Window peak (absolute int16) to count as audible. */
const MUSIC_START_PEAK_THRESHOLD = 500;

/** Window RMS (int16 scale) to count as audible. */
const MUSIC_START_RMS_THRESHOLD = 200;

/** Consecutive audible windows required before skipping to that start. */
const MUSIC_START_CONSECUTIVE_WINDOWS = 2;

module.exports = {
  ENTRANCE_MIX_VERSION,
  ENTRANCE_MIX,
  MAX_MUSIC_START_COMPENSATION_MS,
  MUSIC_START_WINDOW_MS,
  MUSIC_START_PEAK_THRESHOLD,
  MUSIC_START_RMS_THRESHOLD,
  MUSIC_START_CONSECUTIVE_WINDOWS,
};
