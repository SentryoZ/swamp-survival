// Tiny event bus so combat/enemies don't import specific weapons or UI.
// e.g. weapons register onKill -> gas; UI registers onDeath -> gameOver.
const listeners = new Map();

export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(fn);
}

export function emit(name, ...args) {
  const fns = listeners.get(name);
  if (!fns) return;
  for (const fn of fns) fn(...args);
}
