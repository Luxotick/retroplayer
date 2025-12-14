/**
 * Search Manager Module
 * Track arama işlemleri
 */

import { DOMElements } from './domElements.js';
import { PLAYLIST_TRACKING, URLS } from './constants.js';

export class SearchManager {
  constructor(tokenManager, uiHelpers) {
    this.tokenManager = tokenManager;
    this.uiHelpers = uiHelpers;
  }

  /**
   * Track/Album'leri ara
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

    if (searchResultsList.children.length === 0) {
      searchResultsList.innerHTML = '<li>Searching…</li>';
    }

    try {
      const response = await fetch(`${URLS.SERVER_URL}/search?q=${encodeURIComponent(trimmedQuery)}&type=track`, {
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`
        }
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const data = await response.json();

      // Handle both Spotify API format and simplified backend format
      const tracks = Array.isArray(data) ? data : (data.tracks?.items || []);

      // Return tracks to caller (main.js) for rendering with callbacks
      return tracks;
    } catch (error) {
      console.error('Unable to search:', error);
      this.uiHelpers.removeMarqueeTargetsWithin(searchResultsList);
      searchResultsList.innerHTML = '<li class="error">Search failed. Try again later.</li>';
      return [];
    }
  }

  /**
   * Track'lerin kaydedilip kaydedilmediğini kontrol et
   */
  async checkSavedTracks(trackIds) {
    if (!trackIds || trackIds.length === 0) return [];
    try {
      // Spotify API limit is 50, but we are searching 15 tracks so it's fine
      const response = await fetch(`${URLS.SERVER_URL}/me/tracks/contains?ids=${trackIds.join(',')}`, {
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`
        }
      });
      if (!response.ok) return new Array(trackIds.length).fill(false);
      return await response.json();
    } catch (error) {
      console.error('Error checking saved tracks:', error);
      return new Array(trackIds.length).fill(false);
    }
  }

  /**
   * Arama sonuçlarını render et
   */
  async renderSearchResults(items, callbacks = {}) {
    const { searchResultsList } = DOMElements;
    if (!searchResultsList) return;

    const { onPlay, onQueue, onLike } = callbacks;

    this.uiHelpers.removeMarqueeTargetsWithin(searchResultsList);

    if (!Array.isArray(items) || items.length === 0) {
      searchResultsList.innerHTML = '<li>No results found.</li>';
      return;
    }

    const trackIds = items.map(t => t.id).filter(Boolean);
    const likedStatuses = await this.checkSavedTracks(trackIds);

    searchResultsList.innerHTML = '';

    items.forEach((item, index) => {
      if (!item) return;

      const li = document.createElement('li');

      const titleEl = document.createElement('div');
      titleEl.className = 'track-title';
      titleEl.textContent = item.name || 'Unknown';
      li.appendChild(titleEl);
      this.uiHelpers.markMarqueeTarget(titleEl);

      const metaEl = document.createElement('div');
      metaEl.className = 'track-meta';
      const artistNames = Array.isArray(item.artists)
        ? item.artists.map(artist => artist.name).filter(Boolean).join(', ')
        : 'Unknown Artist';
      const albumName = item.album?.name || 'Unknown Album';
      const duration = this.uiHelpers.formatDuration(item.duration_ms);
      metaEl.textContent = `${artistNames} • ${albumName} • ${duration}`;
      li.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.className = 'track-actions';

      // PLAY Button
      if (typeof onPlay === 'function') {
        const playBtn = document.createElement('button');
        playBtn.textContent = 'PLAY';
        playBtn.type = 'button';
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          onPlay(item);
        });
        actions.appendChild(playBtn);
      }

      if (typeof onQueue === 'function') {
        const queueBtn = document.createElement('button');
        queueBtn.textContent = 'QUEUE';
        queueBtn.type = 'button';
        queueBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          onQueue(item);
        });
        actions.appendChild(queueBtn);
      }

      if (typeof onLike === 'function') {
        const likeBtn = document.createElement('button');
        likeBtn.className = 'like-button';
        const isLiked = likedStatuses[index];
        if (isLiked) {
          likeBtn.classList.add('liked');
          likeBtn.setAttribute('aria-label', 'Unlike Song');
        } else {
          likeBtn.setAttribute('aria-label', 'Like Song');
        }

        likeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const currentLiked = likeBtn.classList.contains('liked');
          const success = await onLike(item, currentLiked);
          if (success) {
            if (currentLiked) {
              likeBtn.classList.remove('liked');
              likeBtn.setAttribute('aria-label', 'Like Song');
            } else {
              likeBtn.classList.add('liked');
              likeBtn.setAttribute('aria-label', 'Unlike Song');
            }
          }
        });
        actions.appendChild(likeBtn);
      }

      if (actions.childElementCount > 0) {
        li.appendChild(actions);
      }

      searchResultsList.appendChild(li);
    });
  }
}

export default SearchManager;
