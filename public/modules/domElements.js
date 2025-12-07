/**
 * DOM Elements Module
 * Tüm DOM elementlerini merkezi olarak yönetir
 */

export const DOMElements = {
  // Konteynerler
  loginContainer: document.getElementById('login-container'),
  playerContainer: document.getElementById('player-container'),

  // Playlist paneli
  playlistList: document.getElementById('playlist-list'),
  sidePanel: document.querySelector('.side-panel'),
  playlistPanelHeader: null,

  // Şu an oynatılan
  trackNameEl: document.getElementById('track-name'),
  artistNameEl: document.getElementById('artist-name'),
  albumArtEl: document.getElementById('album-art'),

  // Oynatıcı kontrolleri
  playButton: document.getElementById('play-button'),
  prevButton: document.getElementById('prev-button'),
  nextButton: document.getElementById('next-button'),

  // İlerleme çubuğu
  progressBar: document.getElementById('progress-bar'),
  progressBarContainer: document.querySelector('.progress-bar-container'),

  // Arama
  searchInput: document.getElementById('search-input'),
  searchButton: document.getElementById('search-button'),
  searchResultsList: document.getElementById('search-results'),

  // Ses kontrolleri
  volumeDownButton: document.getElementById('volume-down'),
  volumeUpButton: document.getElementById('volume-up'),
  volumeSlider: document.getElementById('volume-slider'),

  // Kuyruk
  queueListEl: document.getElementById('queue-list'),
  resumePlaybackButton: document.getElementById('resume-playback-button'),
  refreshQueueButton: document.getElementById('refresh-queue-button'),

  // Playlist detayları
  playlistDetails: document.getElementById('playlist-details'),
  playlistDetailsName: document.getElementById('playlist-details-name'),
  playlistDetailsArt: document.getElementById('playlist-details-art'),
  playlistDetailsOwner: document.getElementById('playlist-details-owner'),
  playlistTracksList: document.getElementById('playlist-tracks'),
  playlistPlayButton: document.getElementById('playlist-play-button'),
  closePlaylistDetailsButton: document.getElementById('close-playlist-details')
};

// playlistPanelHeader'ı ayarla
if (DOMElements.sidePanel) {
  DOMElements.playlistPanelHeader = DOMElements.sidePanel.querySelector('h2');
}

export default DOMElements;
