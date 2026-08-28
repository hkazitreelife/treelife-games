class KeyboardController {
    constructor(keys, repeat) {
        this.keys = keys;
        this.repeat = repeat;
        this.timers = {};

        document.onkeydown = event => this.keydown(event);
        document.onkeyup = event => this.keyup(event);
        window.onblur = () => this.blur;
    // Touch swipe support
    this._touchStartX = 0;
    this._touchStartY = 0;
    document.addEventListener('touchstart', e => {
      this._touchStartX = e.touches[0].clientX;
      this._touchStartY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - this._touchStartX;
      const dy = e.changedTouches[0].clientY - this._touchStartY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (Math.max(absDx, absDy) < 20) return; // too small, ignore
      if (absDx > absDy) {
        // Horizontal swipe
        const key = dx > 0 ? 'ArrowRight' : 'ArrowLeft';
        if (key in this.keys) { this.keys[key](); }
      } else {
        // Vertical swipe
        const key = dy > 0 ? 'ArrowDown' : 'ArrowUp';
        if (key in this.keys) { this.keys[key](); }
      }
    }, { passive: true });

    }

    keydown(event) {
        event.stopPropagation();
        const code = event.code;
        if (!(code in this.keys)) return true;
        if (!(code in this.timers)) {
            this.timers[code] = null;
            this.keys[code]();
            if (this.repeat) this.timers[code] = setInterval(this.keys[code], this.repeat);
        }
        return false;
    }

    keyup(event) {
        const code = event.code;
        if (code in this.timers) {
            if (this.timers[code]) clearInterval(this.timers[code]);
            delete this.timers[code];
        }
    }

    blur() {
        for (let key in this.timers)
            if (this.timers[key]) clearInterval(this.timers[key]);
        this.timers = {};
    }
}

export default KeyboardController;