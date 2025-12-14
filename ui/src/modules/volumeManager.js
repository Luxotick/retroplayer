/**
 * Volume Manager Module
 * Ses kontrolleri
 */

import { DOMElements } from './domElements.js';
import { UI } from './constants.js';

export class VolumeManager {
  constructor(playerController, uiHelpers) {
    this.playerController = playerController;
    this.uiHelpers = uiHelpers;
    this.currentVolume = UI.DEFAULT_VOLUME;
  }

  /**
   * Ses seviyesini ayarla
   */
  async setVolume(value, options = {}) {
    const { updateSlider = true } = options;

    const clamped = this.uiHelpers.clamp(value, 0, 1);
    this.currentVolume = clamped;

    if (updateSlider && DOMElements.volumeSlider) {
      DOMElements.volumeSlider.value = Math.round(clamped * 100);
    }

    return this.playerController.setVolume(clamped);
  }

  /**
   * Ses seviyesini artır/azalt
   */
  adjustVolume(delta) {
    const newVolume = this.uiHelpers.clamp(this.currentVolume + delta, 0, 1);
    return this.setVolume(newVolume);
  }

  /**
   * Ses kontrol event'lerini kur
   */
  setupControls() {
    const { volumeSlider, volumeDownButton, volumeUpButton } = DOMElements;

    if (volumeSlider) {
      volumeSlider.value = Math.round(this.currentVolume * 100);
      volumeSlider.disabled = true;
      volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value / 100;
        this.playerController.setVolume(volume);
        this.uiHelpers.updateVolumeDisplay(volume);
      });
    }

    if (volumeDownButton) {
      volumeDownButton.disabled = true;
      volumeDownButton.addEventListener('click', () => {
        void this.adjustVolume(-UI.VOLUME_STEP);
      });
    }

    if (volumeUpButton) {
      volumeUpButton.disabled = true;
      volumeUpButton.addEventListener('click', () => {
        void this.adjustVolume(UI.VOLUME_STEP);
      });
    }
  }

  /**
   * Ses kontrol butonlarını aktif et
   */
  enableControls() {
    if (DOMElements.volumeSlider) {
      DOMElements.volumeSlider.disabled = false;
    }
    if (DOMElements.volumeDownButton) {
      DOMElements.volumeDownButton.disabled = false;
    }
    if (DOMElements.volumeUpButton) {
      DOMElements.volumeUpButton.disabled = false;
    }
  }

  /**
   * Ses kontrol butonlarını devre dışı bırak
   */
  disableControls() {
    if (DOMElements.volumeSlider) {
      DOMElements.volumeSlider.disabled = true;
    }
    if (DOMElements.volumeDownButton) {
      DOMElements.volumeDownButton.disabled = true;
    }
    if (DOMElements.volumeUpButton) {
      DOMElements.volumeUpButton.disabled = true;
    }
  }

  /**
   * Mevcut ses seviyesini döndür
   */
  getVolume() {
    return this.currentVolume;
  }
}

export default VolumeManager;
