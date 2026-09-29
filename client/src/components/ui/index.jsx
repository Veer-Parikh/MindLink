import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { initials } from "../../lib/format.js";
import { languageFor } from "../../lib/languages.js";

export function LogoMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="ml-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#10131b" stroke="rgba(255,255,255,0.08)" />
      <circle cx="12" cy="16" r="5.5" fill="none" stroke="url(#ml-logo-g)" strokeWidth="2.6" />
      <circle cx="20" cy="16" r="5.5" fill="none" stroke="url(#ml-logo-g)" strokeWidth="2.6" />
    </svg>
  );
}

export function Logo({ size = 28, showText = true }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      {showText && <span>MindLink</span>}
    </span>
  );
}

export function Avatar({ user, size = 28, online = false, ring, title }) {
  if (!user) return null;
  return (
    <span
      className="avatar"
      style={{
        "--size": `${size}px`,
        background: user.color,
        boxShadow: ring ? `0 0 0 2px var(--panel), 0 0 0 4px ${ring}` : undefined,
      }}
      data-tip={title ?? user.name}
    >
      {initials(user.name)}
      {online && <span className="avatar-dot" />}
    </span>
  );
}

export function AvatarStack({ users, size = 26, max = 4, onClick }) {
  const shown = users.slice(0, max);
  const extra = users.length - shown.length;
  return (
    <div className="avatar-stack">
      {shown.map((u) => (
        <span key={u.id} onClick={onClick ? () => onClick(u) : undefined} style={{ cursor: onClick ? "pointer" : undefined }}>
          <Avatar user={u} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="avatar-more"
          data-tip={users
            .slice(max)
            .map((u) => u.name)
            .join(", ")}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}

export function FileIcon({ name, size = 16 }) {
  const lang = languageFor(name);
  const glyph = lang.glyph ?? "•";
  return (
    <span
      className="file-icon"
      style={{ "--c": lang.color, width: size, height: size, fontSize: glyph.length > 2 ? size * 0.42 : size * 0.52 }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Spinner({ size = 16 }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Modal({ open, onClose, title, description, icon, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
        >
          <motion.div
            className={`modal ${wide ? "modal-wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {title && (
              <div className="modal-header">
                {icon && <div className="modal-icon">{icon}</div>}
                <div>
                  <h2>{title}</h2>
                  {description && <p>{description}</p>}
                </div>
                <button className="icon-btn" onClick={onClose} aria-label="Close">
                  <X />
                </button>
              </div>
            )}
            {children}
            {footer && <div className="modal-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Floating menu positioned at a point (context menu) or under an element.
 * items: [{ label, icon: Component, onClick, danger, kbd, disabled } | "sep"]
 */
export function Menu({ open, at, onClose, items, align = "left" }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !at || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let x = align === "right" ? at.x - rect.width : at.x;
    let y = at.y;
    x = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    if (y + rect.height > window.innerHeight - 8) y = Math.max(8, (at.top ?? at.y) - rect.height - 4);
    setPos({ x, y });
  }, [open, at, align]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <motion.div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y, visibility: pos ? "visible" : "hidden" }}
      initial={{ opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.12 }}
    >
      {items.filter(Boolean).map((item, i) =>
        item === "sep" ? (
          <div key={`sep-${i}`} className="menu-sep" />
        ) : (
          <button
            key={item.label}
            className={`menu-item ${item.danger ? "danger" : ""}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            {item.icon && <item.icon />}
            <span>{item.label}</span>
            {item.kbd && <Kbd>{item.kbd}</Kbd>}
          </button>
        ),
      )}
    </motion.div>,
    document.body,
  );
}

/** Anchor helper: turns a click event on a button into a menu position below it. */
export function anchorBelow(event, align = "left") {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: align === "right" ? rect.right : rect.left, y: rect.bottom + 6, top: rect.top };
}

/** One global tooltip for every element with a data-tip attribute. */
export function TooltipLayer() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let timer = 0;
    let current = null;
    const show = (e) => {
      const el = e.target.closest?.("[data-tip]");
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      setTip(null);
      if (!el || !el.getAttribute("data-tip")) return;
      timer = setTimeout(() => {
        const rect = el.getBoundingClientRect();
        const placement = el.getAttribute("data-tip-side") ?? (rect.top < 60 ? "bottom" : "top");
        setTip({ text: el.getAttribute("data-tip"), rect, placement });
      }, 380);
    };
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("pointerdown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide, true);
      clearTimeout(timer);
    };
  }, []);

  const ref = useRef(null);
  const [style, setStyle] = useState(null);
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const { rect, placement } = tip;
    let left = rect.left + rect.width / 2 - box.width / 2;
    let top =
      placement === "bottom"
        ? rect.bottom + 8
        : placement === "right"
          ? rect.top + rect.height / 2 - box.height / 2
          : rect.top - box.height - 8;
    if (placement === "right") left = rect.right + 8;
    left = Math.max(6, Math.min(left, window.innerWidth - box.width - 6));
    top = Math.max(6, top);
    setStyle({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={ref} className="tooltip" style={{ left: style?.left ?? -9999, top: style?.top ?? -9999 }}>
      {tip.text}
    </div>,
    document.body,
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty-state">
      {Icon && (
        <div className="empty-icon">
          <Icon />
        </div>
      )}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function PageLoader({ label = "Loading…" }) {
  return (
    <div className="page-loader">
      <div className="pulse-logo">
        <LogoMark size={44} />
      </div>
      <span>{label}</span>
    </div>
  );
}
