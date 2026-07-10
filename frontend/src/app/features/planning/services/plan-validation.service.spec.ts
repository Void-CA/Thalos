import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { PlanValidationService } from './plan-validation.service';

describe('PlanValidationService', () => {
  let service: PlanValidationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PlanValidationService],
    });
    service = TestBed.inject(PlanValidationService);
  });

  // ════════════════════════════════════════════════
  //  parse() — 422 error body parsing
  // ════════════════════════════════════════════════

  describe('parse()', () => {
    it('should return joint_limit category with actionable message', () => {
      const error = new HttpErrorResponse({
        status: 422,
        error: { error: 'joint_limit', joint: 'joint_1', value: -3.141, min: -3.14, max: 3.14 },
      });

      const result = service.parse(error);

      expect(result.category).toBe('joint_limit');
      expect(result.message).toContain('Joint 1');
      expect(result.message).toContain('-3.141 rad');
      expect(result.message).toContain('-3.14 to 3.14');
      expect(result.details).toEqual({
        joint: 'joint_1',
        value: -3.141,
        min: -3.14,
        max: 3.14,
      });
    });

    it('should return workspace category for out-of-reach errors', () => {
      const error = new HttpErrorResponse({
        status: 422,
        error: { error: 'workspace', target: [0.3, 0, 0] },
      });

      const result = service.parse(error);

      expect(result.category).toBe('workspace');
      expect(result.message).toContain('(0.3, 0, 0)');
      expect(result.message).toContain('out of reach');
    });

    it('should return collision category with segment numbers', () => {
      const error = new HttpErrorResponse({
        status: 422,
        error: { error: 'collision', segment_a: 1, segment_b: 2 },
      });

      const result = service.parse(error);

      expect(result.category).toBe('collision');
      expect(result.message).toContain('Segment 1');
      expect(result.message).toContain('Segment 2');
    });

    it('should return velocity category', () => {
      const error = new HttpErrorResponse({
        status: 422,
        error: { error: 'velocity', segment_index: 0 },
      });

      const result = service.parse(error);

      expect(result.category).toBe('velocity');
      expect(result.message).toContain('segment');
    });

    it('should return unknown category for unrecognised error type', () => {
      const error = new HttpErrorResponse({
        status: 422,
        error: { error: 'unknown_code', detail: 'something unexpected' },
      });

      const result = service.parse(error);

      expect(result.category).toBe('unknown');
      expect(result.message).toContain('Plan generation failed');
      expect(result.details).toBeDefined();
    });

    it('should return unknown category with fallback when body is missing', () => {
      const error = new HttpErrorResponse({ status: 422 });

      const result = service.parse(error);

      expect(result.category).toBe('unknown');
      expect(result.message).toContain('Plan generation failed');
    });

    it('should return unknown category for non-422 status (no body extraction)', () => {
      const error = new HttpErrorResponse({
        status: 500,
        error: { error: 'joint_limit', joint: 'joint_1', value: -3.141, min: -3.14, max: 3.14 },
      });

      const result = service.parse(error);

      expect(result.category).toBe('unknown');
    });

    it('should handle string error body gracefully', () => {
      const error = new HttpErrorResponse({ status: 422, error: 'string body' });

      const result = service.parse(error);

      expect(result.category).toBe('unknown');
      expect(result.message).toContain('Check segment values');
    });

    it('should extract multi-digit joint numbers correctly', () => {
      const error = new HttpErrorResponse({
        status: 422,
        error: { error: 'joint_limit', joint: 'joint_12', value: 5.0, min: -3.14, max: 3.14 },
      });

      const result = service.parse(error);

      expect(result.message).toContain('Joint 12');
    });
  });

  // ════════════════════════════════════════════════
  //  preValidateVelocity() — client-side velocity check
  // ════════════════════════════════════════════════

  describe('preValidateVelocity()', () => {
    it('should return null for valid numeric velocities', () => {
      const segments = [
        { velocityStr: '0.5' },
        { velocityStr: '1.0' },
      ];

      const result = service.preValidateVelocity(segments);

      expect(result).toBeNull();
    });

    it('should return SegmentError for non-numeric string "default"', () => {
      const segments = [
        { velocityStr: 'default' },
      ];

      const result = service.preValidateVelocity(segments);

      expect(result).not.toBeNull();
      expect(result!.category).toBe('velocity');
      expect(result!.message).toContain('Velocity must be a number');
      expect(result!.segmentIndex).toBe(0);
    });

    it('should return null for empty velocity string', () => {
      const segments = [
        { velocityStr: '' },
      ];

      const result = service.preValidateVelocity(segments);

      expect(result).toBeNull();
    });

    it('should return null for undefined velocity', () => {
      const segments = [
        {},
      ];

      const result = service.preValidateVelocity(segments);

      expect(result).toBeNull();
    });

    it('should return error for the first segment with bad velocity', () => {
      const segments = [
        { velocityStr: '0.5' },
        { velocityStr: 'invalid' },
        { velocityStr: '1.0' },
      ];

      const result = service.preValidateVelocity(segments);

      expect(result).not.toBeNull();
      expect(result!.segmentIndex).toBe(1);
    });

    it('should return null for null segment entries', () => {
      const segments = [null as unknown as Record<string, unknown>];

      const result = service.preValidateVelocity(segments);

      expect(result).toBeNull();
    });

    it('should return null for empty segment array', () => {
      const result = service.preValidateVelocity([]);
      expect(result).toBeNull();
    });
  });
});
