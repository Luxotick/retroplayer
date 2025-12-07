/**
 * Main Entry Point
 * Tüm modülleri birleştirir ve uygulamayı başlatır
 */

import { DOMElements } from './modules/domElements.js';
import { STORAGE_KEYS } from './modules/constants.js';
import { TokenManager } from './modules/tokenManager.js';
import { PlayerController } from './modules/playerController.js';
import { UIHelpers } from './modules/uiHelpers.js';
import { PlaylistManager } from './modules/playlistManager.js';
import { QueueManager } from './modules/queueManager.js';
import { SearchManager } from './modules/searchManager.js';
import { VolumeManager } from './modules/volumeManager.js';

/**
 * Ana uygulama sınıfı
 */
class RetroSpotifyPlayer {
  constructor() {
    // Modülleri başlat
    this.tokenManager = new TokenManager();
    this.uiHelpers = new UIHelpers();
    this.playerController = new PlayerController(this.tokenManager);
    this.queueManager = new QueueManager(this.tokenManager, this.uiHelpers, {
      onPlay: (uri) => this.playTrack(uri)
    });
    this.playlistManager = new PlaylistManager(
      this.tokenManager,
      this.uiHelpers,
      {
        onPlay: (track, contextPlaylist) => this.playTrack(track.uri, contextPlaylist),
        onQueue: (track) => this.queueManager.addTrackToQueue(track)
      }
    );
    this.searchManager = new SearchManager(this.tokenManager, this.uiHelpers);
    this.volumeManager = new VolumeManager(this.playerController, this.uiHelpers);

    // Event handlers
    this.setupTokenManagerHandlers();
    this.setupPlayerControllerHandlers();
  }

  /**
   * Token Manager event handlers
   */
  setupTokenManagerHandlers() {
    this.tokenManager.onTokenExpired = () => {
      this.handleTokenExpired();
    };

    this.tokenManager.onTokenRefreshed = (token) => {
      this.playerController.resetPlayerReadyPromise();
    };
  }

  /**
   * Player Controller event handlers
   */
  setupPlayerControllerHandlers() {
    this.playerController.onPlayerReady = (deviceId) => {
      this.volumeManager.enableControls();
      this.uiHelpers.enableControls();
      this.playerController.startProgressPolling((state) => {
        this.uiHelpers.updateProgress(state);
      });
    };

    this.playerController.onPlayerStateChanged = (state) => {
      if (state && state.track_window && state.track_window.current_track) {
        const currentTrack = state.track_window.current_track;
        this.uiHelpers.updateNowPlaying(currentTrack);
        this.uiHelpers.updatePlayButton(state.paused);
        this.queueManager.setCurrentlyPlaying(currentTrack);
        void this.queueManager.refreshQueue({ immediate: true });
      }
    };

    this.playerController.onPlayerError = (type, message) => {
      console.error(`Player ${type} error:`, message);
    };

    this.playerController.onAuthError = async (message) => {
      console.error('Authentication error:', message);
      await this.handleTokenExpired();
    };
  }

  /**
   * Token sona erdiğinde
   */
  handleTokenExpired() {
    this.playerController.stopProgressPolling();
    this.uiHelpers.disableControls();
    this.volumeManager.disableControls();
    this.tokenManager.clearAllTokens();
    this.uiHelpers.showLogin();
  }

  /**
   * Uygulamayı başlat
   */
  async start() {
    try {
      // Hash'den token'ları oku
      const authData = this.tokenManager.readAuthFromHash();
      if (authData.accessToken) {
        this.tokenManager.persistTokens(authData);
        this.tokenManager.clearHash();
      }

      // Kaydedilmiş token var mı kontrol et
      let accessToken = this.tokenManager.getAccessToken();

      if (!accessToken && this.tokenManager.refreshToken) {
        const refreshed = await this.tokenManager.refreshAccessToken({ force: true });
        if (refreshed) {
          accessToken = this.tokenManager.getAccessToken();
        }
      }

      // Token yoksa login göster
      if (!accessToken) {
        this.uiHelpers.showLogin();
        return;
      }

      // Uygulamayı başlat
      this.setupUI();
      await this.initializePlayer(accessToken);
      this.uiHelpers.showPlayer();

      // Playlist'leri yükle
      await this.playlistManager.fetchPlaylists();
      await this.queueManager.refreshQueue({ immediate: true });

      // Resize event listener
      window.addEventListener('resize', () => {
        this.uiHelpers.marqueeTargets.forEach(target => {
          this.uiHelpers.updateMarquee(target);
        });
      });
    } catch (error) {
      console.error('Failed to start application:', error);
      this.uiHelpers.showLogin();
    }
  }

  /**
   * UI event'lerini kur
   */
  setupUI() {
    this.uiHelpers.disableControls();
    this.volumeManager.setupControls();

    // Marquee hedeflerini işaretle
    if (DOMElements.trackNameEl) {
      this.uiHelpers.markMarqueeTarget(DOMElements.trackNameEl);
    }
    if (DOMElements.playlistDetailsName) {
      this.uiHelpers.markMarqueeTarget(DOMElements.playlistDetailsName);
    }

    // Playlist detaylarını side panel'e ekle
    if (DOMElements.sidePanel && DOMElements.playlistDetails && !DOMElements.sidePanel.contains(DOMElements.playlistDetails)) {
      DOMElements.sidePanel.appendChild(DOMElements.playlistDetails);
    }

    // Oynatıcı kontrolleri
    this.setupPlayerControls();

    // Arama
    this.setupSearchControls();

    // Playlist detayları
    this.setupPlaylistDetailControls();

    // Kuyruk kontrolleri
    this.setupQueueControls();
  }

  /**
   * Oynatıcı kontrolleri kur
   */
  setupPlayerControls() {
    const { playButton, prevButton, nextButton, progressBarContainer } = DOMElements;

    if (playButton) {
      playButton.addEventListener('click', async () => {
        await this.playerController.togglePlayPause();
        await this.queueManager.refreshQueue({ immediate: true });
      });
    }

    if (prevButton) {
      prevButton.addEventListener('click', async () => {
        await this.playerController.previousTrack();
        await this.queueManager.refreshQueue({ immediate: true });
      });
    }

    if (nextButton) {
      nextButton.addEventListener('click', async () => {
        await this.playerController.nextTrack();
        await this.queueManager.refreshQueue({ immediate: true });
      });
    }

    if (progressBarContainer) {
      progressBarContainer.addEventListener('click', async (event) => {
        if (!this.playerController.player) return;

        const rect = progressBarContainer.getBoundingClientRect();
        const clickPosition = Math.max(0, event.clientX - rect.left);
        const percent = rect.width === 0 ? 0 : clickPosition / rect.width;

        const state = await this.playerController.getCurrentState();
        if (state && typeof state.duration === 'number') {
          const seekPosition = Math.floor(state.duration * percent);
          await this.playerController.seek(seekPosition);
          this.uiHelpers.updateProgress({ duration: state.duration, position: seekPosition });
        }
      });
    }
  }

  /**
   * Arama kontrolleri kur
   */
  setupSearchControls() {
    const { searchButton, searchInput } = DOMElements;

    if (searchButton) {
      searchButton.addEventListener('click', async () => {
        const query = searchInput?.value || '';
        const tracks = await this.searchManager.searchTracks(query);
        this.searchManager.renderSearchResults(tracks, {
          onPlay: (track) => this.playTrackOrRecommendation(track),
          onQueue: (track) => this.queueManager.addTrackToQueue(track)
        });
      });
    }

    if (searchInput) {
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void searchButton?.click();
        }
      });
    }
  }

  /**
   * Playlist detay kontrolleri kur
   */
  setupPlaylistDetailControls() {
    const { playlistPlayButton, closePlaylistDetailsButton } = DOMElements;

    if (playlistPlayButton) {
      playlistPlayButton.addEventListener('click', () => {
        if (this.playlistManager.currentPlaylist) {
          this.playPlaylist(this.playlistManager.currentPlaylist);
        }
      });
    }

    if (closePlaylistDetailsButton) {
      closePlaylistDetailsButton.addEventListener('click', () => {
        this.playlistManager.closePlaylistDetails();
      });
    }

    this.playlistManager.closePlaylistDetails();
  }

  /**
   * Kuyruk kontrolleri kur
   */
  setupQueueControls() {
    const { resumePlaybackButton, refreshQueueButton } = DOMElements;

    if (resumePlaybackButton) {
      resumePlaybackButton.disabled = true;
      resumePlaybackButton.addEventListener('click', async () => {
        const state = await this.playerController.getCurrentState();
        if (!state || state.paused) {
          await this.playerController.player?.resume();
        }
      });
    }

    if (refreshQueueButton) {
      refreshQueueButton.addEventListener('click', () => {
        void this.queueManager.refreshQueue({ immediate: true });
      });
    }
  }

  /**
   * Oynatıcı başlat
   */
  async initializePlayer(token) {
    try {
      await this.playerController.initialize(token);
    } catch (error) {
      console.error('Failed to initialize player:', error);
      throw error;
    }
  }

  /**
   * Track'i oynat veya recommendation
   */
  async playTrackOrRecommendation(track) {
    const trackId = track?.id;

    if (!trackId) {
      if (track?.uri) {
        await this.playTrack(track.uri);
      }
      return;
    }

    try {
      const response = await fetch('/recommendation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trackId })
      });

      if (!response.ok) {
        throw new Error(`Recommendation endpoint responded with ${response.status}`);
      }

      const payload = await response.json();
      const playlistUri = payload?.playlistUri;

      if (!playlistUri) {
        throw new Error('Recommendation response missing playlistUri');
      }

      await this.playPlaylist({ uri: playlistUri });
      void this.queueManager.refreshQueue({ immediate: true });
    } catch (error) {
      console.error('Unable to start recommended playlist:', error);
      if (track?.uri) {
        await this.playTrack(track.uri);
      }
    }
  }

  /**
   * Track'i oynat
   */
  async playTrack(uri, context = null) {
    if (!uri) return false;

    await this.playerController.ensureReady();

    if (!this.playerController.isReady()) {
      console.warn('Player not ready yet.');
      return false;
    }

    // 1. Explicit context provided (e.g. from PlaylistManager)
    if (context && context.uri) {
      return this.playerController.play([], context.uri, { uri: uri });
    }

    // 2. Try to preserve current active context (e.g. playing from Queue)
    try {
      const state = await this.playerController.getCurrentState();
      if (state && state.context && state.context.uri) {
        const success = await this.playerController.play([], state.context.uri, { uri: uri });
        if (success) {
          return true;
        }
      }
    } catch (err) {
      console.warn('Attempt to play with context failed', err);
    }

    // 3. Fallback: Play directly (replaces queue)
    return this.playerController.play([uri]);
  }

  /**
   * Playlist'i oynat
   */
  async playPlaylist(playlist) {
    if (!playlist?.uri) return false;

    await this.playerController.ensureReady();

    if (!this.playerController.isReady()) {
      console.warn('Player not ready yet.');
      return false;
    }

    return this.playerController.play([], playlist.uri);
  }

  /**
   * Uygulamayı temizle
   */
  destroy() {
    this.playerController.destroy();
    this.uiHelpers.destroy();
  }
}

// Uygulamayı başlat
(async () => {
  const app = new RetroSpotifyPlayer();
  await app.start();

  // Global scope'a ekle (opsiyonel, debugging için)
  window.retroPlayer = app;
})();
