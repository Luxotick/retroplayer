(async function () {
  const loginContainer = document.getElementById('login-container');
  const playerContainer = document.getElementById('player-container');
  const playlistList = document.getElementById('playlist-list');
  const trackNameEl = document.getElementById('track-name');
  const artistNameEl = document.getElementById('artist-name');
  const albumArtEl = document.getElementById('album-art');
  const playButton = document.getElementById('play-button');
  const prevButton = document.getElementById('prev-button');
  const nextButton = document.getElementById('next-button');
  const progressBar = document.getElementById('progress-bar');
  const progressBarContainer = document.querySelector('.progress-bar-container');
  const searchInput = document.getElementById('search-input');
  const searchButton = document.getElementById('search-button');
  const searchResultsList = document.getElementById('search-results');
  const volumeDownButton = document.getElementById('volume-down');
  const volumeUpButton = document.getElementById('volume-up');
  const volumeSlider = document.getElementById('volume-slider');
  const queueListEl = document.getElementById('queue-list');
  const resumePlaybackButton = document.getElementById('resume-playback-button');
  const refreshQueueButton = document.getElementById('refresh-queue-button');
  const playlistDetails = document.getElementById('playlist-details');
  const playlistDetailsName = document.getElementById('playlist-details-name');
  const playlistDetailsArt = document.getElementById('playlist-details-art');
  const playlistDetailsOwner = document.getElementById('playlist-details-owner');
  const playlistTracksList = document.getElementById('playlist-tracks');
  const playlistPlayButton = document.getElementById('playlist-play-button');
  const closePlaylistDetailsButton = document.getElementById('close-playlist-details');
  const sidePanel = document.querySelector('.side-panel');
  const playlistPanelHeader = sidePanel ? sidePanel.querySelector('h2') : null;

  const STORAGE_KEY_ACCESS = 'spotifyAccessToken';
  const STORAGE_KEY_REFRESH = 'spotifyRefreshToken';
  const STORAGE_KEY_EXPIRY = 'spotifyAccessTokenExpiresAt';
  const PROGRESS_UPDATE_MS = 1000;
  const PLACEHOLDER_ALBUM_ART = 'https://via.placeholder.com/150';
  const PLACEHOLDER_PLAYLIST_ART = 'https://via.placeholder.com/120';
  const marqueeTargets = new Set();
  const marqueeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entries => {
        entries.forEach(entry => {
          updateMarquee(entry.target);
        });
      })
    : null;

  let player;
  let deviceId;
  let latestToken;
  let progressIntervalId;
  let currentPlaylist;
  let selectedPlaylistElement;
  let playerReadyResolver;
  let playerReadyPromise = createPlayerReadyPromise();
  let hasTransferredPlayback = false;
  let latestVolume = 0.5;
  let queueItems = [];
  let queueCurrentlyPlaying;
  let queueRefreshInFlight = null;
  let queueDisplayLimit = null;
  let refreshTokenValue = sessionStorage.getItem(STORAGE_KEY_REFRESH);
  let accessTokenExpiresAt = Number(sessionStorage.getItem(STORAGE_KEY_EXPIRY)) || null;
  let refreshTimeoutId;
  let refreshInFlight;
  let lastTrackUri;

  const sdkReadyPromise = (function createSdkPromise() {
    if (window.Spotify && window.Spotify.Player) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      const previousCallback = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (typeof previousCallback === 'function') {
          previousCallback();
        }
        resolve();
      };
    });
  })();

  disableControls();

  if (trackNameEl) {
    markMarqueeTarget(trackNameEl);
  }
  if (playlistDetailsName) {
    markMarqueeTarget(playlistDetailsName);
  }

  if (sidePanel && playlistDetails && !sidePanel.contains(playlistDetails)) {
    sidePanel.appendChild(playlistDetails);
  }

  const authData = readAuthFromHash();
  if (authData.accessToken) {
    persistTokens(authData);
    clearHash();
  }

  let accessToken = sessionStorage.getItem(STORAGE_KEY_ACCESS);

  if (!accessToken && refreshTokenValue) {
    const refreshed = await refreshAccessToken({ force: true });
    if (refreshed) {
      accessToken = sessionStorage.getItem(STORAGE_KEY_ACCESS);
    }
  }

  if (!accessToken) {
    showLogin();
    return;
  }

  latestToken = accessToken;
  scheduleTokenRefresh();

  showPlayer();
  wireControls();
  setupSearch();
  setupPlaylistDetailControls();
  setupVolumeControls();
  setupQueueControls();
  renderQueue();
  void refreshQueue({ immediate: true });
  fetchPlaylists();
  initializePlayer(accessToken);

  function readAuthFromHash() {
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

  function persistTokens({ accessToken, refreshToken, expiresIn }) {
    if (accessToken) {
      sessionStorage.setItem(STORAGE_KEY_ACCESS, accessToken);
      latestToken = accessToken;
    }
    if (refreshToken) {
      sessionStorage.setItem(STORAGE_KEY_REFRESH, refreshToken);
      refreshTokenValue = refreshToken;
    }
    if (typeof expiresIn === 'number' && !Number.isNaN(expiresIn) && expiresIn > 0) {
      setAccessTokenExpiry(expiresIn);
    }
    scheduleTokenRefresh(expiresIn);
  }

  function clearHash() {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, document.title, window.location.pathname);
    } else {
      window.location.hash = '';
    }
  }

  function showLogin() {
    loginContainer.classList.remove('hidden');
    playerContainer.classList.add('hidden');
    closePlaylistDetails();
    if (refreshTimeoutId) {
      window.clearTimeout(refreshTimeoutId);
      refreshTimeoutId = undefined;
    }
  }

  function showPlayer() {
    loginContainer.classList.add('hidden');
    playerContainer.classList.remove('hidden');
  }

  function setAccessTokenExpiry(expiresInSeconds) {
    const seconds = Number(expiresInSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }

    accessTokenExpiresAt = Date.now() + seconds * 1000;
    sessionStorage.setItem(STORAGE_KEY_EXPIRY, String(accessTokenExpiresAt));
  }

  function scheduleTokenRefresh(expiresInSeconds) {
    const seconds = Number(expiresInSeconds);
    if (Number.isFinite(seconds) && seconds > 0) {
      setAccessTokenExpiry(seconds);
    }

    if (!refreshTokenValue || !accessTokenExpiresAt) {
      return;
    }

    if (refreshTimeoutId) {
      window.clearTimeout(refreshTimeoutId);
      refreshTimeoutId = undefined;
    }

    const refreshLeadMs = 60_000;
    let delay = accessTokenExpiresAt - Date.now() - refreshLeadMs;
    if (delay <= 0) {
      delay = 0;
    }

    refreshTimeoutId = window.setTimeout(() => {
      refreshTimeoutId = undefined;
      void refreshAccessToken().catch(() => {});
    }, delay);
  }

  async function refreshAccessToken(options = {}) {
    const { force = false } = options;

    if (!refreshTokenValue) {
      return false;
    }

    if (refreshInFlight && !force) {
      return refreshInFlight;
    }

    const runRefresh = (async () => {
      try {
        const response = await fetch(`/refresh_token?refresh_token=${encodeURIComponent(refreshTokenValue)}`, {
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

        sessionStorage.setItem(STORAGE_KEY_ACCESS, newToken);
        latestToken = newToken;

        if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
          scheduleTokenRefresh(expiresInSeconds);
        } else {
          scheduleTokenRefresh();
        }

        return true;
      } catch (error) {
        console.error('Unable to refresh access token:', error);
        if (refreshTimeoutId) {
          window.clearTimeout(refreshTimeoutId);
          refreshTimeoutId = undefined;
        }
        sessionStorage.removeItem(STORAGE_KEY_ACCESS);
        sessionStorage.removeItem(STORAGE_KEY_REFRESH);
        sessionStorage.removeItem(STORAGE_KEY_EXPIRY);
        accessTokenExpiresAt = null;
        latestToken = undefined;
        refreshTokenValue = null;
        disableControls();
        stopProgressPolling();
        showLogin();
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();

    refreshInFlight = runRefresh;
    return runRefresh;
  }

  async function initializePlayer(token) {
    try {
      await sdkReadyPromise;
      resetPlayerReadyPromise();
      player = new window.Spotify.Player({
        name: 'Retro Spotify Player',
        getOAuthToken: cb => cb(latestToken || token),
        volume: 0.5
      });

      player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        enableControls();
        if (volumeSlider) {
          volumeSlider.disabled = false;
          volumeSlider.value = Math.round(latestVolume * 100);
        }
        if (volumeDownButton) {
          volumeDownButton.disabled = false;
        }
        if (volumeUpButton) {
          volumeUpButton.disabled = false;
        }
        void setVolume(latestVolume, { updateSlider: false });
        startProgressPolling();

        void (async () => {
          try {
            await transferPlayback(device_id);
          } finally {
            resolvePlayerReady();
          }
        })();
      });

      player.addListener('not_ready', () => {
        deviceId = undefined;
        disableControls();
        stopProgressPolling();
        resetPlayerReadyPromise();
      });

      player.addListener('initialization_error', ({ message }) => {
        console.error('Player initialization failed:', message);
        disableControls();
        resolvePlayerReady();
      });

      player.addListener('authentication_error', async ({ message }) => {
        console.error('Authentication error:', message);
        const refreshed = await refreshAccessToken({ force: true });
        if (refreshed) {
          return;
        }
        disableControls();
        stopProgressPolling();
        resolvePlayerReady();
        sessionStorage.removeItem(STORAGE_KEY_ACCESS);
        sessionStorage.removeItem(STORAGE_KEY_REFRESH);
        sessionStorage.removeItem(STORAGE_KEY_EXPIRY);
        refreshTokenValue = null;
        accessTokenExpiresAt = null;
        showLogin();
      });

      player.addListener('account_error', ({ message }) => {
        console.error('Account error:', message);
      });

      player.addListener('player_state_changed', state => {
        if (!state || !state.track_window || !state.track_window.current_track) {
          return;
        }

        const currentTrack = state.track_window.current_track;
        updateNowPlaying(currentTrack);
        updatePlayButton(state.paused);
        updateProgress(state);

        queueCurrentlyPlaying = currentTrack;
        const currentUri = currentTrack.uri;
        if (currentUri && currentUri !== lastTrackUri) {
          lastTrackUri = currentUri;
          renderQueue();
          void refreshQueue({ immediate: true });
        }
      });

      await player.connect();
    } catch (error) {
      console.error('Unable to initialize Spotify Player:', error);
      resolvePlayerReady();
    }
  }

  async function fetchPlaylists(token = latestToken) {
    try {
      removeMarqueeTargetsWithin(playlistList);
      playlistList.innerHTML = '<li>Loading playlists…</li>';
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
      renderPlaylists(playlists);
    } catch (error) {
      console.error('Unable to fetch playlists:', error);
      removeMarqueeTargetsWithin(playlistList);
      playlistList.innerHTML = '<li class="error">Failed to load playlists. Try logging in again.</li>';
      sessionStorage.removeItem(STORAGE_KEY_ACCESS);
      sessionStorage.removeItem(STORAGE_KEY_REFRESH);
      sessionStorage.removeItem(STORAGE_KEY_EXPIRY);
      refreshTokenValue = null;
      accessTokenExpiresAt = null;
      showLogin();
    }
  }

  function renderPlaylists(playlists) {
    if (!Array.isArray(playlists) || playlists.length === 0) {
      removeMarqueeTargetsWithin(playlistList);
      playlistList.innerHTML = '<li>No playlists found.</li>';
      return;
    }

    removeMarqueeTargetsWithin(playlistList);
    playlistList.innerHTML = '';
    playlists.forEach(playlist => {
      const li = document.createElement('li');
      li.textContent = playlist.name;
      li.addEventListener('click', () => selectPlaylist(playlist, li));
      playlistList.appendChild(li);
      markMarqueeTarget(li);
    });
  }

  function selectPlaylist(playlist, element) {
    if (!playlist) {
      return;
    }

    const isSamePlaylist = currentPlaylist && currentPlaylist.id === playlist.id;
    if (isSamePlaylist && isPlaylistDetailsVisible()) {
      closePlaylistDetails();
      return;
    }

    currentPlaylist = playlist;
    highlightPlaylist(element);
    openPlaylistDetails(playlist);
    fetchPlaylistTracks(playlist.id);
  }

  function wireControls() {
    playButton.addEventListener('click', async () => {
      if (!player) {
        return;
      }

      try {
        const state = await player.getCurrentState();
        if (!state || state.paused) {
          await player.resume();
        } else {
          await player.pause();
        }
      } catch (error) {
        console.error('Unable to toggle playback:', error);
      }
    });

    prevButton.addEventListener('click', async () => {
      if (!player) {
        return;
      }

      try {
        await player.previousTrack();
        void refreshQueue({ immediate: true });
      } catch (error) {
        console.error('Unable to go to previous track:', error);
      }
    });

    nextButton.addEventListener('click', async () => {
      if (!player) {
        return;
      }

      try {
        await player.nextTrack();
        void refreshQueue({ immediate: true });
      } catch (error) {
        console.error('Unable to skip to next track:', error);
      }
    });

    if (progressBarContainer) {
      progressBarContainer.addEventListener('click', async event => {
        if (!player) {
          return;
        }

        const rect = progressBarContainer.getBoundingClientRect();
        const clickPosition = Math.max(0, event.clientX - rect.left);
        const percent = rect.width === 0 ? 0 : clickPosition / rect.width;

        try {
          const state = await player.getCurrentState();
          if (state && typeof state.duration === 'number') {
            const seekPosition = Math.floor(state.duration * percent);
            await player.seek(seekPosition);
            updateProgress({ duration: state.duration, position: seekPosition });
          }
        } catch (error) {
          console.error('Unable to seek track:', error);
        }
      });
    }
  }

  function setupSearch() {
    if (searchButton) {
      searchButton.addEventListener('click', () => {
        handleTrackSearch();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleTrackSearch();
        }
      });
    }
  }

  function setupPlaylistDetailControls() {
    if (playlistPlayButton) {
      playlistPlayButton.addEventListener('click', () => {
        if (currentPlaylist) {
          playPlaylist(currentPlaylist);
        }
      });
    }

    if (closePlaylistDetailsButton && playlistDetails) {
      closePlaylistDetailsButton.addEventListener('click', () => {
        closePlaylistDetails();
      });
    }

    closePlaylistDetails();
  }

  function setupVolumeControls() {
    if (volumeSlider) {
      volumeSlider.value = Math.round(latestVolume * 100);
      volumeSlider.disabled = true;
      volumeSlider.addEventListener('input', () => {
        const value = Number(volumeSlider.value) / 100;
        setVolume(value, { updateSlider: false });
      });
    }

    if (volumeDownButton) {
      volumeDownButton.disabled = true;
      volumeDownButton.addEventListener('click', () => {
        adjustVolume(-0.05);
      });
    }

    if (volumeUpButton) {
      volumeUpButton.disabled = true;
      volumeUpButton.addEventListener('click', () => {
        adjustVolume(0.05);
      });
    }
  }

  function setupQueueControls() {
    if (resumePlaybackButton) {
      resumePlaybackButton.disabled = true;
      resumePlaybackButton.addEventListener('click', async () => {
        if (!player) {
          return;
        }

        try {
          const state = await player.getCurrentState();
          if (!state || state.paused) {
            await player.resume();
          }
        } catch (error) {
          console.error('Unable to resume playback:', error);
        }
      });
    }

    if (refreshQueueButton) {
      refreshQueueButton.addEventListener('click', () => {
        void refreshQueue({ immediate: true });
      });
    }
  }

  async function refreshQueue(options = {}) {
    const { immediate = false } = options;

    if (!queueListEl || !latestToken) {
      return;
    }

    if (queueRefreshInFlight) {
      if (!immediate) {
        return queueRefreshInFlight;
      }

      try {
        await queueRefreshInFlight;
      } catch (error) {
        console.warn('Previous queue refresh failed:', error);
      }
    }

    if (!queueItems.length && !queueCurrentlyPlaying) {
      removeMarqueeTargetsWithin(queueListEl);
      queueListEl.innerHTML = '<li>Loading queue…</li>';
    }

    const refreshPromise = (async () => {
      try {
        const response = await fetch('https://api.spotify.com/v1/me/player/queue', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${latestToken}`
          }
        });

        if (response.status === 204) {
          queueCurrentlyPlaying = null;
          queueItems = [];
          queueDisplayLimit = 0;
          renderQueue();
          return;
        }

        if (!response.ok) {
          throw new Error(`Spotify responded with status ${response.status}`);
        }

        const payload = await response.json();
        queueCurrentlyPlaying = payload?.currently_playing ?? null;
        const normalizedQueue = sanitizeQueueItems(queueCurrentlyPlaying, payload?.queue);

        if (queueDisplayLimit === null || normalizedQueue.length > queueDisplayLimit) {
          queueDisplayLimit = normalizedQueue.length;
        }

        const limit = queueDisplayLimit ?? normalizedQueue.length;
        queueItems = normalizedQueue.slice(0, limit);
        renderQueue();
      } catch (error) {
        console.error('Unable to refresh queue:', error);
        if (queueListEl) {
          removeMarqueeTargetsWithin(queueListEl);
          queueListEl.innerHTML = '<li class="error">Unable to load queue.</li>';
        }
      }
    })();

    queueRefreshInFlight = refreshPromise.finally(() => {
      queueRefreshInFlight = null;
    });

    return queueRefreshInFlight;
  }

  function highlightPlaylist(element) {
    if (!element) {
      return;
    }

    if (selectedPlaylistElement && selectedPlaylistElement !== element) {
      selectedPlaylistElement.classList.remove('active');
    }

    selectedPlaylistElement = element;
    element.classList.add('active');
  }
  function openPlaylistDetails(playlist) {
    if (!playlistDetails || !playlistDetailsName) {
      return;
    }

    playlistDetailsName.textContent = playlist.name;
    playlistDetailsName.title = playlist.name || '';
    if (playlistDetailsOwner) {
      const ownerName = playlist.owner?.display_name;
      playlistDetailsOwner.textContent = ownerName ? `by ${ownerName}` : '';
    }

    if (playlistDetailsArt) {
      const imageUrl = playlist.images && playlist.images.length > 0
        ? playlist.images[0].url
        : PLACEHOLDER_PLAYLIST_ART;
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
    if (playlistDetailsName) {
      markMarqueeTarget(playlistDetailsName);
    }
    adjustPlaylistDetailsWidth();
    if (playlistPlayButton) {
      playlistPlayButton.disabled = !isPlayerReady();
    }

    if (playlistTracksList) {
      removeMarqueeTargetsWithin(playlistTracksList);
      playlistTracksList.innerHTML = '<li>Loading tracks…</li>';
    }
  }

  function adjustPlaylistDetailsWidth() {
    if (!playlistDetails) {
      return;
    }

    playlistDetails.style.removeProperty('flex');
    playlistDetails.style.removeProperty('width');
  }

  async function fetchPlaylistTracks(playlistId) {
    if (!playlistTracksList) {
      return;
    }

    try {
      const response = await fetch(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        headers: {
          Authorization: `Bearer ${latestToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const data = await response.json();
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      if (!currentPlaylist || currentPlaylist.id !== playlistId) {
        return;
      }
      renderTrackList(playlistTracksList, tracks, {
        emptyMessage: 'No tracks in this playlist.',
        playButtonLabel: 'PLAY',
        onPlay: track => {
          playTrack(track?.uri);
        },
        queueButtonLabel: 'QUEUE',
        onQueue: track => {
          addTrackToQueue(track);
        }
      });
    } catch (error) {
      console.error('Unable to fetch playlist tracks:', error);
      if (currentPlaylist && currentPlaylist.id === playlistId) {
        removeMarqueeTargetsWithin(playlistTracksList);
        playlistTracksList.innerHTML = '<li class="error">Failed to load tracks.</li>';
      }
    }
  }

  async function playRecommendationForTrack(track) {
    const trackId = track?.id;

    if (!trackId) {
      console.warn('Track missing id; playing original track instead.');
      if (track?.uri) {
        await playTrack(track.uri);
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

      await playPlaylist({ uri: playlistUri });
      void refreshQueue({ immediate: true });
    } catch (error) {
      console.error('Unable to start recommended playlist:', error);
      if (track?.uri) {
        await playTrack(track.uri);
      }
    }
  }

  async function handleTrackSearch() {
    if (!searchInput || !searchResultsList) {
      return;
    }

    const query = searchInput.value.trim();
    if (!query) {
      removeMarqueeTargetsWithin(searchResultsList);
      searchResultsList.innerHTML = '<li class="error">Enter a search phrase.</li>';
      return;
    }

    removeMarqueeTargetsWithin(searchResultsList);
    searchResultsList.innerHTML = '<li>Searching…</li>';

    try {
      const response = await fetch(`/search?q=${encodeURIComponent(query)}`, {
        headers: {
          Authorization: `Bearer ${latestToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      const tracks = await response.json();
      renderTrackList(searchResultsList, tracks, {
        emptyMessage: 'No results found.',
        playButtonLabel: 'PLAY',
        onPlay: track => {
          void playRecommendationForTrack(track);
        },
        queueButtonLabel: 'QUEUE',
        onQueue: track => {
          addTrackToQueue(track);
        }
      });
    } catch (error) {
      console.error('Unable to search tracks:', error);
      removeMarqueeTargetsWithin(searchResultsList);
      searchResultsList.innerHTML = '<li class="error">Search failed. Try again later.</li>';
    }
  }

  function updateNowPlaying(track) {
    trackNameEl.textContent = track.name || 'Unknown Track';
    markMarqueeTarget(trackNameEl);
    const artistNames = Array.isArray(track.artists)
      ? track.artists.map(artist => artist.name).filter(Boolean).join(', ')
      : 'Unknown Artist';
    artistNameEl.textContent = artistNames || 'Unknown Artist';

    if (track.album && Array.isArray(track.album.images) && track.album.images.length > 0) {
      albumArtEl.src = track.album.images[0].url;
    } else {
      albumArtEl.src = PLACEHOLDER_ALBUM_ART;
    }
  }

  function updatePlayButton(paused) {
    playButton.textContent = paused ? 'PLAY' : 'PAUSE';
  }

  function updateProgress(state) {
    if (!state || typeof state.duration !== 'number' || state.duration <= 0) {
      progressBar.style.width = '0%';
      return;
    }

    const position = Math.max(0, typeof state.position === 'number' ? state.position : 0);
    const percent = Math.min((position / state.duration) * 100, 100);
    progressBar.style.width = `${percent}%`;
  }

  function startProgressPolling() {
    stopProgressPolling();
    progressIntervalId = window.setInterval(async () => {
      if (!player) {
        return;
      }

      try {
        const state = await player.getCurrentState();
        if (state) {
          updateProgress(state);
        } else {
          updateProgress(null);
        }
      } catch (error) {
        console.error('Unable to poll player state:', error);
      }
    }, PROGRESS_UPDATE_MS);
  }

  function stopProgressPolling() {
    if (typeof progressIntervalId === 'number') {
      window.clearInterval(progressIntervalId);
      progressIntervalId = undefined;
    }
  }

  function disableControls() {
    playButton.disabled = true;
    prevButton.disabled = true;
    nextButton.disabled = true;
    if (playlistPlayButton) {
      playlistPlayButton.disabled = true;
    }
    if (volumeSlider) {
      volumeSlider.disabled = true;
    }
    if (volumeDownButton) {
      volumeDownButton.disabled = true;
    }
    if (volumeUpButton) {
      volumeUpButton.disabled = true;
    }
    if (resumePlaybackButton) {
      resumePlaybackButton.disabled = true;
    }
  }

  function enableControls() {
    playButton.disabled = false;
    prevButton.disabled = false;
    nextButton.disabled = false;
    if (playlistPlayButton) {
      playlistPlayButton.disabled = false;
    }
    if (volumeSlider) {
      volumeSlider.disabled = false;
    }
    if (volumeDownButton) {
      volumeDownButton.disabled = false;
    }
    if (volumeUpButton) {
      volumeUpButton.disabled = false;
    }
    if (resumePlaybackButton) {
      resumePlaybackButton.disabled = false;
    }
  }

  function isPlayerReady() {
    return Boolean(player && deviceId && latestToken);
  }

  async function playTrack(uri) {
    if (!uri) {
      return;
    }

    await ensurePlayerReady();

    if (!isPlayerReady()) {
      console.warn('Player not ready yet.');
      return;
    }

    if (!hasTransferredPlayback && deviceId) {
      try {
        await transferPlayback(deviceId);
      } catch (error) {
        console.error('Unable to transfer playback:', error);
      }
    }

    try {
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${latestToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uris: [uri]
        })
      });
      void refreshQueue({ immediate: true });
    } catch (error) {
      console.error('Unable to play track:', error);
    }
  }

  async function playPlaylist(playlist) {
    if (!playlist || !playlist.uri) {
      return;
    }

    await ensurePlayerReady();

    if (!isPlayerReady()) {
      console.warn('Player not ready yet.');
      return;
    }

    if (!hasTransferredPlayback && deviceId) {
      try {
        await transferPlayback(deviceId);
      } catch (error) {
        console.error('Unable to transfer playback:', error);
      }
    }

    try {
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${latestToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          context_uri: playlist.uri
        })
      });
    } catch (error) {
      console.error('Unable to start playlist:', error);
    }
  }

  function renderTrackList(listElement, tracks, { emptyMessage, playButtonLabel, onPlay, queueButtonLabel, onQueue }) {
    if (!listElement) {
      return;
    }

    removeMarqueeTargetsWithin(listElement);

    if (!Array.isArray(tracks) || tracks.length === 0) {
      listElement.innerHTML = `<li>${emptyMessage || 'No tracks found.'}</li>`;
      return;
    }

    listElement.innerHTML = '';
    tracks.forEach(track => {
      if (!track) {
        return;
      }

      const li = document.createElement('li');

      const titleEl = document.createElement('div');
      titleEl.className = 'track-title';
      titleEl.textContent = track.name || 'Unknown Track';
      li.appendChild(titleEl);

      const metaEl = document.createElement('div');
      metaEl.className = 'track-meta';
      const artistNames = Array.isArray(track.artists)
        ? track.artists.map(artist => artist.name).filter(Boolean).join(', ')
        : 'Unknown Artist';
      const albumName = track.album?.name || 'Unknown Album';
      metaEl.textContent = `${artistNames} • ${albumName} • ${formatDuration(track.duration_ms)}`;
      li.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.className = 'track-actions';

      if (typeof onPlay === 'function') {
        const playBtn = document.createElement('button');
        playBtn.textContent = playButtonLabel || 'PLAY';
        playBtn.type = 'button';
        playBtn.addEventListener('click', () => {
          onPlay(track);
        });
        actions.appendChild(playBtn);
      }

      if (typeof onQueue === 'function') {
        const queueBtn = document.createElement('button');
        queueBtn.textContent = queueButtonLabel || 'QUEUE';
        queueBtn.type = 'button';
        queueBtn.addEventListener('click', () => {
          onQueue(track);
        });
        actions.appendChild(queueBtn);
      }

      if (actions.childElementCount > 0) {
        li.appendChild(actions);
      }

      listElement.appendChild(li);
      markMarqueeTarget(titleEl);
    });
  }

  async function addTrackToQueue(track) {
    if (!track || !track.uri) {
      return;
    }

    if (!latestToken) {
      return;
    }

    try {
      const url = new URL('https://api.spotify.com/v1/me/player/queue');
      url.searchParams.set('uri', track.uri);
      if (deviceId) {
        url.searchParams.set('device_id', deviceId);
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${latestToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Spotify responded with status ${response.status}`);
      }

      await refreshQueue({ immediate: true });
    } catch (error) {
      console.error('Unable to add track to queue:', error);
    }
  }

  function describeQueueItem(item) {
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
    const duration = item.duration_ms ? formatDuration(item.duration_ms) : '';

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

  function sanitizeQueueItems(currentItem, items) {
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

  function renderQueue() {
    if (!queueListEl) {
      return;
    }

    removeMarqueeTargetsWithin(queueListEl);
    queueListEl.innerHTML = '';

    if (queueCurrentlyPlaying) {
      const nowItem = buildQueueListItem(queueCurrentlyPlaying, { label: 'Now playing', highlight: true });
      queueListEl.appendChild(nowItem);
      const nowTitle = nowItem.querySelector('.queue-title');
      if (nowTitle) {
        markMarqueeTarget(nowTitle);
      }
    }

    if (!Array.isArray(queueItems) || queueItems.length === 0) {
      if (queueCurrentlyPlaying) {
        const emptyNext = document.createElement('li');
        emptyNext.className = 'empty';
        emptyNext.textContent = 'No upcoming tracks.';
        queueListEl.appendChild(emptyNext);
      } else {
        queueListEl.innerHTML = '<li class="empty">Queue is empty.</li>';
      }
      return;
    }

    queueItems.forEach(item => {
      const queueItem = buildQueueListItem(item);
      queueListEl.appendChild(queueItem);
      const titleEl = queueItem.querySelector('.queue-title');
      if (titleEl) {
        markMarqueeTarget(titleEl);
      }
    });
  }

  function buildQueueListItem(item, options = {}) {
    const { label, highlight = false } = options;
    const { title, meta } = describeQueueItem(item);

    const li = document.createElement('li');
    if (highlight) {
      li.classList.add('current');
    }

    const titleEl = document.createElement('div');
    titleEl.className = 'queue-title';
    titleEl.textContent = title;
    if (label) {
      titleEl.textContent = `${label}: ${titleEl.textContent}`;
    }
    li.appendChild(titleEl);

    if (meta) {
      const metaEl = document.createElement('div');
      metaEl.className = 'track-meta';
      metaEl.textContent = meta;
      li.appendChild(metaEl);
    }

    if (item?.uri) {
      const actions = document.createElement('div');
      actions.className = 'track-actions';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.textContent = 'PLAY NOW';
      playBtn.addEventListener('click', () => {
        void playTrack(item.uri);
      });
      actions.appendChild(playBtn);

      li.appendChild(actions);
    }

    return li;
  }

  function adjustVolume(delta) {
    const newVolume = clamp(latestVolume + delta, 0, 1);
    void setVolume(newVolume);
  }

  async function setVolume(value, { updateSlider = true } = {}) {
    const clamped = clamp(value, 0, 1);
    latestVolume = clamped;

    if (updateSlider && volumeSlider) {
      volumeSlider.value = Math.round(clamped * 100);
    }

    if (!player) {
      return;
    }

    try {
      await ensurePlayerReady();
      await player.setVolume(clamped);
    } catch (error) {
      console.error('Unable to set volume:', error);
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatDuration(durationMs) {
    if (!durationMs || typeof durationMs !== 'number') {
      return '0:00';
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function closePlaylistDetails() {
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
      removeMarqueeTargetsWithin(playlistTracksList);
      playlistTracksList.innerHTML = '';
    }

    if (playlistPlayButton) {
      playlistPlayButton.disabled = true;
    }

    if (playlistDetailsName) {
      playlistDetailsName.textContent = 'Playlist';
      playlistDetailsName.removeAttribute('title');
      markMarqueeTarget(playlistDetailsName);
    }

    if (playlistDetailsOwner) {
      playlistDetailsOwner.textContent = '';
    }

    if (playlistDetailsArt) {
      playlistDetailsArt.src = PLACEHOLDER_PLAYLIST_ART;
      playlistDetailsArt.alt = 'Playlist Art';
    }

    if (playlistDetails) {
      playlistDetails.style.removeProperty('flex');
      playlistDetails.style.removeProperty('width');
    }

    if (selectedPlaylistElement) {
      selectedPlaylistElement.classList.remove('active');
      selectedPlaylistElement = undefined;
    }

    currentPlaylist = undefined;
  }

  function isPlaylistDetailsVisible() {
    return Boolean(playlistDetails && !playlistDetails.classList.contains('hidden'));
  }

  async function ensurePlayerReady() {
    await playerReadyPromise;
  }

  function resetPlayerReadyPromise() {
    playerReadyPromise = createPlayerReadyPromise();
    hasTransferredPlayback = false;
  }

  function resolvePlayerReady() {
    if (typeof playerReadyResolver === 'function') {
      playerReadyResolver();
      playerReadyResolver = undefined;
    }
  }

  function createPlayerReadyPromise() {
    return new Promise(resolve => {
      playerReadyResolver = resolve;
    });
  }

  async function transferPlayback(id, options = {}) {
    if (!id) {
      return false;
    }

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${latestToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          device_ids: [id],
          play: options.play === true
        })
      });

      if (!response.ok) {
        throw new Error(`Spotify responded with status ${response.status}`);
      }

      hasTransferredPlayback = true;
      return true;
    } catch (error) {
      hasTransferredPlayback = false;
      console.error('Unable to transfer playback:', error);
      return false;
    }
  }

  function markMarqueeTarget(element) {
    if (!element) {
      return;
    }

    if (element.dataset.marqueeTarget === 'true') {
      requestAnimationFrame(() => {
        updateMarquee(element);
      });
      return;
    }

    element.dataset.marqueeTarget = 'true';
    marqueeTargets.add(element);

    if (marqueeObserver) {
      marqueeObserver.observe(element);
    }

    requestAnimationFrame(() => {
      updateMarquee(element);
    });
  }

  function updateMarquee(element) {
    if (!element) {
      return;
    }

    if (!element.isConnected) {
      if (marqueeObserver) {
        marqueeObserver.unobserve(element);
      }
      marqueeTargets.delete(element);
      element.removeAttribute('data-marquee-target');
      return;
    }

    let text = element.textContent || '';

    const existingTrack = element.querySelector(':scope > .marquee-track');
    if (existingTrack) {
      const firstSegment = existingTrack.querySelector(':scope > .marquee-segment');
      text = firstSegment ? firstSegment.textContent || '' : existingTrack.textContent || '';
    }

    element.textContent = text;
    element.classList.remove('marquee');
    element.style.removeProperty('--marquee-distance');
    element.style.removeProperty('--marquee-duration');
    element.style.removeProperty('--marquee-gap');
    element.setAttribute('title', text);
    const containerWidth = element.clientWidth;

    if (!containerWidth || element.scrollWidth <= containerWidth + 1) {
      element.removeAttribute('aria-label');
      return;
    }

    element.textContent = '';
    const track = document.createElement('div');
    track.className = 'marquee-track';
    track.setAttribute('aria-hidden', 'true');

    const segment = document.createElement('span');
    segment.className = 'marquee-segment';
    segment.textContent = text;
    track.appendChild(segment);

    const clone = segment.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);

    element.appendChild(track);
    element.classList.add('marquee');
    element.setAttribute('aria-label', text);

    const gap = 32;
    element.style.setProperty('--marquee-gap', `${gap}px`);

    const contentWidth = segment.scrollWidth;
    if (!contentWidth) {
      element.classList.remove('marquee');
      element.textContent = text;
      element.removeAttribute('aria-label');
      return;
    }

    const distance = contentWidth;

    element.style.setProperty('--marquee-distance', `${distance}px`);

    const speed = 50;
    const duration = Math.min(Math.max(distance / speed, 8), 30);
    element.style.setProperty('--marquee-duration', `${duration}s`);
  }

  function removeMarqueeTargetsWithin(container) {
    if (!container) {
      return;
    }

    marqueeTargets.forEach(target => {
      if (!target.isConnected || container.contains(target)) {
        if (marqueeObserver) {
          marqueeObserver.unobserve(target);
        }
        target.removeAttribute('data-marquee-target');
        marqueeTargets.delete(target);
      }
    });
  }

  if (!marqueeObserver) {
    window.addEventListener('resize', () => {
      marqueeTargets.forEach(target => {
        updateMarquee(target);
      });
    });
  }

  window.addEventListener('resize', () => {
    if (playlistDetails && !playlistDetails.classList.contains('hidden')) {
      adjustPlaylistDetailsWidth();
    }
  });
})();
