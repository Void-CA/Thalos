import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { PointCloudOverlayService } from './point-cloud-overlay.service';

describe('PointCloudOverlayService', () => {
  let service: PointCloudOverlayService;
  let scene: THREE.Scene;

  const twoPoints: [number, number, number][] = [
    [0, 0, 0],
    [1, 1, 1],
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PointCloudOverlayService);
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

  describe('setPointCloud', () => {
    it('should add a THREE.Points mesh with the correct vertex count', () => {
      service.attach(scene);
      service.setPointCloud(twoPoints);

      const group = scene.children[0] as THREE.Group;
      const points = group.children.find(c => c instanceof THREE.Points) as THREE.Points;
      expect(points).toBeDefined();
      expect(points.geometry.attributes['position'].count).toBe(2);
    });

    it('should show the group', () => {
      service.attach(scene);
      service.setPointCloud(twoPoints);
      expect(scene.children[0].visible).toBe(true);
    });

    it('should clear previous cloud on re-call', () => {
      service.attach(scene);
      service.setPointCloud(twoPoints);
      const group = scene.children[0] as THREE.Group;
      expect(group.children.length).toBe(1);

      service.setPointCloud(twoPoints);
      // Still one Points object (old one disposed)
      expect(group.children.length).toBe(1);
    });
  });

  describe('setGradientPointCloud', () => {
    it('should add a THREE.Points with vertex colors', () => {
      service.attach(scene);
      service.setGradientPointCloud([
        { position: [0, 0, 0], normalized: 1.0 },
        { position: [1, 0, 0], normalized: 0.0 },
      ]);

      const group = scene.children[0] as THREE.Group;
      const points = group.children.find(c => c instanceof THREE.Points) as THREE.Points;
      expect(points).toBeDefined();
      expect(points.geometry.attributes['position'].count).toBe(2);
      expect(points.geometry.attributes['color']).toBeDefined();
    });

    it('should clamp normalized values to [0, 1]', () => {
      service.attach(scene);
      service.setGradientPointCloud([
        { position: [0, 0, 0], normalized: 2.0 },   // clamped to 1.0
        { position: [1, 0, 0], normalized: -0.5 },  // clamped to 0.0
      ]);

      const group = scene.children[0] as THREE.Group;
      const points = group.children.find(c => c instanceof THREE.Points) as THREE.Points;
      expect(points).toBeDefined();
      expect(points.geometry.attributes['position'].count).toBe(2);
    });
  });

  describe('setColoredPointCloud', () => {
    it('should add a THREE.Points with state-based colors', () => {
      service.attach(scene);
      service.setColoredPointCloud([
        { position: [0, 0, 0], state: 'normal' },
        { position: [1, 0, 0], state: 'singular' },
        { position: [2, 0, 0], state: 'near_singular' },
      ]);

      const group = scene.children[0] as THREE.Group;
      const points = group.children.find(c => c instanceof THREE.Points) as THREE.Points;
      expect(points).toBeDefined();
      expect(points.geometry.attributes['position'].count).toBe(3);
      expect(points.geometry.attributes['color']).toBeDefined();
    });
  });

  describe('hide', () => {
    it('should set group visibility to false without disposing', () => {
      service.attach(scene);
      service.setPointCloud(twoPoints);
      expect(scene.children[0].visible).toBe(true);

      service.hide();
      expect(scene.children[0].visible).toBe(false);

      // Points mesh still exists
      const group = scene.children[0] as THREE.Group;
      expect(group.children.length).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove the Points mesh and hide the group', () => {
      service.attach(scene);
      service.setPointCloud(twoPoints);

      service.clear();

      const group = scene.children[0] as THREE.Group;
      expect(group.children.length).toBe(0);
      expect(group.visible).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should remove the group from the scene', () => {
      service.attach(scene);
      expect(scene.children.length).toBe(1);
      service.dispose();
      expect(scene.children.length).toBe(0);
    });

    it('should be safe to call without attach', () => {
      expect(() => service.dispose()).not.toThrow();
    });
  });
});
