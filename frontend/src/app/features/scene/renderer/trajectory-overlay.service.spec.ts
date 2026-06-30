import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { TrajectoryOverlayService } from './trajectory-overlay.service';
import type { VisualWaypoint, SegmentInfo, WaypointType } from '../scene.types';

describe('TrajectoryOverlayService', () => {
  let service: TrajectoryOverlayService;
  let scene: THREE.Scene;

  const wp = (
    p: [number, number, number],
    t: WaypointType,
  ): VisualWaypoint => ({ position: p, orientation: [1, 0, 0, 0], joints: [], timestamp: 0, waypointType: t });

  const twoWaypoints = [wp([0, 0, 0], 'Start'), wp([1, 1, 1], 'Goal')];
  const fourWaypoints = [wp([0, 0, 0], 'Start'), wp([0.3, 0.3, 0.3], 'Via'), wp([0.7, 0.7, 0.7], 'Via'), wp([1, 1, 1], 'Goal')];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TrajectoryOverlayService);
    scene = new THREE.Scene();
  });

  afterEach(() => {
    service.dispose();
  });

  describe('attach', () => {
    it('should add a group to the scene', () => {
      expect(scene.children.length).toBe(0);
      service.attach(scene);
      expect(scene.children.length).toBe(1);
    });

    it('should be idempotent', () => {
      service.attach(scene);
      service.attach(scene);
      expect(scene.children.length).toBe(1);
    });
  });

  describe('syncTrajectory', () => {
    it('should create lines and markers for single motion', () => {
      service.attach(scene);
      service.syncTrajectory(twoWaypoints, 'movej');

      // The outer group + lines/markers inside
      expect(scene.children[0].children.length).toBe(1); // wrapper group

      // Trajectory was rendered: 1 line + 2 markers
      const wrapper = scene.children[0].children[0] as THREE.Group;
      const lines = wrapper.children.filter(c => c instanceof THREE.Line);
      const meshes = wrapper.children.filter(c => c instanceof THREE.Mesh);
      expect(lines.length).toBe(1);
      expect(meshes.length).toBe(2);
    });

    it('should color line by motion type (movej = orange, movel = cyan)', () => {
      service.attach(scene);
      service.syncTrajectory(twoWaypoints, 'movej');
      const wrapper1 = scene.children[0].children[0] as THREE.Group;
      const line1 = wrapper1.children.find(c => c instanceof THREE.Line)! as THREE.Line;
      const mat1 = line1.material as THREE.LineBasicMaterial;
      expect(mat1.color.getHex()).toBe(0xff8800);

      service.syncTrajectory(twoWaypoints, 'movel');
      const wrapper2 = scene.children[0].children[0] as THREE.Group;
      const line2 = wrapper2.children.find(c => c instanceof THREE.Line)! as THREE.Line;
      const mat2 = line2.material as THREE.LineBasicMaterial;
      expect(mat2.color.getHex()).toBe(0x33ccff);
    });

    it('should create multi-segment trajectory when segments are provided', () => {
      const segments: SegmentInfo[] = [
        { segmentIndex: 0, motionType: 'movej', waypointStart: 0, waypointEnd: 2, timeStart: 0, timeEnd: 1 },
        { segmentIndex: 1, motionType: 'movej', waypointStart: 2, waypointEnd: 4, timeStart: 1, timeEnd: 2 },
      ];

      service.attach(scene);
      service.syncTrajectory(fourWaypoints, 'movej', segments);

      const wrapper = scene.children[0].children[0] as THREE.Group;

      // 2 segments → 2 lines + 4 markers (2 per segment)
      const lines = wrapper.children.filter(c => c instanceof THREE.Line);
      const meshes = wrapper.children.filter(c => c instanceof THREE.Mesh);
      expect(lines.length).toBe(2);
      expect(meshes.length).toBe(4);
    });

    it('should do nothing with fewer than 2 waypoints', () => {
      service.attach(scene);
      service.syncTrajectory([twoWaypoints[0]]);
      expect(scene.children[0].children.length).toBe(0);
    });

    it('should clear previous trajectory on each call', () => {
      service.attach(scene);
      service.syncTrajectory(twoWaypoints, 'movej');
      const wrapper1 = scene.children[0].children[0];
      const childrenCount = wrapper1.children.length;

      // Re-sync with same data should clear and rebuild
      service.syncTrajectory(twoWaypoints, 'movej');
      const wrapper2 = scene.children[0].children[0];
      // Should have the same structure (1 line + 2 markers)
      expect(wrapper2.children.length).toBe(childrenCount);
    });
  });

  describe('clearTrajectory', () => {
    it('should remove the trajectory group from the scene', () => {
      service.attach(scene);
      service.syncTrajectory(twoWaypoints, 'movej');
      expect(scene.children[0].children.length).toBe(1);

      service.clearTrajectory();
      expect(scene.children[0].children.length).toBe(0);
    });

    it('should be safe to call when no trajectory exists', () => {
      service.attach(scene);
      expect(() => service.clearTrajectory()).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('should remove the overlay group from the scene', () => {
      service.attach(scene);
      expect(scene.children.length).toBe(1);
      service.dispose();
      expect(scene.children.length).toBe(0);
    });

    it('should clear trajectory during dispose', () => {
      service.attach(scene);
      service.syncTrajectory(twoWaypoints, 'movej');
      service.dispose();
      expect(scene.children.length).toBe(0);
    });
  });
});
