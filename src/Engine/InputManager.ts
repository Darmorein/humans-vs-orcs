export class InputManager {
  public keys: { [key: string]: boolean } = {};
  public mousePos: { x: number, y: number } = { x: 0, y: 0 };
  public mouseLeftDown: boolean = false;
  public mouseRightDown: boolean = false;
  public mouseLeftPressed: boolean = false; // Triggered once per click
  public mouseRightPressed: boolean = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    window.addEventListener('mousemove', (e) => {
      this.mousePos.x = e.clientX;
      this.mousePos.y = e.clientY;
    });

    window.addEventListener('mousedown', (e) => {
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

    // Prevent context menu on right click
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  // Call this at the end of every frame update
  public resetFrameState() {
    this.mouseLeftPressed = false;
    this.mouseRightPressed = false;
  }
}
