import { useEffect, useLayoutEffect, useRef, useState } from "react";

const STORAGE_KEY = "codep.sidebarWidth";
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 260;
const CONVERSATION_MIN_WIDTH = 640;

function maximumWidth(): number {
  return Math.max(MIN_WIDTH, Math.min(720, window.innerWidth - CONVERSATION_MIN_WIDTH));
}

function savedWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(value) && value >= MIN_WIDTH) return Math.min(720, value);
  } catch {
    // Resizing also works when local storage is unavailable.
  }
  return DEFAULT_WIDTH;
}

export function SidebarResizer({ label, resetLabel }: { label: string; resetLabel: string }) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(savedWidth);
  const [maxWidth, setMaxWidth] = useState(maximumWidth);
  const [isDragging, setIsDragging] = useState(false);
  const width = Math.max(MIN_WIDTH, Math.min(preferredWidth, maxWidth));

  useLayoutEffect(() => {
    handleRef.current?.parentElement?.style.setProperty("--sidebar-width", `${width}px`);
  }, [width]);

  useEffect(() => {
    const onResize = () => setMaxWidth(maximumWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(preferredWidth));
    } catch {
      // Width persistence is optional.
    }
  }, [preferredWidth]);

  useLayoutEffect(() => {
    if (!isDragging) return;
    const shell = handleRef.current?.parentElement;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    shell?.classList.add("sidebarResizing");
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      shell?.classList.remove("sidebarResizing");
    };
  }, [isDragging]);

  const updateWidth = (value: number) => {
    setPreferredWidth(Math.round(Math.max(MIN_WIDTH, Math.min(maximumWidth(), value))));
  };
  const stopDragging = () => {
    dragRef.current = null;
    setIsDragging(false);
  };

  return (
    <div
      ref={handleRef}
      className="sidebarResizer"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls="sessionSidebar"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      title={`${label} · ${resetLabel}`}
      data-dragging={isDragging}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        setIsDragging(true);
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId) {
          updateWidth(drag.startWidth + event.clientX - drag.startX);
        }
      }}
      onPointerUp={event => {
        if (dragRef.current?.pointerId !== event.pointerId) return;
        stopDragging();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onDoubleClick={() => updateWidth(DEFAULT_WIDTH)}
      onKeyDown={event => {
        const step = event.shiftKey ? 40 : 16;
        const nextWidth = {
          ArrowLeft: width - step,
          ArrowRight: width + step,
          Home: MIN_WIDTH,
          End: maxWidth
        }[event.key];
        if (nextWidth === undefined) return;
        event.preventDefault();
        updateWidth(nextWidth);
      }}
    />
  );
}
