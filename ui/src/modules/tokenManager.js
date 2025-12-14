/**
 * Token Manager Module
 * Spotify token'ları yönetir ve refresh işlemlerini gerçekleştirir
 */

import { STORAGE_KEYS, TIMING } from './constants.js';
import { DOMElements } from './domElements.js';

const SERVER_URL = 'http://localhost:8888';

export class TokenManager {
  constructor() {
    this.accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS);
    this.refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH);
    this.expiresAt = Number(localStorage.getItem(STORAGE_KEYS.EXPIRY)) || null;
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
      localStorage.setItem(STORAGE_KEYS.ACCESS, accessToken);
      this.accessToken = accessToken;
    }
    if (refreshToken) {
      localStorage.setItem(STORAGE_KEYS.REFRESH, refreshToken);
      this.refreshToken = refreshToken;
    }
    if (typeof expiresIn === 'number' && !Number.isNaN(expiresIn) && expiresIn > 0) {
      this.setAccessTokenExpiry(expiresIn);
    }
    this.scheduleTokenRefresh(expiresIn);
  }

  // ...

  setAccessTokenExpiry(expiresInSeconds) {
    const seconds = Number(expiresInSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }

    this.expiresAt = Date.now() + seconds * 1000;
    localStorage.setItem(STORAGE_KEYS.EXPIRY, String(this.expiresAt));
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
      void this.refreshAccessToken().catch(() => { });
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
        const response = await fetch(`${SERVER_URL}/refresh_token?refresh_token=${encodeURIComponent(this.refreshToken)}`, {
          method: 'GET',
          credentials: 'omit', // Changed from same-origin to omit or include depending on CORS
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

        localStorage.setItem(STORAGE_KEYS.ACCESS, newToken);
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

    localStorage.removeItem(STORAGE_KEYS.ACCESS);
    localStorage.removeItem(STORAGE_KEYS.REFRESH);
    localStorage.removeItem(STORAGE_KEYS.EXPIRY);

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

  /**
   * Polling ile giriş yap
   */
  async loginWithPolling() {
    // Generate random state
    const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const loginUrl = `${SERVER_URL}/login?state=${state}`;

    // Open login URL in system browser
    if (window.__TAURI__) {
      await window.__TAURI__.shell.open(loginUrl);
    } else {
      window.open(loginUrl, '_blank');
    }

    // Start polling
    return new Promise((resolve, reject) => {
      const pollInterval = setInterval(async () => {
        try {
          const response = await fetch(`${SERVER_URL}/auth-check?state=${state}`);
          const data = await response.json();

          if (data && !data.pending) {
            clearInterval(pollInterval);

            this.persistTokens({
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
              expiresIn: data.expires_in
            });

            resolve(true);
          }
        } catch (error) {
          console.error('Polling error:', error);
          // Don't reject immediately, retry
        }
      }, 2000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        reject(new Error('Login timed out'));
      }, 300000);
    });
  }
}

export default TokenManager;
