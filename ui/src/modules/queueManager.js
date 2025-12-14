/**
 * Queue Manager Module
 * Kuyruk işlemleri
 */

import { DOMElements } from './domElements.js';
import { URLS } from './constants.js';

export class QueueManager {
  constructor(tokenManager, uiHelpers, callbacks = {}) {
    this.tokenManager = tokenManager;
    this.uiHelpers = uiHelpers;
    this.queueItems = [];
    this.queueCurrentlyPlaying = null;
    this.queueRefreshInFlight = null;
    this.queueDisplayLimit = null;
    this.callbacks = callbacks;
  }

  /**
   * Kuyruk state'ini güncelle
   */
  async refreshQueue(options = {}) {
    const { immediate = false } = options;
    const { queueListEl } = DOMElements;

    if (!queueListEl || !this.tokenManager.getAccessToken()) {
      return;
    }

    if (this.queueRefreshInFlight) {
      if (!immediate) {
        return this.queueRefreshInFlight;
      }

      try {
        await this.queueRefreshInFlight;
      } catch (error) {
        console.warn('Previous queue refresh failed:', error);
      }
    }

    if (!this.queueItems.length && !this.queueCurrentlyPlaying) {
      this.uiHelpers.removeMarqueeTargetsWithin(queueListEl);
      queueListEl.innerHTML = '<li>Loading queue…</li>';
    }

    const refreshPromise = (async () => {
      try {
        const response = await fetch(`${URLS.SPOTIFY_API_BASE}/me/player/queue`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.tokenManager.getAccessToken()}`
          }
        });

        if (response.status === 204) {
          this.queueCurrentlyPlaying = null;
          this.queueItems = [];
          this.queueDisplayLimit = 0;
          this.render();
          return;
        }

        if (!response.ok) {
          throw new Error(`Spotify responded with status ${response.status}`);
        }

        const payload = await response.json();
        this.queueCurrentlyPlaying = payload?.currently_playing ?? null;
        const normalizedQueue = this.sanitizeQueueItems(this.queueCurrentlyPlaying, payload?.queue);

        if (this.queueDisplayLimit === null || normalizedQueue.length > this.queueDisplayLimit) {
          this.queueDisplayLimit = normalizedQueue.length;
        }

        const limit = this.queueDisplayLimit ?? normalizedQueue.length;
        this.queueItems = normalizedQueue.slice(0, limit);
        this.render();
      } catch (error) {
        console.error('Unable to refresh queue:', error);
        if (queueListEl) {
          this.uiHelpers.removeMarqueeTargetsWithin(queueListEl);
          queueListEl.innerHTML = '<li class="error">Unable to load queue.</li>';
        }
      }
    })();

    this.queueRefreshInFlight = refreshPromise.finally(() => {
      this.queueRefreshInFlight = null;
    });

    return this.queueRefreshInFlight;
  }

  /**
   * Track'i kuyruka ekle
   */
  async addTrackToQueue(track) {
    if (!track || !track.uri) {
      return false;
    }

    if (!this.tokenManager.getAccessToken()) {
      return false;
    }

    try {
      const url = new URL(`${URLS.SPOTIFY_API_BASE}/me/player/queue`);
      url.searchParams.set('uri', track.uri);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`
        }
      });

      if (!response.ok) {
        throw new Error(`Spotify responded with status ${response.status}`);
      }

      await this.refreshQueue({ immediate: true });
      return true;
    } catch (error) {
      console.error('Unable to add track to queue:', error);
      return false;
    }
  }

  /**
   * Kuyruk item açıklamasını oluştur
   */
  describeQueueItem(item) {
    if (!item) {
      return {
        title: 'Unknown item',
        meta: ''
      };
    }

    const title = item.name || 'Unknown item';

    const artistNames = Array.isArray(item.artists)
      ? item.artists.map(artist => artist?.name).filter(Boolean)
      : [];

    if (!artistNames.length && item.show?.name) {
      artistNames.push(item.show.name);
    }

    if (!artistNames.length && item.publisher) {
      artistNames.push(item.publisher);
    }

    const albumName = item.album?.name || '';
    const duration = item.duration_ms ? this.uiHelpers.formatDuration(item.duration_ms) : '';

    const metaParts = [
      artistNames.join(', '),
      albumName,
      duration
    ].filter(Boolean);

    return {
      title,
      meta: metaParts.join(' • ')
    };
  }

  /**
   * Queue item'larını temizle
   */
  sanitizeQueueItems(currentItem, items) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const normalized = items.filter(item => item && typeof item === 'object' && item.uri);
    if (!normalized.length) {
      return [];
    }

    const nowUri = currentItem?.uri;
    if (nowUri && normalized.every(item => item.uri === nowUri)) {
      return [];
    }

    return normalized;
  }

  /**
   * Kuyruk item'ı render et
   */
  buildQueueListItem(item, onPlayClick, options = {}) {
    const { label, highlight = false } = options;
    const { title, meta } = this.describeQueueItem(item);

    const li = document.createElement('li');

    if (highlight) {
      li.classList.add('current');
    }

    const titleEl = document.createElement('div');
    titleEl.className = 'queue-title';
    titleEl.textContent = label ? `${label}: ${title}` : title;
    li.appendChild(titleEl);
    this.uiHelpers.markMarqueeTarget(titleEl);

    if (meta) {
      const metaEl = document.createElement('div');
      metaEl.className = 'track-meta';
      metaEl.textContent = meta;
      li.appendChild(metaEl);
    }

    if (item?.uri) {
      // Remove play button, make row clickable
      li.addEventListener('click', () => onPlayClick?.(item.uri));
      // Add visual cue for clickability via CSS (done in style.css)
      li.title = "Click to play";

      // Optional: keep track actions container if we want other buttons later, but for now user asked to remove play button.
      // We can keep it empty or remove it.
      // If we want to keep consistent layout, we might need it. 
      // But "queue list" usually doesn't need big actions if it's just click to play.
    }

    return li;
  }

  /**
   * Kuyruk listesini render et
   */
  render() {
    const { queueListEl } = DOMElements;
    if (!queueListEl) return;

    const { onPlay } = this.callbacks || {};

    this.uiHelpers.removeMarqueeTargetsWithin(queueListEl);
    queueListEl.innerHTML = '';

    if (this.queueCurrentlyPlaying) {
      const nowItem = this.buildQueueListItem(
        this.queueCurrentlyPlaying,
        onPlay,
        { label: 'Now playing', highlight: true }
      );
      queueListEl.appendChild(nowItem);
    }

    if (!Array.isArray(this.queueItems) || this.queueItems.length === 0) {
      if (this.queueCurrentlyPlaying) {
        const emptyNext = document.createElement('li');
        emptyNext.className = 'empty';
        emptyNext.textContent = 'No upcoming tracks.';
        queueListEl.appendChild(emptyNext);
      } else {
        queueListEl.innerHTML = '<li class="empty">Queue is empty.</li>';
      }
      return;
    }

    this.queueItems.forEach(item => {
      const queueItem = this.buildQueueListItem(item, onPlay);
      queueListEl.appendChild(queueItem);
    });
  }

  /**
   * Şu an oynatılan track'i ayarla
   */
  setCurrentlyPlaying(track) {
    this.queueCurrentlyPlaying = track;
  }

  /**
   * Şu an oynatılan track'i al
   */
  getCurrentlyPlaying() {
    return this.queueCurrentlyPlaying;
  }
}

export default QueueManager;
