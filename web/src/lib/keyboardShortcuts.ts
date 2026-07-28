import { useEffect } from "react";

export interface MatrixShortcutHandlers {
  onFocusSearch: () => void;
  onEscape: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onOpenHighlighted: () => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

export function useMatrixKeyboardShortcuts(handlers: MatrixShortcutHandlers) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handlers.onEscape();
        return;
      }
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        handlers.onFocusSearch();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        handlers.onMoveDown();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        handlers.onMoveUp();
      } else if (e.key === "Enter") {
        handlers.onOpenHighlighted();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
