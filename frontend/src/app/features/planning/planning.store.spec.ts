import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlanningStore } from './planning.store';
import type { WaypointModel } from './planning.types';

describe('PlanningStore', () => {
  let store: PlanningStore;
  let uuidCounter: number;

  beforeEach(() => {
    uuidCounter = 0;
    localStorage.clear();
    // crypto.randomUUID() returns a UUID-like type `${string}-${string}-${string}-${string}-${string}`.
    // Our mock satisfies this with exactly 4 hyphens.
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      const n = ++uuidCounter;
      return `${n}-a-b-c-d`;
    });
    TestBed.configureTestingModule({
      providers: [PlanningStore],
    });
    store = TestBed.inject(PlanningStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Initial state ──

  it('should start with default values', () => {
    expect(store.waypoints()).toEqual([]);
    expect(store.selectedWaypointId()).toBeNull();
    expect(store.plans()).toEqual([]);
    expect(store.activePlanId()).toBeNull();
    expect(store.segmentErrors()).toEqual([]);
  });

  // ════════════════════════════════════════════════
  //  3.1 & 3.3 — Waypoint CRUD
  // ════════════════════════════════════════════════

  describe('addWaypoint()', () => {
    it('should add a Via waypoint at end of list and select it', () => {
      store.addWaypoint();

      const wps = store.waypoints();
      expect(wps).toHaveLength(1);
      expect(wps[0].type).toBe('Via');
      expect(wps[0].position).toEqual([0, 0, 0]);
      expect(wps[0].orientation).toEqual([1, 0, 0, 0]);
      expect(wps[0].joints).toEqual([]);
      expect(store.selectedWaypointId()).toBe('1-a-b-c-d');
    });

    it('should accept a custom type', () => {
      store.addWaypoint('Goal');

      expect(store.waypoints()[0].type).toBe('Goal');
    });

    it('should insert after a specific waypoint when afterId is provided', () => {
      // IDs: 1, 2, 3
      store.addWaypoint('Start');
      store.addWaypoint('Goal');
      store.addWaypoint('Via', '1-a-b-c-d'); // insert after first

      const wps = store.waypoints();
      expect(wps).toHaveLength(3);
      expect(wps[0].id).toBe('1-a-b-c-d');
      expect(wps[1].id).toBe('3-a-b-c-d');
      expect(wps[2].id).toBe('2-a-b-c-d');
    });

    it('should select the newly added waypoint', () => {
      store.addWaypoint('Start');
      store.addWaypoint('Goal');

      expect(store.selectedWaypointId()).toBe('2-a-b-c-d');
    });
  });

  describe('updateWaypoint()', () => {
    it('should update partial properties of a waypoint', () => {
      store.addWaypoint(); // id: 1-a-b-c-d

      store.updateWaypoint('1-a-b-c-d', {
        position: [1, 2, 3] as [number, number, number],
      });

      const wp = store.waypoints()[0];
      expect(wp.position).toEqual([1, 2, 3]);
      expect(wp.type).toBe('Via'); // unchanged
    });
  });

  describe('removeWaypoint()', () => {
    beforeEach(() => {
      // IDs: 1, 2, 3
      store.addWaypoint();
      store.addWaypoint();
      store.addWaypoint();
    });

    it('should remove a waypoint and return true', () => {
      const removed = store.removeWaypoint('2-a-b-c-d');

      expect(removed).toBe(true);
      expect(store.waypoints()).toHaveLength(2);
      expect(store.waypoints().map(w => w.id)).toEqual([
        '1-a-b-c-d',
        '3-a-b-c-d',
      ]);
    });

    it('should deselect the removed waypoint if it was selected', () => {
      store.selectWaypoint('2-a-b-c-d');
      store.removeWaypoint('2-a-b-c-d');

      expect(store.selectedWaypointId()).toBeNull();
    });

    it('should return false and NOT remove when only 2 waypoints remain', () => {
      // Remove one: 3 → 2
      store.removeWaypoint('3-a-b-c-d');
      expect(store.waypoints()).toHaveLength(2);

      // Try to remove again — blocked
      const blocked = store.removeWaypoint('1-a-b-c-d');
      expect(blocked).toBe(false);
      expect(store.waypoints()).toHaveLength(2); // unchanged
    });
  });

  describe('reorderWaypoint()', () => {
    beforeEach(() => {
      // IDs: 1, 2, 3
      store.addWaypoint();
      store.addWaypoint();
      store.addWaypoint();
    });

    it('should move a waypoint from one index to another', () => {
      store.reorderWaypoint(0, 2);

      const wps = store.waypoints();
      expect(wps[0].id).toBe('2-a-b-c-d');
      expect(wps[1].id).toBe('3-a-b-c-d');
      expect(wps[2].id).toBe('1-a-b-c-d');
    });

    it('should be a no-op for out-of-range indices', () => {
      store.reorderWaypoint(-1, 5);
      expect(store.waypoints()).toHaveLength(3);
    });
  });

  describe('selectWaypoint()', () => {
    it('should update selectedWaypointId signal', () => {
      store.selectWaypoint('some-id');
      expect(store.selectedWaypointId()).toBe('some-id');

      store.selectWaypoint(null);
      expect(store.selectedWaypointId()).toBeNull();
    });
  });

  describe('updateWaypointPosition()', () => {
    it('should update only the position of a waypoint', () => {
      store.addWaypoint(); // id: 1-a-b-c-d

      store.updateWaypointPosition('1-a-b-c-d', [0.5, 0.2, 0.3]);

      expect(store.waypoints()[0].position).toEqual([0.5, 0.2, 0.3]);
      expect(store.waypoints()[0].type).toBe('Via'); // other fields unchanged
    });
  });

  describe('setWaypoints()', () => {
    it('should replace all waypoints', () => {
      store.addWaypoint();
      expect(store.waypoints()).toHaveLength(1);

      const newWps: WaypointModel[] = [
        {
          id: 'wp-a',
          position: [1, 0, 0],
          orientation: [1, 0, 0, 0],
          joints: [],
          type: 'Start',
        },
        {
          id: 'wp-b',
          position: [2, 0, 0],
          orientation: [1, 0, 0, 0],
          joints: [],
          type: 'Goal',
        },
      ];
      store.setWaypoints(newWps);

      expect(store.waypoints()).toHaveLength(2);
      expect(store.waypoints()[0].id).toBe('wp-a');
      expect(store.waypoints()[1].id).toBe('wp-b');
    });
  });

  // ════════════════════════════════════════════════
  //  3.1 & 3.4 — Plan management
  // ════════════════════════════════════════════════

  describe('createPlan()', () => {
    it('should create a plan with auto-generated name and select it', () => {
      const plan = store.createPlan();

      expect(plan.id).toBe('1-a-b-c-d');
      expect(plan.name).toBe('Plan 1');
      expect(plan.segments).toEqual([]);
      expect(plan.waypoints).toEqual([]);
      expect(typeof plan.createdAt).toBe('string');
      expect(typeof plan.updatedAt).toBe('string');
      expect(store.plans()).toHaveLength(1);
      expect(store.activePlanId()).toBe('1-a-b-c-d');
    });

    it('should create a plan with custom name', () => {
      const plan = store.createPlan('MyPlan');
      expect(plan.name).toBe('MyPlan');
    });

    it('should increment plan number for consecutive auto-named plans', () => {
      store.createPlan();
      const plan2 = store.createPlan();
      expect(plan2.name).toBe('Plan 2');
    });
  });

  describe('duplicatePlan()', () => {
    beforeEach(() => {
      store.createPlan('PickAndPlace'); // id: 1-a-b-c-d
    });

    it('should create a deep clone with (copy) suffix', () => {
      const copy = store.duplicatePlan('1-a-b-c-d');

      expect(copy).not.toBeNull();
      expect(copy!.id).toBe('2-a-b-c-d');
      expect(copy!.name).toBe('PickAndPlace (copy)');
      expect(store.plans()).toHaveLength(2);
    });

    it('should return null for non-existent plan', () => {
      const copy = store.duplicatePlan('nonexistent');
      expect(copy).toBeNull();
      expect(store.plans()).toHaveLength(1);
    });
  });

  describe('renamePlan()', () => {
    beforeEach(() => {
      store.createPlan('OldName'); // id: 1-a-b-c-d
    });

    it('should update the plan name', () => {
      store.renamePlan('1-a-b-c-d', 'NewName');

      const plan = store.plans().find(p => p.id === '1-a-b-c-d');
      expect(plan!.name).toBe('NewName');
      expect(plan!.updatedAt).toEqual(expect.any(String));
    });
  });

  describe('deletePlan()', () => {
    beforeEach(() => {
      store.createPlan('PlanOne'); // id: 1-a-b-c-d
      store.createPlan('PlanTwo'); // id: 2-a-b-c-d
    });

    it('should remove a plan from the list', () => {
      store.deletePlan('1-a-b-c-d');

      expect(store.plans()).toHaveLength(1);
      expect(store.plans()[0].id).toBe('2-a-b-c-d');
    });

    it('should clear activePlanId when deleting the active plan', () => {
      store.selectPlan('1-a-b-c-d');
      store.deletePlan('1-a-b-c-d');

      expect(store.activePlanId()).toBeNull();
    });
  });

  describe('selectPlan()', () => {
    it('should set activePlanId', () => {
      store.selectPlan('active');
      expect(store.activePlanId()).toBe('active');

      store.selectPlan(null);
      expect(store.activePlanId()).toBeNull();
    });
  });

  // ════════════════════════════════════════════════
  //  3.4 — Persistence (localStorage)
  // ════════════════════════════════════════════════

  describe('saveToStorage() / loadFromStorage()', () => {
    it('should persist plans to localStorage on createPlan', () => {
      store.createPlan('PersistentPlan'); // id: 1-a-b-c-d

      const raw = localStorage.getItem('thalos-plans');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.version).toBe(1);
      expect(parsed.plans).toHaveLength(1);
      expect(parsed.plans[0].name).toBe('PersistentPlan');
      expect(parsed.activePlanId).toBe('1-a-b-c-d');
    });

    it('should persist plan updates to localStorage on renamePlan', () => {
      store.createPlan('Original'); // id: 1-a-b-c-d
      store.renamePlan('1-a-b-c-d', 'Renamed');

      const parsed = JSON.parse(localStorage.getItem('thalos-plans')!);
      expect(parsed.plans[0].name).toBe('Renamed');
    });

    it('should persist deletions to localStorage', () => {
      store.createPlan('A'); // id: 1-a-b-c-d
      store.createPlan('B'); // id: 2-a-b-c-d
      store.deletePlan('1-a-b-c-d');

      const parsed = JSON.parse(localStorage.getItem('thalos-plans')!);
      expect(parsed.plans).toHaveLength(1);
      expect(parsed.plans[0].name).toBe('B');
    });

    it('should load plans from localStorage on store construction', () => {
      const savedPlan = {
        id: 'preloaded-id',
        name: 'Preloaded',
        segments: [],
        waypoints: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      localStorage.setItem(
        'thalos-plans',
        JSON.stringify({
          version: 1,
          plans: [savedPlan],
          activePlanId: 'preloaded-id',
        }),
      );

      // New store reads from localStorage on construction
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [PlanningStore] });
      const fresh = TestBed.inject(PlanningStore);

      expect(fresh.plans()).toHaveLength(1);
      expect(fresh.plans()[0].name).toBe('Preloaded');
      expect(fresh.activePlanId()).toBe('preloaded-id');
    });

    it('should handle corrupted localStorage gracefully', () => {
      localStorage.setItem('thalos-plans', 'not-valid-json');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [PlanningStore] });
      const fresh = TestBed.inject(PlanningStore);

      expect(fresh.plans()).toEqual([]);
      expect(fresh.activePlanId()).toBeNull();
    });
  });

  // ════════════════════════════════════════════════
  //  Export / Import
  // ════════════════════════════════════════════════

  describe('exportPlanJson()', () => {
    beforeEach(() => {
      store.createPlan('Exportable'); // id: 1-a-b-c-d
    });

    it('should return a Blob with correct content type for an existing plan', () => {
      const blob = store.exportPlanJson('1-a-b-c-d');
      expect(blob).not.toBeNull();
      expect(blob!.type).toBe('application/json');
    });

    it('should return null for a non-existent plan', () => {
      const blob = store.exportPlanJson('nonexistent');
      expect(blob).toBeNull();
    });
  });

  describe('importPlanJson()', () => {
    it('should import a valid plan JSON and select it', () => {
      const json = JSON.stringify({
        id: 'imported-1',
        name: 'ImportedPlan',
        segments: [],
        waypoints: [],
        createdAt: '2024-06-01T00:00:00Z',
      });

      const result = store.importPlanJson(json);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('ImportedPlan');
      expect(store.plans()).toHaveLength(1);
      expect(store.activePlanId()).toBe('imported-1');
      // Should also persist
      expect(localStorage.getItem('thalos-plans')).not.toBeNull();
    });

    it('should reject invalid JSON string', () => {
      const result = store.importPlanJson('not valid json');
      expect(result).toBeNull();
      expect(store.plans()).toEqual([]);
    });

    it('should reject JSON with missing id field', () => {
      const result = store.importPlanJson(
        JSON.stringify({
          name: 'NoID',
          segments: [],
          waypoints: [],
          createdAt: '2024-01-01T00:00:00Z',
        }),
      );
      expect(result).toBeNull();
    });

    it('should reject JSON with non-array segments', () => {
      const result = store.importPlanJson(
        JSON.stringify({
          id: 'bad',
          name: 'Bad',
          segments: 'not-array',
          waypoints: [],
          createdAt: '2024-01-01T00:00:00Z',
        }),
      );
      expect(result).toBeNull();
    });

    it('should reject JSON with missing waypoints', () => {
      const result = store.importPlanJson(
        JSON.stringify({
          id: 'bad',
          name: 'Bad',
          segments: [],
          createdAt: '2024-01-01T00:00:00Z',
        }),
      );
      expect(result).toBeNull();
    });
  });

  // ════════════════════════════════════════════════
  //  Segment errors
  // ════════════════════════════════════════════════

  describe('segment errors', () => {
    it('should add segment errors', () => {
      store.setSegmentError({
        category: 'velocity',
        message: 'Bad velocity',
        segmentIndex: 0,
      });
      expect(store.segmentErrors()).toHaveLength(1);
      expect(store.segmentErrors()[0].category).toBe('velocity');
    });

    it('should clear all segment errors', () => {
      store.setSegmentError({ category: 'joint_limit', message: 'Joint error' });
      store.clearErrors();
      expect(store.segmentErrors()).toEqual([]);
    });
  });
});
