import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { IkTargetOverlayService } from './ik-target-overlay.service';

describe('IkTargetOverlayService', () => {
  let service: IkTargetOverlayService;
  let scene: THREE.Scene;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IkTargetOverlayService);
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

    it('should create the gizmo meshes inside the group', () => {
      service.attach(scene);
      const group = scene.children[0] as THREE.Group;
      // sphere + ring + 3 axes = 5 meshes
      const meshes = group.children.filter(c => c instanceof THREE.Mesh);
      expect(meshes.length).toBe(5);
    });

    it('should start hidden', () => {
      service.attach(scene);
      expect(scene.children[0].visible).toBe(false);
    });
  });

  describe('setTarget', () => {
    it('should show the gizmo at the given position', () => {
      service.attach(scene);
      service.setTarget([1, 2, 3]);

      const group = scene.children[0] as THREE.Group;
      expect(group.visible).toBe(true);
      expect(group.position.x).toBe(1);
      expect(group.position.y).toBe(2);
      expect(group.position.z).toBe(3);
    });

    it('should set quaternion when provided', () => {
      service.attach(scene);
      service.setTarget([0, 0, 0], [1, 0, 0, 0]); // identity: w=1

      const group = scene.children[0] as THREE.Group;
      // Rust: [w, x, y, z] → Three.js: (x, y, z, w) handled inside setTarget
      expect(group.quaternion.x).toBe(0);
      expect(group.quaternion.y).toBe(0);
      expect(group.quaternion.z).toBe(0);
      expect(group.quaternion.w).toBe(1);
    });

    it('should reset quaternion to identity when not provided', () => {
      service.attach(scene);
      // Set a non-identity quaternion first
      service.setTarget([0, 0, 0], [0, 1, 0, 0]);
      // Then clear rotation — should reset to identity
      service.setTarget([0, 0, 0]);

      const group = scene.children[0] as THREE.Group;
      expect(group.quaternion.x).toBe(0);
      expect(group.quaternion.y).toBe(0);
      expect(group.quaternion.z).toBe(0);
      expect(group.quaternion.w).toBe(1);
    });
  });

  describe('clearTarget', () => {
    it('should hide the gizmo', () => {
      service.attach(scene);
      service.setTarget([1, 0, 0]);
      expect(scene.children[0].visible).toBe(true);

      service.clearTarget();
      expect(scene.children[0].visible).toBe(false);
    });

    it('should be safe to call when not attached', () => {
      expect(() => service.clearTarget()).not.toThrow();
    });

    it('should be safe to call when already hidden', () => {
      service.attach(scene);
      expect(() => service.clearTarget()).not.toThrow();
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
