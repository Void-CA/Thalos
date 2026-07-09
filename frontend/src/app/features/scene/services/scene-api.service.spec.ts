import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { SceneApiService } from './scene-api.service';
import { API_BASE_URL } from '../../../shared/api/api-config';
import type { RuntimeStateResponse, SolveIKResponse } from '../scene-api.types';

describe('SceneApiService', () => {
  let service: SceneApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    service = TestBed.inject(SceneApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

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
    joints: [0, 0, 0, 0, 0, 0],
    scene: {
      frames: [],
      links: [],
      joint_axes: [],
      twists: [],
      primitives: [],
    },
    ik_result: null,
    active_plan: null,
    generated_at: '2024-06-15T10:00:00Z',
  };

  describe('setJoints()', () => {
    it('should POST to /scene/joints with joint_angles body', () => {
      const jointAngles = [0.5, -0.2, 0.1, 0, 0, 0];

      let result: RuntimeStateResponse | undefined;
      service.setJoints(jointAngles).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/scene/joints');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ joint_angles: jointAngles });
      req.flush(mockRuntimeResponse);
      expect(result).toEqual(mockRuntimeResponse);
    });
  });

  describe('loadRobot()', () => {
    it('should POST to /scene/robot with robot_id body', () => {
      const robotId = 'delta_robot';

      let result: RuntimeStateResponse | undefined;
      service.loadRobot(robotId).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/scene/robot');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ robot_id: robotId });
      req.flush(mockRuntimeResponse);
      expect(result).toEqual(mockRuntimeResponse);
    });
  });

  describe('error handling', () => {
    it('should return an HttpErrorResponse on server error (500)', () => {
      const jointAngles = [0, 0, 0, 0, 0, 0];

      let error: HttpErrorResponse | undefined;
      service.setJoints(jointAngles).subscribe({
        next: () => expect.fail('Expected an error, not a response'),
        error: (err: HttpErrorResponse) => {
          error = err;
        },
      });

      const req = httpMock.expectOne('/api/scene/joints');
      req.flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });

      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(error!.status).toBe(500);
      expect(error!.statusText).toBe('Internal Server Error');
    });
  });

  describe('getSceneState()', () => {
    it('should GET /scene', () => {
      let result: RuntimeStateResponse | undefined;
      service.getSceneState().subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/scene');
      expect(req.request.method).toBe('GET');
      req.flush(mockRuntimeResponse);
      expect(result).toEqual(mockRuntimeResponse);
    });
  });

  describe('moveToPosition()', () => {
    it('should POST to /scene/move-to-position', () => {
      const target: [number, number, number] = [0.5, 0.2, 0.3];

      let result: RuntimeStateResponse | undefined;
      service.moveToPosition(target).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/scene/move-to-position');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ target, frame_id: undefined });
      req.flush(mockRuntimeResponse);
      expect(result).toEqual(mockRuntimeResponse);
    });
  });

  describe('moveToPose()', () => {
    it('should POST to /scene/move-to-pose', () => {
      const target = {
        translation: [0.5, 0.2, 0.3] as [number, number, number],
        rotation: { kind: 'Quaternion' as const, value: { w: 1, x: 0, y: 0, z: 0 } },
      };

      let result: RuntimeStateResponse | undefined;
      service.moveToPose(target).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/scene/move-to-pose');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ target, frame_id: undefined });
      req.flush(mockRuntimeResponse);
      expect(result).toEqual(mockRuntimeResponse);
    });
  });

  describe('solveIkPosition()', () => {
    it('should POST to /scene/solve-ik-position', () => {
      const target: [number, number, number] = [0.5, 0.2, 0.3];
      const mockSolveResponse: SolveIKResponse = {
        joints: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        ik_result: { status: 'Converged', iterations: 5, final_error: 0.001 },
      };

      let result: SolveIKResponse | undefined;
      service.solveIkPosition(target).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/scene/solve-ik-position');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ target, frame_id: undefined });
      req.flush(mockSolveResponse);
      expect(result).toEqual(mockSolveResponse);
    });
  });

  describe('executeIk()', () => {
    it('should POST to /scene/execute-ik', () => {
      const joints = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];

      let result: RuntimeStateResponse | undefined;
      service.executeIk(joints).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/scene/execute-ik');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ joint_angles: joints });
      req.flush(mockRuntimeResponse);
      expect(result).toEqual(mockRuntimeResponse);
    });
  });

  describe('motion endpoints', () => {
    it('should POST to /motion/movej', () => {
      const target = [0, 0, 0, 0, 0, 0];

      let result: RuntimeStateResponse | undefined;
      service.moveJ(target).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/motion/movej');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ target });
      req.flush(mockRuntimeResponse);
      expect(result).toEqual(mockRuntimeResponse);
    });

    it('should POST to /motion/movel', () => {
      const target = {
        translation: [0.5, 0.2, 0.3] as [number, number, number],
        rotation: { kind: 'Quaternion' as const, value: { w: 1, x: 0, y: 0, z: 0 } },
      };

      let result: RuntimeStateResponse | undefined;
      service.moveL(target).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/motion/movel');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ target });
      req.flush(mockRuntimeResponse);
      expect(result).toEqual(mockRuntimeResponse);
    });
  });
});
