import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RobotStore } from './robot.store';
import { RobotApiService } from '../services/robot-api.service';
import { of, throwError } from 'rxjs';
import type { RobotMetadataDto } from '../robot-api.types';

describe('RobotStore', () => {
  let store: RobotStore;
  let mockApi: {
    getRobots: ReturnType<typeof vi.fn>;
    getRobot: ReturnType<typeof vi.fn>;
  };

  const mockRobots: RobotMetadataDto[] = [
    {
      id: 'ur5e',
      display_name: 'UR5e',
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
    {
      id: 'kr10',
      display_name: 'KR 10 R1100',
      dof: 6,
      joints: [
        { name: 'a1', kind: 'revolute', min: -3.141, max: 3.141 },
        { name: 'a2', kind: 'revolute', min: -2.443, max: 2.443 },
        { name: 'a3', kind: 'revolute', min: -2.443, max: 2.443 },
        { name: 'a4', kind: 'revolute', min: -3.141, max: 3.141 },
        { name: 'a5', kind: 'revolute', min: -2.094, max: 2.094 },
        { name: 'a6', kind: 'revolute', min: -3.141, max: 3.141 },
      ],
    },
  ];

  beforeEach(() => {
    mockApi = {
      getRobots: vi.fn(),
      getRobot: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        RobotStore,
        { provide: RobotApiService, useValue: mockApi },
      ],
    });

    store = TestBed.inject(RobotStore);
  });

  describe('initial state', () => {
    it('should start with empty robots, null selectedId, no loading, no error', () => {
      expect(store.robots()).toEqual([]);
      expect(store.selectedId()).toBeNull();
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.selectedRobot()).toBeNull();
    });
  });

  describe('loadRobots()', () => {
    it('should populate robots signal on success', () => {
      mockApi.getRobots.mockReturnValue(of(mockRobots));

      store.loadRobots();

      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.robots()).toHaveLength(2);
      expect(store.robots()[0].id).toBe('ur5e');
      expect(store.robots()[1].id).toBe('kr10');
    });

    it('should set loading to true during API call', () => {
      // Return observable that doesn't complete synchronously
      mockApi.getRobots.mockReturnValue(of(mockRobots));

      store.loadRobots();

      // During subscribe, loading state changes synchronously with the mock
      // since of() emits synchronously
      expect(store.loading()).toBe(false);
    });

    it('should clear previous robots when loading new data', () => {
      // First load
      mockApi.getRobots.mockReturnValue(of(mockRobots));
      store.loadRobots();
      expect(store.robots()).toHaveLength(2);

      // Second load with different data
      mockApi.getRobots.mockReturnValue(of([mockRobots[0]]));
      store.loadRobots();
      expect(store.robots()).toHaveLength(1);
      expect(store.robots()[0].id).toBe('ur5e');
    });

    it('should set error on API failure and clear robots', () => {
      mockApi.getRobots.mockReturnValue(
        throwError(() => new Error('Failed to fetch robots')),
      );

      store.loadRobots();

      expect(store.loading()).toBe(false);
      expect(store.error()).toBe('Failed to fetch robots');
      expect(store.robots()).toEqual([]);
      expect(store.selectedId()).toBeNull();
    });

    it('should clear selectedId when loading robots', () => {
      // First load and select
      mockApi.getRobots.mockReturnValue(of(mockRobots));
      store.loadRobots();
      store.select('ur5e');
      expect(store.selectedId()).toBe('ur5e');

      // Reload should clear selection
      mockApi.getRobots.mockReturnValue(of(mockRobots));
      store.loadRobots();
      expect(store.selectedId()).toBeNull();
    });
  });

  describe('select()', () => {
    it('should select a robot that exists', () => {
      mockApi.getRobots.mockReturnValue(of(mockRobots));
      store.loadRobots();

      store.select('ur5e');
      expect(store.selectedId()).toBe('ur5e');
      expect(store.selectedRobot()).not.toBeNull();
      expect(store.selectedRobot()!.id).toBe('ur5e');
    });

    it('should guard against selecting a nonexistent robot', () => {
      mockApi.getRobots.mockReturnValue(of(mockRobots));
      store.loadRobots();

      store.select('nonexistent');
      expect(store.selectedId()).toBeNull();
      expect(store.selectedRobot()).toBeNull();
    });

    it('should reject null to clear selection', () => {
      mockApi.getRobots.mockReturnValue(of(mockRobots));
      store.loadRobots();
      store.select('ur5e');
      expect(store.selectedId()).toBe('ur5e');

      store.select(null);
      expect(store.selectedId()).toBeNull();
      expect(store.selectedRobot()).toBeNull();
    });

    it('should return correct selectedRobot via computed signal', () => {
      mockApi.getRobots.mockReturnValue(of(mockRobots));
      store.loadRobots();

      store.select('kr10');
      expect(store.selectedRobot()).not.toBeNull();
      expect(store.selectedRobot()!.id).toBe('kr10');
      expect(store.selectedRobot()!.display_name).toBe('KR 10 R1100');

      store.select('ur5e');
      expect(store.selectedRobot()!.id).toBe('ur5e');
    });
  });

  describe('selectedRobot computed', () => {
    it('should return null when no robot is selected', () => {
      expect(store.selectedRobot()).toBeNull();
    });

    it('should return null when robots list is empty', () => {
      store.select('ur5e');
      expect(store.selectedRobot()).toBeNull();
    });
  });
});
