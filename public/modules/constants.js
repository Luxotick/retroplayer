/**
 * Constants Module
 * Uygulamanın tüm sabitlerini içerir
 */

export const STORAGE_KEYS = {
  ACCESS: 'spotifyAccessToken',
  REFRESH: 'spotifyRefreshToken',
  EXPIRY: 'spotifyAccessTokenExpiresAt'
};

export const TIMING = {
  PROGRESS_UPDATE_MS: 1000,
  REFRESH_BUFFER_MS: 60_000,
  TOKEN_DEFAULT_EXPIRY: 1800
};

export const URLS = {
  PLACEHOLDER_ALBUM_ART: 'https://via.placeholder.com/150',
  PLACEHOLDER_PLAYLIST_ART: 'https://via.placeholder.com/120',
  SPOTIFY_API_BASE: 'https://api.spotify.com/v1',
  SPOTIFY_PLAYER_API: 'https://spclient.wg.spotify.com'
};

export const UI = {
  MARQUEE_GAP: 32,
  MARQUEE_MIN_SPEED: 50,
  MARQUEE_MIN_DURATION: 8,
  MARQUEE_MAX_DURATION: 30,
  VOLUME_STEP: 0.05,
  DEFAULT_VOLUME: 0.5
};

export const PLAYLIST_TRACKING = {
  MAX_RESULTS: 100,
  SEARCH_LIMIT: 15
};

export default {
  STORAGE_KEYS,
  TIMING,
  URLS,
  UI,
  PLAYLIST_TRACKING
};
