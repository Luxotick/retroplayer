/**
 * Token Manager Module
 * Spotify token'ları yönetir ve refresh işlemlerini gerçekleştirir
 */

import { STORAGE_KEYS, TIMING } from './constants.js';
import { DOMElements } from './domElements.js';

export class TokenManager {
  constructor() {
    this.accessToken = sessionStorage.getItem(STORAGE_KEYS.ACCESS);
    this.refreshToken = sessionStorage.getItem(STORAGE_KEYS.REFRESH);
    this.expiresAt = Number(sessionStorage.getItem(STORAGE_KEYS.EXPIRY)) || null;
    this.refreshTimeoutId = null;
    this.refreshInFlight = null;
    this.onTokenExpired = null;
    this.onTokenRefreshed = null;
  }

  /**
   * URL hash'inden token'ları okur
   */
  readAuthFromHash() {
    if (!window.location.hash || window.location.hash.length <= 1) {
      return {};
    }

    const params = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const expiresInRaw = params.get('expires_in');
    const expiresIn = expiresInRaw ? Number(expiresInRaw) : null;

    return {
      accessToken,
      refreshToken,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null
    };
  }

  /**
   * Token'ları sessionStorage'a kaydeder
   */
  persistTokens({ accessToken, refreshToken, expiresIn }) {
    if (accessToken) {
      sessionStorage.setItem(STORAGE_KEYS.ACCESS, accessToken);
      this.accessToken = accessToken;
    }
    if (refreshToken) {
      sessionStorage.setItem(STORAGE_KEYS.REFRESH, refreshToken);
      this.refreshToken = refreshToken;
    }
    if (typeof expiresIn === 'number' && !Number.isNaN(expiresIn) && expiresIn > 0) {
      this.setAccessTokenExpiry(expiresIn);
    }
    this.scheduleTokenRefresh(expiresIn);
  }

  /**
   * URL hash'i temizler
   */
  clearHash() {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, document.title, window.location.pathname);
    } else {
      window.location.hash = '';
    }
  }

  /**
   * Token sona erme zamanını ayarlar
   */
  setAccessTokenExpiry(expiresInSeconds) {
    const seconds = Number(expiresInSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }

    this.expiresAt = Date.now() + seconds * 1000;
    sessionStorage.setItem(STORAGE_KEYS.EXPIRY, String(this.expiresAt));
  }

  /**
   * Token refresh'ini planlar
   */
  scheduleTokenRefresh(expiresInSeconds) {
    const seconds = Number(expiresInSeconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      this.setAccessTokenExpiry(seconds);
    }

    if (!this.refreshToken || !this.expiresAt) {
      return;
    }

    if (this.refreshTimeoutId) {
      window.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }

    const delay = Math.max(0, this.expiresAt - Date.now() - TIMING.REFRESH_BUFFER_MS);

    this.refreshTimeoutId = window.setTimeout(() => {
      this.refreshTimeoutId = null;
      void this.refreshAccessToken().catch(() => {});
    }, delay);
  }

  /**
   * Access token'ı refresh eder
   */
  async refreshAccessToken(options = {}) {
    const { force = false } = options;

    if (!this.refreshToken) {
      return false;
    }

    if (this.refreshInFlight && !force) {
      return this.refreshInFlight;
    }

    const runRefresh = (async () => {
      try {
        const response = await fetch(`/refresh_token?refresh_token=${encodeURIComponent(this.refreshToken)}`, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`Refresh request failed with status ${response.status}`);
        }

        const payload = await response.json();
        const newToken = payload?.access_token;
        const expiresInRaw = payload?.expires_in;
        const expiresInSeconds = typeof expiresInRaw === 'number' ? expiresInRaw : Number(expiresInRaw);

        if (!newToken) {
          throw new Error('Refresh response missing access_token');
        }

        sessionStorage.setItem(STORAGE_KEYS.ACCESS, newToken);
        this.accessToken = newToken;

        if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
          this.scheduleTokenRefresh(expiresInSeconds);
        } else {
          this.scheduleTokenRefresh();
        }

        if (this.onTokenRefreshed) {
          this.onTokenRefreshed(newToken);
        }

        return true;
      } catch (error) {
        console.error('Unable to refresh access token:', error);
        this.clearAllTokens();
        
        if (this.onTokenExpired) {
          this.onTokenExpired();
        }
        
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    this.refreshInFlight = runRefresh;
    return runRefresh;
  }

  /**
   * Tüm token'ları temizler
   */
  clearAllTokens() {
    if (this.refreshTimeoutId) {
      window.clearTimeout(this.refreshTimeoutId);
      this.refreshTimeoutId = null;
    }
    
    sessionStorage.removeItem(STORAGE_KEYS.ACCESS);
    sessionStorage.removeItem(STORAGE_KEYS.REFRESH);
    sessionStorage.removeItem(STORAGE_KEYS.EXPIRY);
    
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
  }

  /**
   * Mevcut access token'ı döndürür
   */
  getAccessToken() {
    return this.accessToken;
  }

  /**
   * Token geçerli mi kontrol eder
   */
  isTokenValid() {
    return Boolean(this.accessToken && (!this.expiresAt || this.expiresAt > Date.now()));
  }
}

export default TokenManager;
