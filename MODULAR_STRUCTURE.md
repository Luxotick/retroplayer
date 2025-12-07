# Retro Spotify Player - Modüler Yapı Rehberi

## 📁 Yeni Dosya Yapısı

```
public/
├── index.html
├── style.css
├── spotifyToken.js
├── main.js                          # Entry point (yeni)
├── script.js                        # Eski dosya (silinebilir)
└── modules/                         # Yeni modüler yapı
    ├── constants.js                 # Sabitler
    ├── domElements.js               # DOM element referansları
    ├── tokenManager.js              # Token yönetimi
    ├── playerController.js          # Spotify Player kontrolü
    ├── uiHelpers.js                 # UI işlemleri
    ├── playlistManager.js           # Playlist yönetimi
    ├── queueManager.js              # Kuyruk yönetimi
    ├── searchManager.js             # Arama işlemleri
    └── volumeManager.js             # Ses kontrolü
```

## 🎯 Modüllerin Açıklaması

### `constants.js`
- Tüm sabitler merkezi olarak tanımlanır
- **İçerir:**
  - `STORAGE_KEYS` - SessionStorage anahtarları
  - `TIMING` - Zaman aralıkları
  - `URLS` - API URL'leri
  - `UI` - UI parametreleri
  - `PLAYLIST_TRACKING` - Playlist ayarları

### `domElements.js`
- Tüm DOM element referansları
- Başlangıçta bir kez yüklenir
- Global erişim için kolaylık sağlar

### `tokenManager.js` 
- **TokenManager sınıfı**
- Spotify token'larını yönetir
- Otomatik refresh işlemleri
- Token sona erme kontrolü
- Event: `onTokenExpired`, `onTokenRefreshed`

### `playerController.js`
- **PlayerController sınıfı**
- Spotify Web Playback SDK yönetimi
- Oynatıcı kontrolleri (play, pause, next, etc.)
- Device ID yönetimi
- İlerleme polling
- Event: `onPlayerReady`, `onPlayerStateChanged`, `onPlayerError`, `onAuthError`

### `uiHelpers.js`
- **UIHelpers sınıfı**
- Kontrol aktivasyon/deaktivasyon
- Görüntü güncelleme (now playing, progress, etc.)
- Marquee animasyonu yönetimi
- Utilities: `formatDuration`, `clamp`

### `playlistManager.js`
- **PlaylistManager sınıfı**
- Playlist'leri getir ve render et
- Playlist seçim işlemi
- Playlist track'lerini yükle
- Playlist detay açma/kapama

### `queueManager.js`
- **QueueManager sınıfı**
- Kuyruk state'ini yönet
- Track'leri kuyruka ekle
- Kuyruk item'larını render et
- Şu an oynatılan track takibi

### `searchManager.js`
- **SearchManager sınıfı**
- Track arama işlemleri
- Arama sonuçlarını render et
- Callback'lerle entegrasyon

### `volumeManager.js`
- **VolumeManager sınıfı**
- Ses seviyesi kontrolü
- Ses butonu event'leri
- Ses slider yönetimi

## 🚀 Ana Uygulama Yapısı (`main.js`)

```javascript
class RetroSpotifyPlayer {
  constructor()           // Tüm modülleri başlat
  start()                 // Uygulamayı başlat
  setupUI()               // UI event'lerini kur
  setupPlayerControls()   // Oynatıcı kontrolleri
  setupSearchControls()   // Arama kontrolleri
  setupPlaylistDetailControls()
  setupQueueControls()
  initializePlayer()      // Player SDK başlat
  // ...
}
```

## 🔄 Veri Akışı

```
HTML (index.html)
    ↓
main.js (RetroSpotifyPlayer)
    ↓
┌─────────────────────────────────────┐
│  TokenManager                       │
│  - Token'ları yönet                │
│  - Refresh işlemleri               │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  PlayerController                   │
│  - Spotify SDK                      │
│  - Oynatıcı state'i                │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  UIHelpers, PlaylistManager, etc.  │
│  - UI güncellemeleri               │
│  - Playlist/Queue/Search           │
└─────────────────────────────────────┘
```

## 📋 Kullanım Örnekleri

### Token Yönetimi
```javascript
const tokenManager = new TokenManager();
const token = tokenManager.getAccessToken();
await tokenManager.refreshAccessToken();
```

### Player Kontrolü
```javascript
const player = new PlayerController(tokenManager);
await player.initialize(token);
await player.play([trackUri]);
await player.togglePlayPause();
```

### UI Güncellemeleri
```javascript
const ui = new UIHelpers();
ui.updateNowPlaying(track);
ui.updateProgress(state);
ui.markMarqueeTarget(element);
```

### Playlist Yönetimi
```javascript
const playlists = new PlaylistManager(tokenManager, uiHelpers);
await playlists.fetchPlaylists();
playlists.selectPlaylist(playlist, element);
```

## ✅ Optimizasyonlar

### 1. **Kod Parçalanması**
- Monolitik 1559 satırdan 11 ayrı dosyaya
- Her modülün tek sorumluluğu (SRP)
- Daha kolay test ve maintain

### 2. **Performans İyileştirmeleri**
- Lazy loading: Modüller sadece gerekirse yüklenir
- Event delegation kullanımı
- ResizeObserver'ı verimli kullanma

### 3. **Bellek Yönetimi**
- Set kullanarak marquee targets'ı yönet
- Observer'ları temizle (destroy metodları)
- Timeout'ları düzgün clear et

### 4. **Hata İşleme**
- Try-catch blokları her async işlemi kapsar
- Meaningful error logs
- Token expire handling

### 5. **Kod Tekrarını Azaltma**
- Sabitler centralized
- Helper metodlar (clamp, formatDuration)
- DRY (Don't Repeat Yourself) prensibi

## 🔧 Extending / Yeni Özellik Ekleme

Örnek: Yeni bir "Favorites" modülü eklemek

```javascript
// modules/favoritesManager.js
export class FavoritesManager {
  constructor(tokenManager, uiHelpers) {
    this.tokenManager = tokenManager;
    this.uiHelpers = uiHelpers;
  }
  
  async saveFavorite(track) { ... }
  async getFavorites() { ... }
}

// main.js içinde
import { FavoritesManager } from './modules/favoritesManager.js';

class RetroSpotifyPlayer {
  constructor() {
    // ...
    this.favoritesManager = new FavoritesManager(
      this.tokenManager,
      this.uiHelpers
    );
  }
}
```

## 📝 Not

- Eski `script.js` dosyası silinebilir veya yedek olarak tutulabilir
- `index.html` artık `main.js` (type="module") kullanır
- Tüm modüller ES6 module syntax kullanır
- Cross-browser uyumluluk için polyfill gerekebilir

## 🚀 Başlama

```bash
# Hiçbir ek kurulum yok!
# Sadece browser'da açın:
# http://localhost:8888
```

---

**Oluşturulma Tarihi:** Aralık 2025  
**Versiyon:** 2.0 (Modüler)
