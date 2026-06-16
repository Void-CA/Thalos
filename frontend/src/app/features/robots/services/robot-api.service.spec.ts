import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { RobotApiService } from './robot-api.service';
import { API_BASE_URL } from '../../../shared/api/api-config';
import type { RobotMetadataDto } from '../robot-api.types';

describe('RobotApiService', () => {
  let service: RobotApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    service = TestBed.inject(RobotApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

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

  describe('getRobots()', () => {
    it('should GET /robots and return the robot list', () => {
      let result: RobotMetadataDto[] | undefined;
      service.getRobots().subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/robots');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers).toBeDefined();
      req.flush(mockRobots);
      expect(result).toEqual(mockRobots);
      expect(result).toHaveLength(2);
      expect(result![0].id).toBe('ur5e');
      expect(result![1].id).toBe('kr10');
    });

    it('should return an empty array when no robots exist', () => {
      let result: RobotMetadataDto[] | undefined;
      service.getRobots().subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/robots');
      req.flush([]);
      expect(result).toEqual([]);
    });
  });

  describe('getRobot(id)', () => {
    it('should GET /robots/:id with the correct URL parameter', () => {
      const robotId = 'ur5e';

      let result: RobotMetadataDto | undefined;
      service.getRobot(robotId).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/robots/ur5e');
      expect(req.request.method).toBe('GET');
      req.flush(mockRobots[0]);
      expect(result).toEqual(mockRobots[0]);
      expect(result!.id).toBe('ur5e');
    });

    it('should handle different robot IDs correctly', () => {
      const robotId = 'kr10';

      let result: RobotMetadataDto | undefined;
      service.getRobot(robotId).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/robots/kr10');
      expect(req.request.method).toBe('GET');
      req.flush(mockRobots[1]);
      expect(result!.id).toBe('kr10');
    });

    it('should handle 404 when robot not found', () => {
      service.getRobot('nonexistent').subscribe({
        next: () => expect.fail('Expected an error, not a response'),
        error: (err) => {
          expect(err.status).toBe(404);
        },
      });

      const req = httpMock.expectOne('/api/robots/nonexistent');
      req.flush('Not Found', { status: 404, statusText: 'Not Found' });
    });
  });
});
