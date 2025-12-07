/**
 * Playlist Manager Module
 * Playlist'leri yönetir ve track'leri gösterir
 */

import { DOMElements } from './domElements.js';
import { URLS, PLAYLIST_TRACKING } from './constants.js';

export class PlaylistManager {
  constructor(tokenManager, uiHelpers, callbacks = {}) {
    this.tokenManager = tokenManager;
    this.uiHelpers = uiHelpers;
    this.callbacks = callbacks;
    this.currentPlaylist = null;
    this.selectedPlaylistElement = null;
  }

  /**
   * Playlist'leri API'den al
   */
  async fetchPlaylists() {
    const { playlistList } = DOMElements;
    if (!playlistList) return [];

    try {
      this.uiHelpers.removeMarqueeTargetsWithin(playlistList);
      playlistList.innerHTML = '<li>Loading playlists…</li>';

      const token = this.tokenManager.getAccessToken();
      if (!token) {
        throw new Error('Access token unavailable');
      }

      const response = await fetch('/me/playlists', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const playlists = await response.json();
      this.renderPlaylists(playlists);
      return playlists;
    } catch (error) {
      console.error('Unable to fetch playlists:', error);
      this.uiHelpers.removeMarqueeTargetsWithin(playlistList);
      playlistList.innerHTML = '<li class="error">Failed to load playlists. Try logging in again.</li>';
      return [];
    }
  }

  /**
   * Playlist'leri render et
   */
  renderPlaylists(playlists) {
    const { playlistList } = DOMElements;
    if (!playlistList) return;

    if (!Array.isArray(playlists) || playlists.length === 0) {
      this.uiHelpers.removeMarqueeTargetsWithin(playlistList);
      playlistList.innerHTML = '<li>No playlists found.</li>';
      return;
    }

    this.uiHelpers.removeMarqueeTargetsWithin(playlistList);
    playlistList.innerHTML = '';

    playlists.forEach(playlist => {
      const li = document.createElement('li');
      li.textContent = playlist.name;
      li.addEventListener('click', () => this.selectPlaylist(playlist, li));
      playlistList.appendChild(li);
      this.uiHelpers.markMarqueeTarget(li);
    });
  }

  /**
   * Playlist seç
   */
  selectPlaylist(playlist, element) {
    if (!playlist) return;

    const isSamePlaylist = this.currentPlaylist && this.currentPlaylist.id === playlist.id;
    if (isSamePlaylist && this.isPlaylistDetailsVisible()) {
      this.closePlaylistDetails();
      return;
    }

    this.currentPlaylist = playlist;
    this.highlightPlaylist(element);
    this.openPlaylistDetails(playlist);
    this.fetchPlaylistTracks(playlist.id);
  }

  /**
   * Playlist'i vurgula
   */
  highlightPlaylist(element) {
    if (!element) return;

    if (this.selectedPlaylistElement && this.selectedPlaylistElement !== element) {
      this.selectedPlaylistElement.classList.remove('active');
    }

    this.selectedPlaylistElement = element;
    element.classList.add('active');
  }

  /**
   * Playlist detaylarını aç
   */
  openPlaylistDetails(playlist) {
    const {
      playlistDetails,
      playlistDetailsName,
      playlistDetailsArt,
      playlistDetailsOwner,
      playlistPanelHeader,
      playlistList,
      sidePanel,
      playlistTracksList,
      playlistPlayButton
    } = DOMElements;

    if (!playlistDetails || !playlistDetailsName) return;

    playlistDetailsName.textContent = playlist.name;
    playlistDetailsName.title = playlist.name || '';

    if (playlistDetailsOwner) {
      const ownerName = playlist.owner?.display_name;
      playlistDetailsOwner.textContent = ownerName ? `by ${ownerName}` : '';
    }

    if (playlistDetailsArt) {
      const imageUrl = playlist.images?.[0]?.url || URLS.PLACEHOLDER_PLAYLIST_ART;
      playlistDetailsArt.src = imageUrl;
      playlistDetailsArt.alt = `${playlist.name} cover art`;
    }

    if (playlistPanelHeader) {
      playlistPanelHeader.classList.add('hidden');
    }
    if (playlistList) {
      playlistList.classList.add('hidden');
    }
    if (sidePanel) {
      sidePanel.classList.add('showing-details');
    }

    playlistDetails.classList.remove('hidden');
    this.uiHelpers.markMarqueeTarget(playlistDetailsName);

    if (playlistTracksList) {
      this.uiHelpers.removeMarqueeTargetsWithin(playlistTracksList);
      playlistTracksList.innerHTML = '<li>Loading tracks…</li>';
    }

    if (playlistPlayButton) {
      playlistPlayButton.disabled = false;
    }
  }

  /**
   * Playlist detaylarını kapat
   */
  closePlaylistDetails() {
    const {
      playlistDetails,
      playlistPanelHeader,
      playlistList,
      sidePanel,
      playlistTracksList,
      playlistPlayButton,
      playlistDetailsName,
      playlistDetailsOwner,
      playlistDetailsArt
    } = DOMElements;

    if (playlistDetails) {
      playlistDetails.classList.add('hidden');
    }

    if (playlistPanelHeader) {
      playlistPanelHeader.classList.remove('hidden');
    }

    if (playlistList) {
      playlistList.classList.remove('hidden');
    }

    if (sidePanel) {
      sidePanel.classList.remove('showing-details');
    }

    if (playlistTracksList) {
      this.uiHelpers.removeMarqueeTargetsWithin(playlistTracksList);
      playlistTracksList.innerHTML = '';
    }

    if (playlistPlayButton) {
      playlistPlayButton.disabled = true;
    }

    if (playlistDetailsName) {
      playlistDetailsName.textContent = 'Playlist';
      playlistDetailsName.removeAttribute('title');
    }

    if (playlistDetailsOwner) {
      playlistDetailsOwner.textContent = '';
    }

    if (playlistDetailsArt) {
      playlistDetailsArt.src = URLS.PLACEHOLDER_PLAYLIST_ART;
      playlistDetailsArt.alt = 'Playlist Art';
    }

    if (this.selectedPlaylistElement) {
      this.selectedPlaylistElement.classList.remove('active');
      this.selectedPlaylistElement = null;
    }

    this.currentPlaylist = null;
  }

  /**
   * Playlist detayları visible mi?
   */
  isPlaylistDetailsVisible() {
    const { playlistDetails } = DOMElements;
    return Boolean(playlistDetails && !playlistDetails.classList.contains('hidden'));
  }

  /**
   * Playlist track'lerini al
   */
  async fetchPlaylistTracks(playlistId) {
    const { playlistTracksList } = DOMElements;
    if (!playlistTracksList) return [];

    try {
      const response = await fetch(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        headers: {
          Authorization: `Bearer ${this.tokenManager.getAccessToken()}`
        }
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const data = await response.json();
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];

      if (this.currentPlaylist && this.currentPlaylist.id === playlistId) {
        this.renderTrackList(playlistTracksList, tracks, this.callbacks, this.currentPlaylist);
      }

      return tracks;
    } catch (error) {
      console.error('Unable to fetch playlist tracks:', error);
      if (this.currentPlaylist && this.currentPlaylist.id === playlistId) {
        this.uiHelpers.removeMarqueeTargetsWithin(playlistTracksList);
        playlistTracksList.innerHTML = '<li class="error">Failed to load tracks.</li>';
      }
      return [];
    }
  }

  /**
   * Track listesini render et
   */
  renderTrackList(listElement, tracks, callbacks = {}, contextPlaylist = null) {
    if (!listElement) return;

    const { onPlay, onQueue } = callbacks;

    this.uiHelpers.removeMarqueeTargetsWithin(listElement);

    if (!Array.isArray(tracks) || tracks.length === 0) {
      listElement.innerHTML = '<li>No tracks found.</li>';
      return;
    }

    listElement.innerHTML = '';

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
        playBtn.addEventListener('click', () => onPlay(track, contextPlaylist));
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

      listElement.appendChild(li);
    });
  }
}

export default PlaylistManager;
