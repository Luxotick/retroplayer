/**
 * UI Helpers Module
 * Genel UI işlemleri ve yardımcı fonksiyonlar
 */

import { DOMElements } from './domElements.js';
import { URLS, UI } from './constants.js';

export class UIHelpers {
  constructor() {
    this.marqueeTargets = new Set();
    this.marqueeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(entries => {
        entries.forEach(entry => {
          this.updateMarquee(entry.target);
        });
      })
      : null;
    this.currentThemeArt = null;
    this.themeRunId = 0;

    // Background usage optimization (Active Window Check)
    const handleActivityChange = () => {
      if (document.hidden || !document.hasFocus()) {
        document.body.classList.add('paused-animations');
      } else {
        document.body.classList.remove('paused-animations');
        // Force marquee update when regaining focus to ensure sync
        this.marqueeTargets.forEach(t => this.updateMarquee(t));
      }
    };

    document.addEventListener('visibilitychange', handleActivityChange);
    window.addEventListener('blur', handleActivityChange);
    window.addEventListener('focus', handleActivityChange);
  }

  /**
   * Kontrolları devre dışı bırak
   */
  disableControls() {
    const buttons = [
      DOMElements.playButton,
      DOMElements.prevButton,
      DOMElements.nextButton,
      DOMElements.playlistPlayButton,
      DOMElements.volumeDownButton,
      DOMElements.volumeUpButton,
      DOMElements.resumePlaybackButton
    ];

    const inputs = [DOMElements.volumeSlider];

    buttons.forEach(btn => {
      if (btn) btn.disabled = true;
    });

    inputs.forEach(input => {
      if (input) input.disabled = true;
    });
  }

  /**
   * Kontrolları aktif hale getir
   */
  enableControls() {
    const buttons = [
      DOMElements.playButton,
      DOMElements.prevButton,
      DOMElements.nextButton,
      DOMElements.playlistPlayButton,
      DOMElements.volumeDownButton,
      DOMElements.volumeUpButton,
      DOMElements.resumePlaybackButton
    ];

    const inputs = [DOMElements.volumeSlider];

    buttons.forEach(btn => {
      if (btn) btn.disabled = false;
    });

    inputs.forEach(input => {
      if (input) input.disabled = false;
    });
  }

  /**
   * Giriş ekranını göster
   */
  showLogin() {
    const appLoading = document.getElementById('app-loading');
    if (appLoading) {
      appLoading.classList.add('hidden');
    }

    if (DOMElements.loginContainer) {
      DOMElements.loginContainer.classList.remove('hidden');
      // Reset login state
      const loginActions = document.getElementById('login-actions');
      const loginLoading = document.getElementById('login-loading');
      if (loginActions) loginActions.classList.remove('hidden');
      if (loginLoading) loginLoading.classList.add('hidden');
    }
    if (DOMElements.playerContainer) {
      DOMElements.playerContainer.classList.add('hidden');
    }
  }

  /**
   * Oynatıcı ekranını göster
   */
  showPlayer() {
    const appLoading = document.getElementById('app-loading');
    if (appLoading) {
      appLoading.classList.add('hidden');
    }

    if (DOMElements.loginContainer) {
      DOMElements.loginContainer.classList.add('hidden');
    }
    if (DOMElements.playerContainer) {
      DOMElements.playerContainer.classList.remove('hidden');
    }
  }

  /**
   * Süreyi MM:SS formatına çevir
   */
  formatDuration(durationMs) {
    if (!durationMs || typeof durationMs !== 'number') {
      return '0:00';
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Değeri min-max arasında sınırla
   */
  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * İlerleme çubuğunu güncelle
   */
  updateProgress(state) {
    if (!DOMElements.progressBar) return;

    if (!state || typeof state.duration !== 'number' || state.duration <= 0) {
      DOMElements.progressBar.style.width = '0%';
      return;
    }

    const position = Math.max(0, typeof state.position === 'number' ? state.position : 0);
    const percent = Math.min((position / state.duration) * 100, 100);
    DOMElements.progressBar.style.width = `${percent}%`;

    if (DOMElements.timeDisplay) {
      DOMElements.timeDisplay.textContent = `${this.formatDuration(position)} / ${this.formatDuration(state.duration)}`;
    }
  }

  updateVolumeDisplay(volume) {
    if (DOMElements.volumePercent) {
      DOMElements.volumePercent.textContent = `${Math.round(volume * 100)}%`;
    }
  }

  /**
   * Oynatma butonunu güncelle
   */
  updatePlayButton(paused) {
    if (DOMElements.playButton) {
      DOMElements.playButton.textContent = paused ? 'PLAY' : 'PAUSE';
    }
  }

  /**
   * Şu an oynatılan track'i göster
   */
  updateNowPlaying(track, placeholderArt = URLS.PLACEHOLDER_ALBUM_ART) {
    const safeTrack = track || {};

    if (DOMElements.trackNameEl) {
      const newName = safeTrack.name || 'Unknown Track';
      if (DOMElements.trackNameEl.textContent !== newName) {
        DOMElements.trackNameEl.textContent = newName;
      }
    }

    if (DOMElements.artistNameEl) {
      const artistNames = Array.isArray(safeTrack.artists)
        ? safeTrack.artists.map(artist => artist.name).filter(Boolean).join(', ')
        : 'Unknown Artist';
      const newArtistText = artistNames || 'Unknown Artist';
      if (DOMElements.artistNameEl.textContent !== newArtistText) {
        DOMElements.artistNameEl.textContent = newArtistText;
      }
    }

    const artUrl = safeTrack.album?.images?.[0]?.url || placeholderArt;

    if (DOMElements.albumArtEl) {
      DOMElements.albumArtEl.src = artUrl;
    }

    void this.applyAlbumTheming(artUrl);
  }

  /**
   * Like butonunu güncelle
   */
  updateLikeButton(isLiked) {
    if (DOMElements.likeButton) {
      if (isLiked) {
        DOMElements.likeButton.classList.add('liked');
        DOMElements.likeButton.setAttribute('aria-label', 'Unlike Song');
      } else {
        DOMElements.likeButton.classList.remove('liked');
        DOMElements.likeButton.setAttribute('aria-label', 'Like Song');
      }
    }
  }

  /**
   * Albüm kapağına göre AKILLI arka plan teması uygular.
   * Konsentrik dairelerden renk analizi yapar.
   */
  async applyAlbumTheming(imageUrl) {
    if (!imageUrl) {
      this.resetAlbumTheming();
      return;
    }

    const runId = ++this.themeRunId;

    try {
      // 1. Konsentrik Renk Analizi (6 daire)
      const colors = await this.extractConcentricColors(imageUrl, 6);

      if (runId !== this.themeRunId) return;

      // 2. Gradient Oluşturma
      // colors[0] -> Merkez (En iç)
      // colors[5] -> Dış (En dış)

      const stops = colors.map((color, index) => {
        const percent = Math.round((index / (colors.length - 1)) * 100);
        return `${color} ${percent}%`;
      }).join(', ');

      const appGradient = `radial-gradient(circle at center, ${stops})`;

      // Panel için: Merkezden dışa doğru linear gradient
      const panelGradient = `linear-gradient(135deg, ${colors[0]} 0%, ${colors[colors.length - 1]} 100%)`;

      // Border rengi: Ortadaki renklerden biri
      const colorBorder = colors[2] || colors[0];

      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--app-bg', appGradient);
      rootStyle.setProperty('--panel-bg', panelGradient);
      rootStyle.setProperty('--panel-border', colorBorder);

      // Metin rengi: Panel arka planının (genellikle sol üst yani colors[0]) parlaklığına göre
      const rgbMatch = colors[0].match(/\d+/g);
      let textColor = '#ffffff';

      if (rgbMatch) {
        const [r, g, b] = rgbMatch.map(Number);
        const [h, s, l] = this.rgbToHslRaw(r, g, b);
        // Parlaklık > 0.6 ise siyah yazı
        textColor = l > 0.6 ? '#000000' : '#ffffff';
      }

      rootStyle.setProperty('--app-text', textColor);

      this.currentThemeArt = imageUrl;

    } catch (error) {
      console.warn('Album theming failed:', error);
      if (runId === this.themeRunId) this.resetAlbumTheming();
    }
  }

  /**
   * Albüm kapağını eş merkezli dairelere bölerek her bölgedeki baskın rengi bulur.
   */
  async extractConcentricColors(imageUrl, circleCount = 6) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    await img.decode();

    const size = 100;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);

    const { data } = ctx.getImageData(0, 0, size, size);
    const centerX = size / 2;
    const centerY = size / 2;

    // Köşeleri de kapsasın diye yarıçapı genişletiyoruz
    const realMaxRadius = Math.sqrt((size / 2) ** 2 + (size / 2) ** 2);
    const ringWidth = realMaxRadius / circleCount;

    const ringColorMaps = Array.from({ length: circleCount }, () => new Map());
    const QUANTIZATION = 10; // Daha hassas renk ayrımı

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < 128) continue;

        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        let ringIndex = Math.floor(distance / ringWidth);
        if (ringIndex >= circleCount) ringIndex = circleCount - 1;

        const rr = Math.floor(r / QUANTIZATION) * QUANTIZATION;
        const gg = Math.floor(g / QUANTIZATION) * QUANTIZATION;
        const bb = Math.floor(b / QUANTIZATION) * QUANTIZATION;

        const key = `${rr},${gg},${bb}`;
        const map = ringColorMaps[ringIndex];

        if (!map.has(key)) {
          map.set(key, { r: rr, g: gg, b: bb, count: 0 });
        }
        map.get(key).count++;
      }
    }

    return ringColorMaps.map(map => {
      let bestColor = { r: 0, g: 0, b: 0 };
      let maxCount = -1;

      for (const color of map.values()) {
        if (color.count > maxCount) {
          maxCount = color.count;
          bestColor = color;
        }
      }
      // Eğer hiç piksel yoksa siyah döndür
      if (maxCount === -1) return 'rgb(0,0,0)';

      return `rgb(${bestColor.r}, ${bestColor.g}, ${bestColor.b})`;
    });
  }

  // Yardımcı: CSS uyumlu HSL (0-360, 0-100, 0-100)
  rgbToHsl(r, g, b) {
    const [h, s, l] = this.rgbToHslRaw(r, g, b);
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  }

  // Yardımcı: Hesaplama için Ham HSL (0-1, 0-1, 0-1)
  rgbToHslRaw(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h, s, l];
  }

  resetAlbumTheming() {
    const rootStyle = document.documentElement.style;
    rootStyle.removeProperty('--app-bg');
    rootStyle.removeProperty('--panel-bg');
    rootStyle.removeProperty('--panel-border');
    rootStyle.removeProperty('--app-text');
    this.currentThemeArt = null;
  }

  /**
   * Marquee hedefini işaretle
   */
  markMarqueeTarget(element) {
    if (!element) return;

    if (element.dataset.marqueeTarget === 'true') {
      requestAnimationFrame(() => {
        this.updateMarquee(element);
      });
      return;
    }

    element.dataset.marqueeTarget = 'true';
    this.marqueeTargets.add(element);

    if (this.marqueeObserver) {
      this.marqueeObserver.observe(element);
    }

    requestAnimationFrame(() => {
      this.updateMarquee(element);
    });
  }

  /**
   * Marquee animasyonunu güncelle
   */
  updateMarquee(element) {
    if (!element) return;

    if (!element.isConnected) {
      if (this.marqueeObserver) {
        this.marqueeObserver.unobserve(element);
      }
      this.marqueeTargets.delete(element);
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

    element.style.setProperty('--marquee-gap', `${UI.MARQUEE_GAP}px`);

    const contentWidth = segment.scrollWidth;
    if (!contentWidth) {
      element.classList.remove('marquee');
      element.textContent = text;
      element.removeAttribute('aria-label');
      return;
    }

    element.style.setProperty('--marquee-distance', `${contentWidth}px`);

    const duration = Math.min(
      Math.max(contentWidth / UI.MARQUEE_MIN_SPEED, UI.MARQUEE_MIN_DURATION),
      UI.MARQUEE_MAX_DURATION
    );
    element.style.setProperty('--marquee-duration', `${duration}s`);
  }

  /**
   * Container içindeki marquee hedeflerini kaldır
   */
  removeMarqueeTargetsWithin(container) {
    if (!container) return;

    this.marqueeTargets.forEach(target => {
      if (!target.isConnected || container.contains(target)) {
        if (this.marqueeObserver) {
          this.marqueeObserver.unobserve(target);
        }
        target.removeAttribute('data-marquee-target');
        this.marqueeTargets.delete(target);
      }
    });
  }

  /**
   * Temizle
   */
  destroy() {
    if (this.marqueeObserver) {
      this.marqueeObserver.disconnect();
    }
    this.marqueeTargets.clear();
  }
}

export default UIHelpers;
