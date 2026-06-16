import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { WorkspaceApiService } from './workspace-api.service';
import { API_BASE_URL } from '../../../shared/api/api-config';
import type { WorkspaceDto } from '../workspace-api.types';

describe('WorkspaceApiService', () => {
  let service: WorkspaceApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
      ],
    });
    service = TestBed.inject(WorkspaceApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('sample()', () => {
    it('should POST to /workspace/sample with the correct body and URL', () => {
      const mockResponse: WorkspaceDto = {
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
          {
            q: [0, 0, 0, 0, 0, 0],
            position: { x: 0.5, y: 0, z: 0 },
          },
        ],
      };

      const reqBody = {
        robot_id: 'robot-1',
        samples: 100,
        seed: 42,
        tolerance: 0.01,
        include_samples: true,
      };

      let result: WorkspaceDto | undefined;
      service.sample(reqBody).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/workspace/sample');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(reqBody);
      expect(req.request.headers).toBeDefined();

      req.flush(mockResponse);
      expect(result).toEqual(mockResponse);
    });

    it('should handle query parameters correctly with minimal request body', () => {
      const mockResponse: WorkspaceDto = {
        metrics: {
          bounding_volume: 0,
          max_reach: 0,
          min_reach: 0,
          centroid: { x: 0, y: 0, z: 0 },
          sample_count: 0,
        },
        bounds: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 0, y: 0, z: 0 },
        },
      };

      const reqBody = { robot_id: 'robot-1', samples: 50, seed: 0, tolerance: 0.1, include_samples: false };

      let result: WorkspaceDto | undefined;
      service.sample(reqBody).subscribe(res => {
        result = res;
      });

      const req = httpMock.expectOne('/api/workspace/sample');
      expect(req.request.body).toEqual(reqBody);
      req.flush(mockResponse);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('other endpoints', () => {
    it('should POST to /workspace/reachability', () => {
      const mockResponse = { reachable: true, nearest_distance: 0.05 };

      service.checkReachability({ point: { x: 0, y: 0, z: 1 }, tolerance: 0.1 }).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/workspace/reachability');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ point: { x: 0, y: 0, z: 1 }, tolerance: 0.1 });
      req.flush(mockResponse);
    });

    it('should POST to /workspace/singularity', () => {
      const mockResponse = {
        metrics: {
          total_samples: 100,
          singular_count: 5,
          near_singular_count: 10,
          normal_count: 85,
          avg_condition_number: 0.5,
          min_condition_number: 0.1,
          max_condition_number: 0.9,
          avg_sigma_min: 0.8,
        },
      };

      service.analyzeSingularity({
        robot_id: 'robot-1',
        samples: 100,
        seed: 42,
        tolerance: 0.01,
        near_singular_condition_threshold: 0.1,
        include_samples: true,
      }).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/workspace/singularity');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });

    it('should POST to /workspace/manipulability', () => {
      const mockResponse = {
        metrics: {
          total_samples: 100,
          avg_yoshikawa: 0.5,
          min_yoshikawa: 0.1,
          max_yoshikawa: 0.9,
          avg_isotropy: 0.6,
          min_isotropy: 0.2,
          max_isotropy: 0.8,
        },
      };

      service.analyzeManipulability({
        robot_id: 'robot-1',
        samples: 100,
        seed: 42,
        tolerance: 0.01,
        include_samples: true,
      }).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/workspace/manipulability');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });
});
