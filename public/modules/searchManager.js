/**
 * Search Manager Module
 * Track arama işlemleri
 */

import { DOMElements } from './domElements.js';
import { PLAYLIST_TRACKING } from './constants.js';

export class SearchManager {
  constructor(tokenManager, uiHelpers) {
    this.tokenManager = tokenManager;
    this.uiHelpers = uiHelpers;
  }

  /**
   * Track'leri ara
   */
  async searchTracks(query) {
    const { searchResultsList } = DOMElements;
    if (!searchResultsList) return [];

    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      this.uiHelpers.removeMarqueeTargetsWithin(searchResultsList);
      searchResultsList.innerHTML = '<li class="error">Enter a search phrase.</li>';
      return [];
    }

    this.uiHelpers.removeMarqueeTargetsWithin(searchResultsList);
    searchResultsList.innerHTML = '<li>Searching…</li>';

    try {
      const response = await fetch(`/search?q=${encodeURIComponent(trimmedQuery)}`, {
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`
        }
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const tracks = await response.json();
      this.renderSearchResults(tracks);
      return tracks;
    } catch (error) {
      console.error('Unable to search tracks:', error);
      this.uiHelpers.removeMarqueeTargetsWithin(searchResultsList);
      searchResultsList.innerHTML = '<li class="error">Search failed. Try again later.</li>';
      return [];
    }
  }

  /**
   * Arama sonuçlarını render et
   */
  renderSearchResults(tracks, callbacks = {}) {
    const { searchResultsList } = DOMElements;
    if (!searchResultsList) return;

    const { onPlay, onQueue } = callbacks;

    this.uiHelpers.removeMarqueeTargetsWithin(searchResultsList);

    if (!Array.isArray(tracks) || tracks.length === 0) {
      searchResultsList.innerHTML = '<li>No results found.</li>';
      return;
    }

    searchResultsList.innerHTML = '';

    tracks.forEach(track => {
      if (!track) return;

      const li = document.createElement('li');

      const titleEl = document.createElement('div');
      titleEl.className = 'track-title';
      titleEl.textContent = track.name || 'Unknown Track';
      li.appendChild(titleEl);
      this.uiHelpers.markMarqueeTarget(titleEl);

      const metaEl = document.createElement('div');
      metaEl.className = 'track-meta';
      const artistNames = Array.isArray(track.artists)
        ? track.artists.map(artist => artist.name).filter(Boolean).join(', ')
        : 'Unknown Artist';
      const albumName = track.album?.name || 'Unknown Album';
      const duration = this.uiHelpers.formatDuration(track.duration_ms);
      metaEl.textContent = `${artistNames} • ${albumName} • ${duration}`;
      li.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.className = 'track-actions';

      if (typeof onPlay === 'function') {
        const playBtn = document.createElement('button');
        playBtn.textContent = 'PLAY';
        playBtn.type = 'button';
        playBtn.addEventListener('click', () => onPlay(track));
        actions.appendChild(playBtn);
      }

      if (typeof onQueue === 'function') {
        const queueBtn = document.createElement('button');
        queueBtn.textContent = 'QUEUE';
        queueBtn.type = 'button';
        queueBtn.addEventListener('click', () => onQueue(track));
        actions.appendChild(queueBtn);
      }

      if (actions.childElementCount > 0) {
        li.appendChild(actions);
      }

      searchResultsList.appendChild(li);
    });
  }
}

export default SearchManager;
