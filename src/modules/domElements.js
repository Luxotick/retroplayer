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

  // Now playing panel
  nowPlayingPanel: document.querySelector('.now-playing-panel'),

  // Şu an oynatılan
  trackNameEl: document.getElementById('track-name'),
  artistNameEl: document.getElementById('artist-name'),
  albumArtEl: document.getElementById('album-art'),
  likeButton: document.getElementById('like-button'),

  // Oynatıcı kontrolleri
  playButton: document.getElementById('play-button'),
  prevButton: document.getElementById('prev-button'),
  nextButton: document.getElementById('next-button'),

  // İlerleme çubuğu
  progressBar: document.getElementById('progress-bar'),
  progressBarContainer: document.querySelector('.progress-bar-container'),
  timeDisplay: document.getElementById('time-display'),
  volumePercent: document.getElementById('volume-percent'),

  // Arama
  searchInput: document.getElementById('search-input'),
  searchButton: document.getElementById('search-button'),
  searchResultsList: document.getElementById('search-results'),
  minimizeSearchButton: document.getElementById('minimize-search-button'),
  searchSection: document.querySelector('.search-section'),

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
  closePlaylistDetailsButton: document.getElementById('close-playlist-details'),

  // Lyrics
  lyricsButton: document.getElementById('lyrics-button'),
  lyricsContainer: document.getElementById('lyrics-container'),
  lyricsContent: document.getElementById('lyrics-content'),
  lyricsLoading: document.getElementById('lyrics-loading')
};

// playlistPanelHeader'ı ayarla
if (DOMElements.sidePanel) {
  DOMElements.playlistPanelHeader = DOMElements.sidePanel.querySelector('h2');
}

export default DOMElements;
