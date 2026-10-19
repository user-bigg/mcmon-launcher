import { SkinViewer, WalkingAnimation, type PlayerObject } from 'skinview3d';
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Sheet } from './skin-draw';

export interface FigureOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  still: boolean;
  shadowColor: string;
  onDrag: () => void;
}

export interface Figure {
  setSkin: (sheet: Sheet, slim: boolean) => void;
  setCape: (sheet: Sheet | null) => void;
  face: (back: boolean) => void;
  setWalking: (walking: boolean) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

const DEG = Math.PI / 180;
const FRONT = 0.5;
const BACK = Math.PI - FRONT;
const FOV = 38;
const ZOOM = 0.82;
const MIN_POLAR = Math.PI * 0.36;
const MAX_POLAR = Math.PI * 0.53;
const TURN_EASE = 0.12;
const WALK_SPEED = 0.55;
const GAIT_START_EASE = 0.08;
const GAIT_STOP_EASE = 0.157;
const SWAY_PER_MS = 0.0011;
const FEET_Y = -16.05;
const SHADOW_SIZE = 22;
const SHADOW_PIXELS = 128;
const SHADOW_ALPHA = 0.6;
const MAX_PIXEL_RATIO = 2;

// The cape as in the game: it hangs at 6° while standing, flies back to about 17° and sways with
// the steps while walking. One animation blends both, so the figure eases into a walk and back
// instead of snapping between two poses.
class Motion extends WalkingAnimation {
  walking = false;
  private weight = 0;

  snap(): void {
    this.weight = this.walking ? 1 : 0;
  }

  protected override animate(player: PlayerObject): void {
    super.animate(player);
    // As in the game: the size of a step fades by 0.4 per tick (0.157 per frame at 60 fps) and
    // the step phase advances by that same size, so a stopping figure finishes the swing it is
    // in and does not take extra shrinking steps.
    this.weight += this.walking
      ? (1 - this.weight) * GAIT_START_EASE
      : -this.weight * GAIT_STOP_EASE;
    this.speed = WALK_SPEED * (this.walking ? 1 : this.weight);
    const gait = this.weight;
    const idle = 1 - gait;
    const sway = Math.sin(performance.now() * SWAY_PER_MS);
    const { leftArm, rightArm, leftLeg, rightLeg } = player.skin;
    for (const limb of [leftArm, rightArm, leftLeg, rightLeg]) {
      limb.rotation.x *= gait;
    }
    leftArm.rotation.z = leftArm.rotation.z * gait + (2 + sway) * DEG * idle;
    rightArm.rotation.z = rightArm.rotation.z * gait - (2 + sway) * DEG * idle;
    const t = this.progress * 8;
    player.cape.rotation.x = ((17 + Math.sin(t * 2) * 4) * gait + (6 + sway * 1.2) * idle) * DEG;
    player.cape.rotation.z = Math.sin(t) * 1.5 * DEG * gait;
  }
}

function shadowSpot(color: string): HTMLCanvasElement {
  const spot = document.createElement('canvas');
  spot.width = SHADOW_PIXELS;
  spot.height = SHADOW_PIXELS;
  const ctx = spot.getContext('2d');
  if (ctx !== null) {
    const half = SHADOW_PIXELS / 2;
    const fade = ctx.createRadialGradient(half, half, 4, half, half, half);
    fade.addColorStop(0, color);
    fade.addColorStop(1, 'transparent');
    ctx.globalAlpha = SHADOW_ALPHA;
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, SHADOW_PIXELS, SHADOW_PIXELS);
  }
  return spot;
}

function rest(player: PlayerObject): void {
  const { leftArm, rightArm, leftLeg, rightLeg } = player.skin;
  for (const limb of [leftArm, rightArm, leftLeg, rightLeg]) {
    limb.rotation.set(0, 0, 0);
  }
  player.cape.rotation.x = 6 * DEG;
  player.cape.rotation.z = 0;
}

export function createFigure(options: FigureOptions): Figure {
  const viewer = new SkinViewer({
    canvas: options.canvas,
    width: options.width,
    height: options.height,
    pixelRatio: Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
    fov: FOV,
    zoom: ZOOM,
  });
  const { controls, playerObject } = viewer;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.minPolarAngle = MIN_POLAR;
  controls.maxPolarAngle = MAX_POLAR;
  viewer.globalLight.intensity = 2.6;
  viewer.cameraLight.intensity = 0.9;

  const shadowMap = new CanvasTexture(shadowSpot(options.shadowColor));
  const shadowShape = new PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE);
  const shadowPaint = new MeshBasicMaterial({
    map: shadowMap,
    transparent: true,
    depthWrite: false,
  });
  const shadow = new Mesh(shadowShape, shadowPaint);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = FEET_Y;
  playerObject.add(shadow);

  const motion = new Motion();
  motion.speed = WALK_SPEED;
  motion.headBobbing = false;

  let angle = FRONT;
  let target = FRONT;
  let held = false;
  let frame = 0;
  playerObject.rotation.y = angle;

  const onStart = (): void => {
    held = true;
    options.onDrag();
  };
  controls.addEventListener('start', onStart);

  function spin(): void {
    if (!held) {
      angle = options.still ? target : angle + (target - angle) * TURN_EASE;
      playerObject.rotation.y = angle;
    }
    frame = requestAnimationFrame(spin);
  }
  spin();

  function setWalking(walking: boolean): void {
    motion.walking = walking;
    if (options.still) {
      rest(playerObject);
      motion.snap();
      viewer.animation = walking ? motion : null;
      return;
    }
    // Assigning an animation, even the same one, rewinds it to the first frame.
    if (viewer.animation !== motion) {
      viewer.animation = motion;
    }
  }

  return {
    setSkin: (sheet, slim): void => {
      viewer.loadSkin(sheet, { model: slim ? 'slim' : 'default' });
    },
    setCape: (sheet): void => {
      if (sheet === null) {
        viewer.loadCape(null);
      } else {
        viewer.loadCape(sheet, { backEquipment: 'cape' });
      }
    },
    face: (back): void => {
      held = false;
      viewer.resetCameraPose();
      target = back ? BACK : FRONT;
    },
    setWalking,
    resize: (width, height): void => {
      viewer.setSize(width, height);
    },
    dispose: (): void => {
      cancelAnimationFrame(frame);
      controls.removeEventListener('start', onStart);
      playerObject.remove(shadow);
      shadowShape.dispose();
      shadowPaint.dispose();
      shadowMap.dispose();
      viewer.dispose();
    },
  };
}
