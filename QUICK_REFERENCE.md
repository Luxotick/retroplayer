# 🎯 Modular Architecture - Quick Reference

## 📁 Modül Seçim Rehberi

### Ne değiştirmek istiyorum?

| İşlem | Modül | Dosya |
|-------|-------|-------|
| Token'lar kontrol et | TokenManager | `tokenManager.js` |
| Player state değiştir | PlayerController | `playerController.js` |
| UI görünümü değiştir | UIHelpers | `uiHelpers.js` |
| Playlist işlemleri | PlaylistManager | `playlistManager.js` |
| Kuyruk işlemleri | QueueManager | `queueManager.js` |
| Arama işlemleri | SearchManager | `searchManager.js` |
| Ses kontrolü | VolumeManager | `volumeManager.js` |
| Sabitler | (constants) | `constants.js` |
| DOM references | (DOMElements) | `domElements.js` |

---

## 🔌 API Reference

### TokenManager
```javascript
tokenManager.getAccessToken()
tokenManager.isTokenValid()
tokenManager.refreshAccessToken(options)
tokenManager.clearAllTokens()
tokenManager.readAuthFromHash()
tokenManager.persistTokens(data)

// Events
tokenManager.onTokenExpired
tokenManager.onTokenRefreshed
```

### PlayerController
```javascript
await playerController.initialize(token)
await playerController.play(uris, contextUri)
await playerController.togglePlayPause()
await playerController.previousTrack()
await playerController.nextTrack()
await playerController.setVolume(value)
await playerController.seek(position)
await playerController.getCurrentState()
await playerController.transferPlayback(deviceId)

playerController.isReady()
playerController.getDeviceId()
playerController.startProgressPolling(callback)
playerController.stopProgressPolling()

// Events
playerController.onPlayerReady
playerController.onPlayerStateChanged
playerController.onPlayerError
playerController.onAuthError
```

### UIHelpers
```javascript
uiHelpers.disableControls()
uiHelpers.enableControls()
uiHelpers.showLogin()
uiHelpers.showPlayer()
uiHelpers.updateProgress(state)
uiHelpers.updatePlayButton(paused)
uiHelpers.updateNowPlaying(track)
uiHelpers.formatDuration(ms)
uiHelpers.clamp(value, min, max)

// Marquee
uiHelpers.markMarqueeTarget(element)
uiHelpers.updateMarquee(element)
uiHelpers.removeMarqueeTargetsWithin(container)
uiHelpers.destroy()
```

### PlaylistManager
```javascript
await playlistManager.fetchPlaylists()
playlistManager.renderPlaylists(playlists)
playlistManager.selectPlaylist(playlist, element)
playlistManager.highlightPlaylist(element)
playlistManager.openPlaylistDetails(playlist)
playlistManager.closePlaylistDetails()
playlistManager.isPlaylistDetailsVisible()
await playlistManager.fetchPlaylistTracks(playlistId)
playlistManager.renderTrackList(element, tracks, callbacks)
```

### QueueManager
```javascript
await queueManager.refreshQueue(options)
await queueManager.addTrackToQueue(track)
queueManager.render(onPlayClick)
queueManager.setCurrentlyPlaying(track)
queueManager.getCurrentlyPlaying()

queueManager.describeQueueItem(item)
queueManager.sanitizeQueueItems(current, items)
queueManager.buildQueueListItem(item, onPlayClick, options)
```

### SearchManager
```javascript
await searchManager.searchTracks(query)
searchManager.renderSearchResults(tracks, callbacks)
```

### VolumeManager
```javascript
await volumeManager.setVolume(value, options)
await volumeManager.adjustVolume(delta)
volumeManager.setupControls()
volumeManager.enableControls()
volumeManager.disableControls()
volumeManager.getVolume()
```

---

## 🎛️ Sabitler (constants.js)

```javascript
STORAGE_KEYS = {
  ACCESS: 'spotifyAccessToken',
  REFRESH: 'spotifyRefreshToken',
  EXPIRY: 'spotifyAccessTokenExpiresAt'
}

TIMING = {
  PROGRESS_UPDATE_MS: 1000,
  REFRESH_BUFFER_MS: 60_000,
  TOKEN_DEFAULT_EXPIRY: 1800
}

URLS = {
  PLACEHOLDER_ALBUM_ART: 'https://via.placeholder.com/150',
  PLACEHOLDER_PLAYLIST_ART: 'https://via.placeholder.com/120',
  SPOTIFY_API_BASE: 'https://api.spotify.com/v1'
}

UI = {
  MARQUEE_GAP: 32,
  MARQUEE_MIN_SPEED: 50,
  DEFAULT_VOLUME: 0.5,
  VOLUME_STEP: 0.05
}
```

---

## 💻 Kod Örnekleri

### Track oynat
```javascript
// Yeni şekil
await app.playTrack(track.uri);

// Veya direktly
await playerController.play([track.uri]);
```

### Kuyruka ekle
```javascript
await queueManager.addTrackToQueue(track);
```

### Playlist'leri yenile
```javascript
await playlistManager.fetchPlaylists();
```

### Token refresh et
```javascript
const refreshed = await tokenManager.refreshAccessToken({
  force: true
});
```

### Ses değiştir
```javascript
await volumeManager.setVolume(0.7);
```

### UI update et
```javascript
uiHelpers.updateNowPlaying(track);
uiHelpers.updateProgress(state);
```

---

## 🐛 Debugging

### Token sorunu
```javascript
console.log(tokenManager.getAccessToken());
console.log(tokenManager.isTokenValid());
tokenManager.clearAllTokens();
```

### Player sorusu
```javascript
console.log(playerController.isReady());
console.log(playerController.getDeviceId());
const state = await playerController.getCurrentState();
console.log(state);
```

### Kuyruk sorunu
```javascript
console.log(queueManager.queueItems);
console.log(queueManager.queueCurrentlyPlaying);
await queueManager.refreshQueue({ immediate: true });
```

### UI sorunu
```javascript
console.log(DOMElements.playButton);
console.log(DOMElements.progressBar);
uiHelpers.updateProgress(state);
```

---

## 🚦 Common Flows

### Uygulama Başlangıcı
```javascript
1. main.js yüklenir
2. RetroSpotifyPlayer instantiate edilir
3. app.start() çağrılır
4. Tokens hash'den okunur
5. Player initialize edilir
6. Playlists yüklenir
7. UI ready
```

### Track Oynatma
```javascript
1. Kullanıcı track'i seçer
2. onPlay(track) callback çalışır
3. app.playTrack(track.uri) çağrılır
4. PlayerController.play([uri]) çağrılır
5. Spotify API: PUT /me/player/play
6. Player state change event
7. UI update edilir
```

### Token Refresh
```javascript
1. TokenManager timeout tetiklenir
2. refreshAccessToken() çağrılır
3. Spotify: GET /refresh_token
4. Yeni token kaydedilir
5. onTokenRefreshed event
6. PlayerController reset edilir
```

---

## 📝 Best Practices

### ✅ DO
```javascript
// Instance variables kullan
this.tokenManager.getAccessToken()

// Class methods kullan
await tokenManager.refreshAccessToken()

// Event handlers set et
this.tokenManager.onTokenExpired = () => { ... }

// Error handling yap
try { ... } catch (error) { console.error(...) }

// Cleanup yap
player.destroy()
```

### ❌ DON'T
```javascript
// Global scope kirlileme yapma
window.token = ...

// Direct DOM manipulation
document.querySelector('...')

// Error ignore etme
await fetch(...) // no catch

// Cleanup unutma
observer.disconnect() // missing!
```

---

## 🔗 İmport Template

```javascript
import { DOMElements } from './modules/domElements.js';
import { STORAGE_KEYS, TIMING, URLS, UI } from './modules/constants.js';
import { TokenManager } from './modules/tokenManager.js';
import { PlayerController } from './modules/playerController.js';
import { UIHelpers } from './modules/uiHelpers.js';
import { PlaylistManager } from './modules/playlistManager.js';
import { QueueManager } from './modules/queueManager.js';
import { SearchManager } from './modules/searchManager.js';
import { VolumeManager } from './modules/volumeManager.js';
```

---

## 🎯 Problem Çözme

| Problem | Kontrol Edilecek Yer |
|---------|-------------------|
| Token expire | `tokenManager.onTokenExpired` |
| Player connect fail | `playerController.onAuthError` |
| UI update olmıyor | `uiHelpers.updateProgress()` |
| Playlist yüklenmiyor | `playlistManager.fetchPlaylists()` |
| Kuyruk boş görünüyor | `queueManager.refreshQueue()` |
| Ses çalışmıyor | `volumeManager.setVolume()` |
| Memory leak | `destroy()` methodlarını kontrol et |

---

**Son Update:** Aralık 2025  
**Versiyon:** 2.0  
**Status:** Production Ready ✅
