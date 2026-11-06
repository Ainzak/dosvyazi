import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export function useVideoFullscreen() {
  const container = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const target = container.current;
    let wasActive = false;
    const changed = () => {
      const active = document.fullscreenElement === target;
      setFullscreen(active);
      if (!active && wasActive) button.current?.focus();
      wasActive = active;
    };
    document.addEventListener('fullscreenchange', changed);
    return () => {
      alive.current = false;
      document.removeEventListener('fullscreenchange', changed);
      if (target && document.fullscreenElement === target) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const close = () => {
    if (document.fullscreenElement === container.current) {
      void document.exitFullscreen().catch(() => {});
    } else { setFullscreen(false); button.current?.focus(); }
  };
  const toggle = () => {
    if (fullscreen) { close(); return; }
    const target = container.current;
    if (!target) return;
    const fallback = () => { if (alive.current && target.isConnected) setFullscreen(true); };
    // Keep the same video element/track. Browsers without this API expand inside the window.
    if (!target.requestFullscreen || !document.fullscreenEnabled) { fallback(); return; }
    void target.requestFullscreen().catch(fallback);
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!fullscreen) return;
    if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
      const next = event.shiftKey ? controls.at(-1) : controls[0];
      const edge = event.shiftKey ? controls[0] : controls.at(-1);
      if (document.activeElement === edge) { event.preventDefault(); next?.focus(); }
    }
  };
  return { container, button, fullscreen, toggle, keyDown };
}
