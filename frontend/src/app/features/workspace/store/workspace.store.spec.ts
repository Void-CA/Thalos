import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { WorkspaceStore } from './workspace.store';
import { WorkspaceApiService } from '../services/workspace-api.service';
import { of } from 'rxjs';
import type { WorkspaceDto } from '../workspace-api.types';

describe('WorkspaceStore', () => {
  let store: WorkspaceStore;
  let mockApi: WorkspaceApiService;
  let sampleSpy: ReturnType<typeof vi.fn>;
  let checkReachabilitySpy: ReturnType<typeof vi.fn>;
  let analyzeSingularitySpy: ReturnType<typeof vi.fn>;
  let analyzeManipulabilitySpy: ReturnType<typeof vi.fn>;

  const mockWorkspaceDto: WorkspaceDto = {
    metrics: {
      bounding_volume: 12.5,
      max_reach: 1.8,
      min_reach: 0.3,
      centroid: { x: 0, y: 0.5, z: 0 },
      sample_count: 100,
    },
    bounds: {
      min: { x: -1, y: -1, z: -1 },
      max: { x: 1, y: 1, z: 1 },
    },
    samples: [
      { q: [0, 0, 0, 0, 0, 0], position: { x: 0.5, y: 0, z: 0 } },
      { q: [0.1, 0, 0, 0, 0, 0], position: { x: 0.6, y: 0, z: 0 } },
    ],
  };

  beforeEach(() => {
    sampleSpy = vi.fn();
    checkReachabilitySpy = vi.fn();
    analyzeSingularitySpy = vi.fn();
    analyzeManipulabilitySpy = vi.fn();
    mockApi = {
      sample: sampleSpy,
      checkReachability: checkReachabilitySpy,
      analyzeSingularity: analyzeSingularitySpy,
      analyzeManipulability: analyzeManipulabilitySpy,
    } as unknown as WorkspaceApiService;

    TestBed.configureTestingModule({
      providers: [
        WorkspaceStore,
        { provide: WorkspaceApiService, useValue: mockApi },
      ],
    });

    store = TestBed.inject(WorkspaceStore);
  });

  describe('initial state', () => {
    it('should start with default values', () => {
      expect(store.data()).toBeNull();
      expect(store.pointCloud()).toBeNull();
      expect(store.showBaseCloud()).toBe(false);
      expect(store.reachability()).toBeNull();
      expect(store.singularity()).toBeNull();
      expect(store.manipulability()).toBeNull();
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.hasData()).toBe(false);
    });
  });

  describe('sample()', () => {
    it('should set loading->data state on success', async () => {
      sampleSpy.mockReturnValue(of(mockWorkspaceDto));

      const samplePromise = store.sample('robot-1', 100, 42, 0.01);

      // Should be loading immediately
      expect(store.loading()).toBe(true);
      expect(store.error()).toBeNull();

      await samplePromise;

      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.hasData()).toBe(true);
      expect(store.data()).not.toBeNull();
      expect(store.data()!.metrics.boundingVolume).toBe(12.5);
      expect(store.data()!.metrics.sampleCount).toBe(100);
      expect(store.data()!.metrics.centroid).toEqual([0, 0.5, 0]);
      expect(store.data()!.bounds.min).toEqual([-1, -1, -1]);
      expect(store.data()!.bounds.max).toEqual([1, 1, 1]);
    });

    it('should populate point cloud from sample positions', async () => {
      sampleSpy.mockReturnValue(of(mockWorkspaceDto));

      await store.sample('robot-1', 100, 42, 0.01);

      expect(store.pointCloud()).not.toBeNull();
      expect(store.pointCloud()).toHaveLength(2);
      expect(store.pointCloud()![0]).toEqual([0.5, 0, 0]);
      expect(store.pointCloud()![1]).toEqual([0.6, 0, 0]);
    });

    it('should set error state on API failure', async () => {
      sampleSpy.mockReturnValue(of(undefined));

      await store.sample('robot-1', 100, 42, 0.01);

      expect(store.loading()).toBe(false);
      expect(store.error()).toBe('Empty response');
      expect(store.data()).toBeNull();
      expect(store.hasData()).toBe(false);
    });

    it('should set error message from thrown errors', async () => {
      sampleSpy.mockImplementation(() => {
        throw new Error('Network failure');
      });

      await store.sample('robot-1', 100, 42, 0.01);

      expect(store.loading()).toBe(false);
      expect(store.error()).toBe('Network failure');
    });

    it('should use generic error message for non-Error throws', async () => {
      sampleSpy.mockReturnValue({
        toPromise: () => Promise.reject('string error'),
      });

      await store.sample('robot-1', 100, 42, 0.01);

      expect(store.loading()).toBe(false);
      expect(store.error()).toBe('Sampling failed');
    });

    it('should preserve previous data on failure and set error', async () => {
      // First successful sample
      sampleSpy.mockReturnValue(of(mockWorkspaceDto));
      await store.sample('robot-1', 100, 42, 0.01);
      expect(store.hasData()).toBe(true);

      // Second sample fails - data signal is NOT cleared by the store
      sampleSpy.mockReturnValue(of(undefined));
      await store.sample('robot-1', 100, 42, 0.01);
      expect(store.hasData()).toBe(true);
      expect(store.data()).not.toBeNull();
      expect(store.error()).toBe('Empty response');
    });
  });

  describe('reset()', () => {
    it('should clear all state signals', async () => {
      // Populate some data first
      sampleSpy.mockReturnValue(of(mockWorkspaceDto));
      await store.sample('robot-1', 100, 42, 0.01);
      store.setShowPointCloud(true);
      expect(store.hasData()).toBe(true);
      expect(store.showBaseCloud()).toBe(true);

      store.reset();

      expect(store.data()).toBeNull();
      expect(store.pointCloud()).toBeNull();
      expect(store.showBaseCloud()).toBe(false);
      expect(store.reachability()).toBeNull();
      expect(store.singularity()).toBeNull();
      expect(store.manipulability()).toBeNull();
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.hasData()).toBe(false);
    });
  });

  describe('setShowPointCloud()', () => {
    it('should toggle point cloud visibility', () => {
      expect(store.showBaseCloud()).toBe(false);
      store.setShowPointCloud(true);
      expect(store.showBaseCloud()).toBe(true);
      store.setShowPointCloud(false);
      expect(store.showBaseCloud()).toBe(false);
    });
  });
});
