export class InputManager {
  public keys: { [key: string]: boolean } = {};
  public mousePos: { x: number; y: number } = { x: 0, y: 0 };
  public mouseLeftDown: boolean = false;
  public mouseRightDown: boolean = false;
  public mouseLeftPressed: boolean = false; // Triggered once per click
  public mouseRightPressed: boolean = false;

  /** Mobile input: a short touch is a contextual battlefield tap. */
  public touchTapPressed = false;
  /** Screen-space drag accumulated this frame; Camera consumes it as map pan. */
  public panDeltaX = 0;
  public panDeltaY = 0;
  public lastPointerType: 'mouse' | 'touch' | 'pen' = 'mouse';

  private activeTouchPointerId: number | null = null;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchLastX = 0;
  private touchLastY = 0;
  private touchMoved = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    window.addEventListener('mousemove', (e) => {
      this.lastPointerType = 'mouse';
      this.mousePos.x = e.clientX;
      this.mousePos.y = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
      this.lastPointerType = 'mouse';
      if (e.button === 0) {
        this.mouseLeftDown = true;
        this.mouseLeftPressed = true;
      } else if (e.button === 2) {
        this.mouseRightDown = true;
        this.mouseRightPressed = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseLeftDown = false;
      else if (e.button === 2) this.mouseRightDown = false;
    });

    // Touch is bound to the battlefield canvas only, so HUD taps never leak into game orders.
    const canvas = document.getElementById('game-canvas');
    if (canvas) {
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
        if (this.activeTouchPointerId !== null) return;
        this.lastPointerType = e.pointerType === 'pen' ? 'pen' : 'touch';
        this.activeTouchPointerId = e.pointerId;
        this.touchStartX = e.clientX;
        this.touchStartY = e.clientY;
        this.touchLastX = e.clientX;
        this.touchLastY = e.clientY;
        this.touchMoved = false;
        this.mousePos.x = e.clientX;
        this.mousePos.y = e.clientY;
        canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      });

      canvas.addEventListener('pointermove', (e) => {
        if (e.pointerId !== this.activeTouchPointerId) return;
        this.mousePos.x = e.clientX;
        this.mousePos.y = e.clientY;
        const dx = e.clientX - this.touchLastX;
        const dy = e.clientY - this.touchLastY;
        const total = Math.hypot(e.clientX - this.touchStartX, e.clientY - this.touchStartY);
        if (this.touchMoved || total > 10) {
          this.touchMoved = true;
          this.panDeltaX += dx;
          this.panDeltaY += dy;
        }
        this.touchLastX = e.clientX;
        this.touchLastY = e.clientY;
        e.preventDefault();
      });

      const finishTouch = (e: PointerEvent) => {
        if (e.pointerId !== this.activeTouchPointerId) return;
        this.mousePos.x = e.clientX;
        this.mousePos.y = e.clientY;
        const total = Math.hypot(e.clientX - this.touchStartX, e.clientY - this.touchStartY);
        if (!this.touchMoved && total <= 12) {
          this.touchTapPressed = true;
        }
        this.activeTouchPointerId = null;
        this.touchMoved = false;
        canvas.releasePointerCapture?.(e.pointerId);
        e.preventDefault();
      };

      canvas.addEventListener('pointerup', finishTouch);
      canvas.addEventListener('pointercancel', (e) => {
        if (e.pointerId !== this.activeTouchPointerId) return;
        this.activeTouchPointerId = null;
        this.touchMoved = false;
      });
    }

    // Prevent context menu on right click
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  // Call this at the end of every frame update
  public resetFrameState() {
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
    this.touchTapPressed = false;
    this.panDeltaX = 0;
    this.panDeltaY = 0;
  }
}
