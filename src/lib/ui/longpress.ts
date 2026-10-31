/**
 * Svelte action: call `handler` after holding a pointer for `ms` without moving.
 * The click that follows a long press is swallowed so it doesn't also open the item.
 */
export function longpress(node: HTMLElement, handler: () => void, ms = 450) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start = { x: 0, y: 0 };
  let fired = false;

  const cancel = () => clearTimeout(timer);
  const down = (e: PointerEvent) => {
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      fired = true;
      navigator.vibrate?.(30);
      handler();
    }, ms);
  };
  const move = (e: PointerEvent) => {
    if (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10) cancel();
  };
  const click = (e: MouseEvent) => {
    if (fired) {
      e.preventDefault();
      e.stopPropagation();
      fired = false;
    }
  };
  const menu = (e: Event) => fired && e.preventDefault();

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', cancel);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', menu);
  return {
    update(next: () => void) {
      handler = next;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', cancel);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', menu);
    }
  };
}
