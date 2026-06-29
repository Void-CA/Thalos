import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'thalos-layout';

interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
}

const DEFAULTS: LayoutState = {
  leftWidth: 220,
  rightWidth: 320,
  bottomHeight: 200,
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: false,
};

const MIN_PANEL = 60;
const STUB_WIDTH = 24;
const MAX_PANEL_PCT = 0.6;

function loadState(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveState(state: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable (private browsing, quota, etc.)
  }
}

@Injectable({ providedIn: 'root' })
export class LayoutStore {
  private readonly state = signal<LayoutState>(loadState());

  // ── Public signals ──

  readonly leftWidth = signal(this.state().leftWidth);
  readonly rightWidth = signal(this.state().rightWidth);
  readonly bottomHeight = signal(this.state().bottomHeight);
  readonly leftCollapsed = signal(this.state().leftCollapsed);
  readonly rightCollapsed = signal(this.state().rightCollapsed);
  readonly bottomCollapsed = signal(this.state().bottomCollapsed);

  /** Effective width of left panel (24px stub when collapsed). */
  readonly effectiveLeftWidth = signal(
    this.state().leftCollapsed ? STUB_WIDTH : this.state().leftWidth,
  );

  /** Effective width of right panel (24px stub when collapsed). */
  readonly effectiveRightWidth = signal(
    this.state().rightCollapsed ? STUB_WIDTH : this.state().rightWidth,
  );

  /** Effective height of bottom panel (26px stub when collapsed). */
  readonly effectiveBottomHeight = signal(
    this.state().bottomCollapsed ? 26 : this.state().bottomHeight,
  );

  constructor() {
    this.sync();
  }

  // ── Panel width/height setters ──

  setLeftWidth(px: number): void {
    const max = Math.round(window.innerWidth * MAX_PANEL_PCT);
    const clamped = Math.max(MIN_PANEL, Math.min(px, max));
    this.leftWidth.set(clamped);
    this.effectiveLeftWidth.set(clamped);
    this.persist();
  }

  setRightWidth(px: number): void {
    const max = Math.round(window.innerWidth * MAX_PANEL_PCT);
    const clamped = Math.max(MIN_PANEL, Math.min(px, max));
    this.rightWidth.set(clamped);
    this.effectiveRightWidth.set(clamped);
    this.persist();
  }

  setBottomHeight(px: number): void {
    const max = Math.round(window.innerHeight * MAX_PANEL_PCT);
    const clamped = Math.max(MIN_PANEL, Math.min(px, max));
    this.bottomHeight.set(clamped);
    this.effectiveBottomHeight.set(clamped);
    this.persist();
  }

  // ── Collapse toggles ──

  toggleLeft(): void {
    const collapsed = !this.leftCollapsed();
    this.leftCollapsed.set(collapsed);
    this.effectiveLeftWidth.set(collapsed ? STUB_WIDTH : this.leftWidth());
    this.persist();
  }

  toggleRight(): void {
    const collapsed = !this.rightCollapsed();
    this.rightCollapsed.set(collapsed);
    this.effectiveRightWidth.set(collapsed ? STUB_WIDTH : this.rightWidth());
    this.persist();
  }

  toggleBottom(): void {
    const collapsed = !this.bottomCollapsed();
    this.bottomCollapsed.set(collapsed);
    this.effectiveBottomHeight.set(collapsed ? 26 : this.bottomHeight());
    this.persist();
  }

  // ── Persistence ──

  private persist(): void {
    const snap: LayoutState = {
      leftWidth: this.leftWidth(),
      rightWidth: this.rightWidth(),
      bottomHeight: this.bottomHeight(),
      leftCollapsed: this.leftCollapsed(),
      rightCollapsed: this.rightCollapsed(),
      bottomCollapsed: this.bottomCollapsed(),
    };
    saveState(snap);
  }

  private sync(): void {
    const s = this.state();
    this.leftWidth.set(s.leftWidth);
    this.rightWidth.set(s.rightWidth);
    this.bottomHeight.set(s.bottomHeight);
    this.leftCollapsed.set(s.leftCollapsed);
    this.rightCollapsed.set(s.rightCollapsed);
    this.bottomCollapsed.set(s.bottomCollapsed);
    this.effectiveLeftWidth.set(s.leftCollapsed ? STUB_WIDTH : s.leftWidth);
    this.effectiveRightWidth.set(s.rightCollapsed ? STUB_WIDTH : s.rightWidth);
    this.effectiveBottomHeight.set(s.bottomCollapsed ? 26 : s.bottomHeight);
  }
}
