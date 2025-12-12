/**
 * Player Controller Module
 * Spotify Player'ı başlatır ve kontrol eder
 */

import { TIMING, URLS } from './constants.js';
import { DOMElements } from './domElements.js';

export class PlayerController {
  constructor(tokenManager) {
    this.tokenManager = tokenManager;
    this.player = null;
    this.deviceId = null;
    this.playerReadyResolver = null;
    this.playerReadyPromise = this.createPlayerReadyPromise();
    this.hasTransferredPlayback = false;
    this.progressIntervalId = null;
    this.lastTrackUri = null;

    this.onPlayerReady = null;
    this.onPlayerStateChanged = null;
    this.onPlayerError = null;
    this.onAuthError = null;
  }

  /**
   * Spotify SDK hazır mı kontrol eder
   */
  async waitForSDK() {
    if (window.Spotify && window.Spotify.Player) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      if (typeof window.onSpotifyWebPlaybackSDKReady.subscribe === 'function') {
        window.onSpotifyWebPlaybackSDKReady.subscribe(resolve);
      } else {
        // Fallback if already defined essentially or logic differs
        const old = window.onSpotifyWebPlaybackSDKReady;
        window.onSpotifyWebPlaybackSDKReady = () => {
          if (typeof old === 'function') old();
          resolve();
        }
      }
    });
  }

  /**
   * Oynatıcıyı başlatır
   */
  async initialize(token) {
    try {
      await this.waitForSDK();
      this.resetPlayerReadyPromise();

      this.player = new window.Spotify.Player({
        name: 'Retro Spotify Player',
        getOAuthToken: cb => cb(this.tokenManager.getAccessToken() || token),
        volume: 0.5
      });

      this.setupPlayerListeners();
      await this.player.connect();
    } catch (error) {
      console.error('Unable to initialize Spotify Player:', error);
      this.resolvePlayerReady();
      throw error;
    }
  }

  /**
   * Oynatıcı event listeners'ını ayarlar
   */
  setupPlayerListeners() {
    this.player.addListener('ready', ({ device_id }) => {
      this.deviceId = device_id;
      if (this.onPlayerReady) {
        this.onPlayerReady(device_id);
      }

      void (async () => {
        try {
          await this.transferPlayback(device_id);
        } finally {
          this.resolvePlayerReady();
        }
      })();
    });

    this.player.addListener('not_ready', () => {
      this.deviceId = null;
      this.resetPlayerReadyPromise();
    });

    this.player.addListener('initialization_error', ({ message }) => {
      console.error('Player initialization failed:', message);
      if (this.onPlayerError) {
        this.onPlayerError('initialization', message);
      }
      this.resolvePlayerReady();
    });

    this.player.addListener('authentication_error', async ({ message }) => {
      console.error('Authentication error:', message);
      const refreshed = await this.tokenManager.refreshAccessToken({ force: true });

      if (!refreshed && this.onAuthError) {
        this.onAuthError(message);
      }
      this.resolvePlayerReady();
    });

    this.player.addListener('account_error', ({ message }) => {
      console.error('Account error:', message);
      if (this.onPlayerError) {
        this.onPlayerError('account', message);
      }
    });

    this.player.addListener('player_state_changed', state => {
      if (!state || !state.track_window || !state.track_window.current_track) {
        return;
      }

      const currentTrack = state.track_window.current_track;
      const currentUri = currentTrack.uri;

      if (currentUri && currentUri !== this.lastTrackUri) {
        this.lastTrackUri = currentUri;
      }

      if (this.onPlayerStateChanged) {
        this.onPlayerStateChanged(state);
      }
    });
  }

  /**
   * Oynatmayı başlatır
   */
  async play(uris, contextUri = null, offset = null) {
    if (!this.isReady()) {
      console.warn('Player not ready yet.');
      return false;
    }

    try {
      let body = {};

      if (contextUri) {
        body.context_uri = contextUri;
        if (offset) {
          body.offset = offset;
        }
      } else {
        body.uris = uris;
      }

      await fetch(`${URLS.SPOTIFY_API_BASE}/me/player/play?device_id=${encodeURIComponent(this.deviceId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      return true;
    } catch (error) {
      console.error('Unable to play:', error);
      return false;
    }
  }

  /**
   * Geçerli state'i döndürür
   */
  async getCurrentState() {
    if (!this.player) {
      return null;
    }

    try {
      return await this.player.getCurrentState();
    } catch (error) {
      console.error('Unable to get player state:', error);
      return null;
    }
  }

  /**
   * Devam ettir/Duraklat
   */
  async togglePlayPause() {
    if (!this.player) {
      return false;
    }

    try {
      const state = await this.player.getCurrentState();
      if (!state || state.paused) {
        await this.player.resume();
      } else {
        await this.player.pause();
      }
      return true;
    } catch (error) {
      console.error('Unable to toggle playback:', error);
      return false;
    }
  }

  /**
   * Önceki track'e git
   */
  async previousTrack() {
    if (!this.player) {
      return false;
    }

    try {
      await this.player.previousTrack();
      return true;
    } catch (error) {
      console.error('Unable to go to previous track:', error);
      return false;
    }
  }

  /**
   * Sonraki track'e atla
   */
  async nextTrack() {
    if (!this.player) {
      return false;
    }

    try {
      await this.player.nextTrack();
      return true;
    } catch (error) {
      console.error('Unable to skip to next track:', error);
      return false;
    }
  }

  /**
   * Ses seviyesini ayarla
   */
  async setVolume(value) {
    const clamped = Math.min(1, Math.max(0, value));

    if (!this.player) {
      return false;
    }

    try {
      await this.ensureReady();
      await this.player.setVolume(clamped);
      return true;
    } catch (error) {
      console.error('Unable to set volume:', error);
      return false;
    }
  }

  /**
   * Seek işlemi
   */
  async seek(position) {
    if (!this.player) {
      return false;
    }

    try {
      await this.player.seek(position);
      return true;
    } catch (error) {
      console.error('Unable to seek:', error);
      return false;
    }
  }

  /**
   * Oynatmayı cihaza transfer eder
   */
  async transferPlayback(deviceId, play = false) {
    if (!deviceId) {
      return false;
    }

    try {
      const response = await fetch(`${URLS.SPOTIFY_API_BASE}/me/player`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play
        })
      });

      if (!response.ok) {
        throw new Error(`Spotify responded with status ${response.status}`);
      }

      this.hasTransferredPlayback = true;
      return true;
    } catch (error) {
      console.error('Unable to transfer playback:', error);
      this.hasTransferredPlayback = false;
      return false;
    }
  }

  /**
   * Oynatıcının hazır olmasını bekle
   */
  async ensureReady() {
    await this.playerReadyPromise;
  }

  /**
   * Oynatıcı hazır mı kontrol eder
   */
  isReady() {
    return Boolean(this.player && this.deviceId && this.tokenManager.getAccessToken());
  }

  /**
   * İlerleme polling'ini başlat
   */
  startProgressPolling(onProgress) {
    this.stopProgressPolling();

    this.progressIntervalId = window.setInterval(async () => {
      if (!this.player) return;

      try {
        const state = await this.player.getCurrentState();
        if (onProgress && state) {
          onProgress(state);
        }
      } catch (error) {
        console.error('Unable to poll player state:', error);
      }
    }, TIMING.PROGRESS_UPDATE_MS);
  }

  /**
   * İlerleme polling'ini durdur
   */
  stopProgressPolling() {
    if (typeof this.progressIntervalId === 'number') {
      window.clearInterval(this.progressIntervalId);
      this.progressIntervalId = null;
    }
  }

  /**
   * Oynatıcı hazır promise'ı oluştur
   */
  createPlayerReadyPromise() {
    return new Promise(resolve => {
      this.playerReadyResolver = resolve;
    });
  }

  /**
   * Oynatıcı hazır promise'ı reset et
   */
  resetPlayerReadyPromise() {
    this.playerReadyPromise = this.createPlayerReadyPromise();
    this.hasTransferredPlayback = false;
  }

  /**
   * Oynatıcı hazır promise'ı resolve et
   */
  resolvePlayerReady() {
    if (typeof this.playerReadyResolver === 'function') {
      this.playerReadyResolver();
      this.playerReadyResolver = null;
    }
  }

  /**
   * Cihaz ID'sini döndür
   */
  getDeviceId() {
    return this.deviceId;
  }

  /**
   * Track'in beğenilip beğenilmediğini kontrol et
   */
  async checkIfLiked(trackId) {
    if (!trackId) return false;
    try {
      const response = await fetch(`${URLS.SERVER_URL}/me/tracks/contains?ids=${trackId}`, {
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`
        }
      });
      if (!response.ok) return false;
      const data = await response.json();
      return data[0] === true;
    } catch (error) {
      console.error('Error checking liked status:', error);
      return false;
    }
  }

  /**
   * Track'i beğen/beğenmekten vazgeç
   */
  async toggleLike(trackId, isLiked) {
    if (!trackId) return false;
    const method = isLiked ? 'DELETE' : 'PUT';
    try {
      const response = await fetch(`${URLS.SERVER_URL}/me/tracks`, {
        method: method,
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: [trackId] })
      });
      return response.ok;
    } catch (error) {
      console.error('Error toggling like:', error);
      return false;
    }
  }

  /**
   * Temizle
   */
  destroy() {
    this.stopProgressPolling();
    if (this.player) {
      void this.player.disconnect().catch(() => { });
    }
    this.player = null;
    this.deviceId = null;
  }
}

export default PlayerController;
