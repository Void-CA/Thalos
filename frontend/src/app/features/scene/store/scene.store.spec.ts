import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { SceneStore } from './scene.store';
import { SceneApiService } from '../services/scene-api.service';
import { of, throwError } from 'rxjs';
import type { RuntimeStateResponse } from '../scene-api.types';
import type { SceneState } from '../scene.types';

describe('SceneStore', () => {
  let store: SceneStore;
  let mockApi: {
    setJoints: ReturnType<typeof vi.fn>;
    loadRobot: ReturnType<typeof vi.fn>;
    getSceneState: ReturnType<typeof vi.fn>;
    moveToPosition: ReturnType<typeof vi.fn>;
    moveToPose: ReturnType<typeof vi.fn>;
    solveIkPosition: ReturnType<typeof vi.fn>;
    solveIkPose: ReturnType<typeof vi.fn>;
    executeIk: ReturnType<typeof vi.fn>;
    moveJ: ReturnType<typeof vi.fn>;
    moveL: ReturnType<typeof vi.fn>;
  };

  const mockRuntimeResponse: RuntimeStateResponse = {
    robot: {
      id: 'delta_robot',
      display_name: 'Delta Robot',
      dof: 6,
      joints: [
        { name: 'shoulder_pan', kind: 'revolute', min: -6.283, max: 6.283 },
        { name: 'shoulder_lift', kind: 'revolute', min: -6.283, max: 6.283 },
        { name: 'elbow', kind: 'revolute', min: -6.283, max: 6.283 },
        { name: 'wrist_1', kind: 'revolute', min: -6.283, max: 6.283 },
        { name: 'wrist_2', kind: 'revolute', min: -6.283, max: 6.283 },
        { name: 'wrist_3', kind: 'revolute', min: -6.283, max: 6.283 },
      ],
    },
    joints: [0.5, -0.2, 0.1, 0, 0, 0],
    scene: {
      frames: [
        {
          id: 'base',
          parent: null,
          translation: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          style: null,
        },
      ],
      links: [
        { id: 0, start: [0, 0, 0], end: [0, 0.5, 0] },
      ],
      joint_axes: [
        { origin: [0, 0, 0], axis: [0, 0, 1] },
      ],
      twists: [
        { origin: [0, 0, 0], linear: [0, 0, 0], angular: [0, 0, 1] },
      ],
      primitives: [],
    },
    ik_result: null,
    active_plan: null,
    generated_at: '2024-06-15T10:00:00Z',
  };

  beforeEach(() => {
    mockApi = {
      setJoints: vi.fn(),
      loadRobot: vi.fn(),
      getSceneState: vi.fn(),
      moveToPosition: vi.fn(),
      moveToPose: vi.fn(),
      solveIkPosition: vi.fn(),
      solveIkPose: vi.fn(),
      executeIk: vi.fn(),
      moveJ: vi.fn(),
      moveL: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        SceneStore,
        { provide: SceneApiService, useValue: mockApi },
      ],
    });

    store = TestBed.inject(SceneStore);
  });

  describe('initial state', () => {
    it('should start with initial state values', () => {
      const state = store.state();
      expect(state.data).toBeNull();
      expect(state.runtime).toBeNull();
      expect(state.ikResult).toBeNull();
      expect(state.solvedQ).toBeNull();
      expect(state.ikTarget).toBeNull();
      expect(state.activePlan).toBeNull();
      expect(state.ui.loading).toBe(false);
      expect(state.ui.error).toBeNull();
    });
  });

  describe('updateTarget()', () => {
    it('should update ikTarget in state via direct mutation', async () => {
      const target = { type: 'position' as const, translation: [0.5, 0.2, 0.3] as [number, number, number] };

      // Wait for state$ to emit with the target
      const statePromise = firstValueFrom(
        store.state$.pipe(filter((s: SceneState) => s.ikTarget !== null)),
      );

      store.updateTarget(target);

      const state = await statePromise;
      expect(state.ikTarget).toEqual(target);
    });

    it('should set ikTarget to null', async () => {
      // Set a target first
      store.updateTarget({ type: 'position', translation: [0.5, 0.2, 0.3] });

      // Wait for state$ to emit with null target
      const statePromise = firstValueFrom(
        store.state$.pipe(filter((s: SceneState) => s.ikTarget === null)),
      );

      store.updateTarget(null);

      const state = await statePromise;
      expect(state.ikTarget).toBeNull();
    });
  });

  describe('setJointAngles()', () => {
    it('should call setJoints API and update state with loading->data flow', async () => {
      mockApi.setJoints.mockReturnValue(of(mockRuntimeResponse));

      const statePromise = firstValueFrom(
        store.state$.pipe(filter((s: SceneState) => s.runtime !== null && !s.ui.loading)),
      );

      store.setJointAngles([0.5, -0.2, 0.1, 0, 0, 0]);

      const state = await statePromise;
      expect(mockApi.setJoints).toHaveBeenCalledWith([0.5, -0.2, 0.1, 0, 0, 0]);
      expect(state.runtime).not.toBeNull();
      expect(state.runtime!.robot.id).toBe('delta_robot');
      expect(state.runtime!.joints).toEqual([0.5, -0.2, 0.1, 0, 0, 0]);
      expect(state.data).not.toBeNull();
      expect(state.data!.frames).toHaveLength(1);
      expect(state.data!.links).toHaveLength(1);
      expect(state.ui.loading).toBe(false);
      expect(state.ui.error).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      mockApi.setJoints.mockReturnValue(
        throwError(() => new Error('FK computation failed')),
      );

      const errorPromise = firstValueFrom(
        store.state$.pipe(filter((s: SceneState) => s.ui.error !== null)),
      );

      store.setJointAngles([1, 0, 0, 0, 0, 0]);

      const state = await errorPromise;
      expect(state.ui.error).toBe('FK computation failed');
      expect(state.ui.loading).toBe(false);
    });
  });

  describe('loadRobot()', () => {
    it('should call loadRobot API and update state with robot info', async () => {
      mockApi.loadRobot.mockReturnValue(of(mockRuntimeResponse));

      const statePromise = firstValueFrom(
        store.state$.pipe(filter((s: SceneState) => s.runtime !== null && !s.ui.loading)),
      );

      store.loadRobot('delta_robot');

      const state = await statePromise;
      expect(mockApi.loadRobot).toHaveBeenCalledWith('delta_robot');
      expect(state.runtime!.robot.id).toBe('delta_robot');
      expect(state.ui.loading).toBe(false);
      expect(state.ui.error).toBeNull();
    });

    it('should handle loadRobot API errors', async () => {
      mockApi.loadRobot.mockReturnValue(
        throwError(() => new Error('Robot not found')),
      );

      const errorPromise = firstValueFrom(
        store.state$.pipe(filter((s: SceneState) => s.ui.error !== null)),
      );

      store.loadRobot('nonexistent');

      const state = await errorPromise;
      expect(state.ui.error).toBe('Robot not found');
      expect(state.ui.loading).toBe(false);
    });
  });

  describe('applySnapshot()', () => {
    it('should apply an external state snapshot', async () => {
      const statePromise = firstValueFrom(
        store.state$.pipe(filter((s: SceneState) => s.runtime !== null && !s.ui.loading)),
      );

      store.applySnapshot(mockRuntimeResponse);

      const state = await statePromise;
      expect(state.runtime).not.toBeNull();
      expect(state.runtime!.robot.id).toBe('delta_robot');
      expect(state.data).not.toBeNull();
      expect(state.ui.loading).toBe(false);
      expect(state.ui.error).toBeNull();
    });
  });

  describe('signal reactivity', () => {
    it('should update state signal after setJointAngles API call', async () => {
      mockApi.setJoints.mockReturnValue(of(mockRuntimeResponse));

      const statePromise = firstValueFrom(
        store.state$.pipe(filter((s: SceneState) => s.runtime !== null && !s.ui.loading)),
      );

      store.setJointAngles([0, 0, 0, 0, 0, 0]);

      await statePromise;

      // The signal should reflect the latest state
      expect(store.state().runtime).not.toBeNull();
      expect(store.state().runtime!.robot.id).toBe('delta_robot');
    });
  });
});
