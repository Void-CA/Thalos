import { describe, it, expect } from 'vitest';
import { toSceneData, toActivePlan } from './dto-to-model';
import type { VisualSceneDto, ActivePlanDto } from '../scene-api.types';

describe('dto-to-model', () => {
  describe('toSceneData', () => {
    it('should map frames with id, parent, translation, rotation, and nullable style', () => {
      const dto: VisualSceneDto = {
        frames: [
          {
            id: 'frame-1',
            parent: null,
            translation: [1, 2, 3] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
            style: null,
          },
          {
            id: 'frame-2',
            parent: 'frame-1',
            translation: [4, 5, 6] as [number, number, number],
            rotation: [0.707, 0, 0, 0.707] as [number, number, number, number],
            style: {
              axis_length: 0.2,
              axis_radius: 0.01,
              origin_radius: 0.02,
              show_labels: true,
              color_x: [1, 0, 0],
              color_y: [0, 1, 0],
              color_z: [0, 0, 1],
            },
          },
        ],
        links: [],
        joint_axes: [],
        twists: [],
        primitives: [],
      };

      const result = toSceneData(dto);

      expect(result.frames).toHaveLength(2);

      expect(result.frames[0].id).toBe('frame-1');
      expect(result.frames[0].parent).toBeNull();
      expect(result.frames[0].translation).toEqual([1, 2, 3]);
      expect(result.frames[0].rotation).toEqual([0, 0, 0, 1]);
      expect(result.frames[0].style).toBeNull();

      expect(result.frames[1].id).toBe('frame-2');
      expect(result.frames[1].parent).toBe('frame-1');
      expect(result.frames[1].translation).toEqual([4, 5, 6]);
      expect(result.frames[1].style).not.toBeNull();
      expect(result.frames[1].style!.axisLength).toBe(0.2);
      expect(result.frames[1].style!.showLabels).toBe(true);
    });

    it('should map links with id as string', () => {
      const dto: VisualSceneDto = {
        frames: [],
        links: [
          { id: 0, start: [0, 0, 0] as [number, number, number], end: [1, 0, 0] as [number, number, number] },
          { id: 1, start: [1, 0, 0] as [number, number, number], end: [2, 0, 0] as [number, number, number] },
        ],
        joint_axes: [],
        twists: [],
        primitives: [],
      };

      const result = toSceneData(dto);

      expect(result.links).toHaveLength(2);
      expect(result.links[0].id).toBe('0');
      expect(result.links[0].start).toEqual([0, 0, 0]);
      expect(result.links[0].end).toEqual([1, 0, 0]);
      expect(result.links[1].id).toBe('1');
    });

    it('should map jointAxes correctly', () => {
      const dto: VisualSceneDto = {
        frames: [],
        links: [],
        joint_axes: [
          { origin: [0, 0, 0] as [number, number, number], axis: [0, 0, 1] as [number, number, number] },
        ],
        twists: [],
        primitives: [],
      };

      const result = toSceneData(dto);
      expect(result.jointAxes).toHaveLength(1);
      expect(result.jointAxes[0].origin).toEqual([0, 0, 0]);
      expect(result.jointAxes[0].axis).toEqual([0, 0, 1]);
    });

    it('should map twists correctly', () => {
      const dto: VisualSceneDto = {
        frames: [],
        links: [],
        joint_axes: [],
        twists: [
          { origin: [0, 0, 0] as [number, number, number], linear: [1, 0, 0] as [number, number, number], angular: [0, 0, 1] as [number, number, number] },
        ],
        primitives: [],
      };

      const result = toSceneData(dto);
      expect(result.twists).toHaveLength(1);
      expect(result.twists[0].origin).toEqual([0, 0, 0]);
      expect(result.twists[0].linear).toEqual([1, 0, 0]);
      expect(result.twists[0].angular).toEqual([0, 0, 1]);
    });

    it('should map Cylinder geometry correctly', () => {
      const dto: VisualSceneDto = {
        frames: [],
        links: [],
        joint_axes: [],
        twists: [],
        primitives: [
          {
            id: 'cyl-1',
            frame_id: '',
            translation: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
            geometry: { Cylinder: { radius: 0.5, height: 2.0 } },
          },
        ],
      };

      const result = toSceneData(dto);
      expect(result.primitives[0].geometry).toEqual({
        type: 'cylinder',
        radius: 0.5,
        height: 2.0,
      });
    });

    it('should map Sphere geometry correctly', () => {
      const dto: VisualSceneDto = {
        frames: [],
        links: [],
        joint_axes: [],
        twists: [],
        primitives: [
          {
            id: 'sphere-1',
            frame_id: '',
            translation: [1, 2, 3] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
            geometry: { Sphere: { radius: 0.3 } },
          },
        ],
      };

      const result = toSceneData(dto);
      expect(result.primitives[0].geometry).toEqual({
        type: 'sphere',
        radius: 0.3,
      });
    });

    it('should map Box geometry correctly', () => {
      const dto: VisualSceneDto = {
        frames: [],
        links: [],
        joint_axes: [],
        twists: [],
        primitives: [
          {
            id: 'box-1',
            frame_id: '',
            translation: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0, 1] as [number, number, number, number],
            geometry: { Box: { width: 1, height: 2, depth: 3 } },
          },
        ],
      };

      const result = toSceneData(dto);
      expect(result.primitives[0].geometry).toEqual({
        type: 'box',
        width: 1,
        height: 2,
        depth: 3,
      });
    });

    it('should handle empty arrays in all collections', () => {
      const dto: VisualSceneDto = {
        frames: [],
        links: [],
        joint_axes: [],
        twists: [],
        primitives: [],
      };

      const result = toSceneData(dto);
      expect(result.frames).toEqual([]);
      expect(result.links).toEqual([]);
      expect(result.jointAxes).toEqual([]);
      expect(result.twists).toEqual([]);
      expect(result.primitives).toEqual([]);
    });
  });

  describe('toActivePlan', () => {
    it('should return null when dto is null', () => {
      expect(toActivePlan(null)).toBeNull();
    });

    it('should map all fields from a complete ActivePlanDto', () => {
      const dto: ActivePlanDto = {
        plan_id: 'plan-abc-123',
        state: 'in_progress',
        motion_type: 'movej',
        trajectory_progress: 0.45,
        visualization: null,
        created_at: '2024-06-15T10:00:00Z',
        started_at: '2024-06-15T10:00:05Z',
        completed_at: null,
      };

      const result = toActivePlan(dto);

      expect(result).not.toBeNull();
      expect(result!.planId).toBe('plan-abc-123');
      expect(result!.state).toBe('in_progress');
      expect(result!.motionType).toBe('movej');
      expect(result!.trajectoryProgress).toBe(0.45);
      expect(result!.visualization).toBeNull();
      expect(result!.createdAt).toBe('2024-06-15T10:00:00Z');
      expect(result!.startedAt).toBe('2024-06-15T10:00:05Z');
      expect(result!.completedAt).toBeNull();
    });

    it('should map visualization waypoints correctly', () => {
      const dto: ActivePlanDto = {
        plan_id: 'plan-2',
        state: 'completed',
        motion_type: 'movel',
        trajectory_progress: 1.0,
        visualization: {
          waypoints: [
            {
              position: [0, 0, 0],
              orientation: [0, 0, 0, 1],
              joints: [0, 0],
              timestamp: 0,
              waypoint_type: 'Start',
            },
            {
              position: [1, 1, 1],
              orientation: [0, 0, 0, 1],
              joints: [1, 1],
              timestamp: 1,
              waypoint_type: 'Goal',
            },
          ],
          motion_type: 'movel',
        },
        created_at: '2024-06-15T10:00:00Z',
        started_at: null,
        completed_at: '2024-06-15T10:01:00Z',
      };

      const result = toActivePlan(dto);
      expect(result!.visualization).not.toBeNull();
      expect(result!.visualization!.waypoints).toHaveLength(2);
      expect(result!.visualization!.waypoints[0].waypointType).toBe('Start');
      expect(result!.visualization!.waypoints[1].waypointType).toBe('Goal');
      expect(result!.visualization!.motionType).toBe('movel');
    });
  });
});
