// Lines the game prints when its window cannot be created, each tied to the GLFW error code
// or to the game's own message. A bare 'WGL: Failed to create OpenGL context' is not one of
// them: a mod that probes OpenGL versions logs every miss that way on a machine that opens its
// window a moment later. LWJGL 2 lines ('Couldn't set pixel format') are left out as well: old
// versions try once more.
const WINDOW_FAILURE_SIGNS: readonly RegExp[] = [
  /Failed to create window: /,
  /GLFW error (?:65542|65543)\b/,
  /GLFW error 65544: (?:WGL|GLX|EGL)\b/,
  /GLFW error (?:during|before) init: \[0x1000[78]\](?:WGL|GLX|EGL): /,
];

// Lines printed once a window exists. 'LWJGL Version: ' is not here: LWJGL 2 versions print it
// before the window is created.
const WINDOW_READY_SIGNS: readonly RegExp[] = [
  /Reloading ResourceManager/,
  /OpenAL initialized/,
  /Sound engine started/,
  /Created: \d+x\d+(?:x\d+)? \S*-atlas/,
];

export const WINDOW_SIGN_TAIL = 2048;

export function isWindowFailure(text: string): boolean {
  return WINDOW_FAILURE_SIGNS.some((sign) => sign.test(text));
}

export function isWindowReady(text: string): boolean {
  return WINDOW_READY_SIGNS.some((sign) => sign.test(text));
}
