import { Injectable, signal } from '@angular/core';
import type { WaypointModel, PlanModel, SegmentError, WaypointType, SegmentModel } from './planning.types';

// ── Persistence schema ──

interface PersistedState {
  version: number;
  plans: PlanModel[];
  activePlanId: string | null;
}

const STORAGE_KEY = 'thalos-plans';
const CURRENT_VERSION = 1;

/**
 * Store de planificación — estado compartido entre los paneles Waypoints,
 * Plan Management y el Scene Viewer.
 *
 * Sigue el patrón ModeStore: signals + métodos, sin RxJS event-sourcing.
 * Persiste planes en localStorage bajo la clave `thalos-plans`.
 *
 * Carga el estado persistido al construirse (app init).
 */
@Injectable({ providedIn: 'root' })
export class PlanningStore {
  // ── Signals ──

  /** Lista de segmentos del plan en edición. */
  readonly segments = signal<SegmentModel[]>([]);

  /** Lista de waypoints del plan activo. */
  readonly waypoints = signal<WaypointModel[]>([]);

  /** ID del waypoint seleccionado (para highlight en panel + 3D). */
  readonly selectedWaypointId = signal<string | null>(null);

  /** Todos los planes guardados en localStorage. */
  readonly plans = signal<PlanModel[]>([]);

  /** ID del plan activo (carga actual). */
  readonly activePlanId = signal<string | null>(null);

  /** Errores de validación por segmento (desde 422). */
  readonly segmentErrors = signal<SegmentError[]>([]);

  constructor() {
    this.loadFromStorage();
  }

  // ── Waypoint methods ──

  /** Agrega un waypoint y lo selecciona. Inserta después del waypoint con afterId,
   *  o al final si no se especifica. */
  addWaypoint(type: WaypointType = 'Via', afterId?: string): void {
    const id = crypto.randomUUID();
    const wp: WaypointModel = {
      id,
      position: [0, 0, 0],
      orientation: [1, 0, 0, 0],
      joints: [],
      type,
    };
    this.waypoints.update(list => {
      if (!afterId) return [...list, wp];
      const idx = list.findIndex(w => w.id === afterId);
      if (idx === -1) return [...list, wp];
      const next = [...list];
      next.splice(idx + 1, 0, wp);
      return next;
    });
    this.selectWaypoint(id);
  }

  /** Actualiza propiedades parciales de un waypoint por ID. */
  updateWaypoint(id: string, partial: Partial<WaypointModel>): void {
    this.waypoints.update(list =>
      list.map(wp => (wp.id === id ? { ...wp, ...partial } : wp)),
    );
  }

  /**
   * Elimina un waypoint por ID.
   * @returns false si la operación dejaría menos de 2 waypoints (viola mínimo Start + Goal).
   */
  removeWaypoint(id: string): boolean {
    let removed = false;
    this.waypoints.update(list => {
      if (list.length <= 2) {
        return list; // preserve minimum
      }
      removed = true;
      return list.filter(wp => wp.id !== id);
    });
    if (removed) {
      this.selectedWaypointId.update(curr => (curr === id ? null : curr));
    }
    return removed;
  }

  /** Reordena un waypoint de una posición a otra. */
  reorderWaypoint(fromIndex: number, toIndex: number): void {
    this.waypoints.update(list => {
      if (fromIndex < 0 || fromIndex >= list.length) return list;
      if (toIndex < 0 || toIndex >= list.length) return list;
      const next = [...list];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  /** Define el waypoint seleccionado (desde panel o 3D). */
  selectWaypoint(id: string | null): void {
    this.selectedWaypointId.set(id);
  }

  /** Actualiza la posición de un waypoint (desde DragControls en 3D). */
  updateWaypointPosition(id: string, position: [number, number, number]): void {
    this.waypoints.update(list =>
      list.map(wp => (wp.id === id ? { ...wp, position } : wp)),
    );
  }

  /** Reemplazo masivo de waypoints (ej: después de Preview). */
  setWaypoints(waypoints: WaypointModel[]): void {
    this.waypoints.set(waypoints);
  }

  // ── Plan methods ──

  /** Crea un plan capturando segments y waypoints actuales, lo agrega a la lista, lo selecciona y persiste. */
  createPlan(name?: string): PlanModel {
    const now = new Date().toISOString();
    const plan: PlanModel = {
      id: crypto.randomUUID(),
      name: name ?? `Plan ${this.plans().length + 1}`,
      segments: this.segments(),
      waypoints: this.waypoints(),
      createdAt: now,
      updatedAt: now,
    };
    this.plans.update(list => [...list, plan]);
    this.activePlanId.set(plan.id);
    this.saveToStorage();
    return plan;
  }

  /** Duplica un plan existente (deep clone) y lo agrega a la lista. */
  duplicatePlan(id: string): PlanModel | null {
    const source = this.plans().find(p => p.id === id);
    if (!source) return null;

    const now = new Date().toISOString();
    const clone = structuredClone(source);
    const copy: PlanModel = {
      ...clone,
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    this.plans.update(list => [...list, copy]);
    this.saveToStorage();
    return copy;
  }

  /** Renombra un plan y persiste. */
  renamePlan(id: string, name: string): void {
    this.plans.update(list =>
      list.map(p =>
        p.id === id ? { ...p, name, updatedAt: new Date().toISOString() } : p,
      ),
    );
    this.saveToStorage();
  }

  /** Elimina un plan de la lista y persiste. Si era el activo, limpia la selección. */
  deletePlan(id: string): void {
    this.plans.update(list => list.filter(p => p.id !== id));
    this.activePlanId.update(curr => (curr === id ? null : curr));
    this.saveToStorage();
  }

  /** Selecciona un plan como activo (no persiste — es estado de UI volátil). */
  selectPlan(id: string | null): void {
    this.activePlanId.set(id);
  }

  // ── Error methods ──

  /** Agrega un error de segmento a la lista. */
  setSegmentError(error: SegmentError): void {
    this.segmentErrors.update(list => [...list, error]);
  }

  /** Limpia todos los errores de segmento. */
  clearErrors(): void {
    this.segmentErrors.set([]);
  }

  // ── Persistence ──

  /** Persiste todos los planes y el activo en localStorage. */
  saveToStorage(): void {
    const state: PersistedState = {
      version: CURRENT_VERSION,
      plans: this.plans(),
      activePlanId: this.activePlanId(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full, unavailable, or SSR — silently ignore
    }
  }

  /** Carga planes desde localStorage al store. Se llama en el constructor. */
  loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const state: PersistedState = JSON.parse(raw);
      if (state && Array.isArray(state.plans)) {
        this.plans.set(state.plans);
        this.activePlanId.set(state.activePlanId ?? null);
      }
    } catch {
      // Corrupted or incompatible data — start fresh
    }
  }

  // ── Export / Import ──

  /**
   * Exporta un plan como Blob JSON descargable.
   * @returns Blob si el plan existe, null si no.
   */
  exportPlanJson(planId: string): Blob | null {
    const plan = this.plans().find(p => p.id === planId);
    if (!plan) return null;

    const json = JSON.stringify(plan, null, 2);
    return new Blob([json], { type: 'application/json' });
  }

  /**
   * Importa un plan desde un string JSON.
   * Valida la estructura mínima antes de agregarlo.
   * @returns El PlanModel importado, o null si falló la validación.
   */
  importPlanJson(jsonString: string): PlanModel | null {
    try {
      const parsed = JSON.parse(jsonString);

      // ── Validación mínima de estructura ──
      if (!parsed || typeof parsed !== 'object') return null;
      if (typeof parsed.id !== 'string' || !parsed.id) return null;
      if (typeof parsed.name !== 'string') return null;
      if (!Array.isArray(parsed.segments)) return null;
      if (!Array.isArray(parsed.waypoints)) return null;
      if (typeof parsed.createdAt !== 'string') return null;

      const now = new Date().toISOString();
      const plan: PlanModel = {
        id: parsed.id,
        name: parsed.name,
        segments: parsed.segments,
        waypoints: parsed.waypoints,
        createdAt: parsed.createdAt,
        updatedAt: now,
      };

      this.plans.update(list => [...list, plan]);
      this.activePlanId.set(plan.id);
      this.saveToStorage();
      return plan;
    } catch {
      return null;
    }
  }
}
