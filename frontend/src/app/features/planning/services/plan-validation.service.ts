import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { ErrorCategory, SegmentError, ValidationResult } from '../planning.types';

/**
 * Parse 422 error responses from /scene/motion/plan into actionable user-facing messages.
 *
 * The backend returns structured error bodies per failure category:
 * - joint_limit: { error: "joint_limit", joint: "joint_1", value: -3.141, min: -3.14, max: 3.14 }
 * - workspace:   { error: "workspace", target: [0.3, 0, 0] }
 * - collision:   { error: "collision", segment_a: 1, segment_b: 2 }
 * - velocity:    { error: "velocity", segment_index: 0 }
 * - unknown:     fallback for unrecognised format
 */
@Injectable({ providedIn: 'root' })
export class PlanValidationService {
  /**
   * Parse an HttpErrorResponse into a structured ValidationResult.
   * If the status is not 422 or the body is malformed, defaults to 'unknown'.
   */
  parse(error: HttpErrorResponse): ValidationResult {
    const body = this.extractBody(error);

    if (!body) {
      return this.unknownResult('Plan generation failed (422). Check segment values and try again.');
    }

    const errorType = body['error'] as string | undefined;

    switch (errorType) {
      case 'joint_limit':
        return this.parseJointLimit(body);
      case 'workspace':
        return this.parseWorkspace(body);
      case 'collision':
        return this.parseCollision(body);
      case 'velocity':
        return this.parseVelocity(body);
      default:
        return this.unknownResult(
          'Plan generation failed (422). Check segment values and try again.',
          body,
        );
    }
  }

  /**
   * Pre-validate velocity fields before sending a plan request.
   * Checks each segment's velocityStr value — if it is a non-empty string
   * that is NOT a valid number, returns a SegmentError for that segment.
   *
   * @returns SegmentError with category 'velocity' and the failing segment index,
   *          or null if all velocities are valid.
   */
  preValidateVelocity(segments: unknown[]): SegmentError | null {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as Record<string, unknown> | null;
      if (!seg || typeof seg !== 'object') continue;

      const velocityStr = seg['velocityStr'];
      if (typeof velocityStr === 'string' && velocityStr.trim().length > 0) {
        const numeric = Number(velocityStr);
        if (!isFinite(numeric)) {
          return {
            category: 'velocity' as ErrorCategory,
            message: `Velocity must be a number. Check segment ${i + 1}.`,
            segmentIndex: i,
          };
        }
      }
    }
    return null;
  }

  // ── Private helpers ──

  /** Safely extract the error body from an HttpErrorResponse. */
  private extractBody(error: HttpErrorResponse): Record<string, unknown> | null {
    if (error.status !== 422) return null;
    const body = error.error;
    if (!body || typeof body !== 'object') return null;
    return body as Record<string, unknown>;
  }

  /** Extract numeric joint index from strings like "joint_1", "joint_12". */
  private extractJointNumber(joint: string): string {
    const match = joint.match(/(\d+)$/);
    return match ? match[1] : joint;
  }

  private parseJointLimit(body: Record<string, unknown>): ValidationResult {
    const joint = String(body['joint'] ?? '');
    const jointNum = joint ? this.extractJointNumber(joint) : '?';
    const value = Number(body['value']);
    const min = Number(body['min']);
    const max = Number(body['max']);

    return {
      category: 'joint_limit',
      message: `Joint ${jointNum} at ${value} rad is outside limits (${min} to ${max}). Reduce angle and retry.`,
      segmentIndex: this.asOptionalNumber(body['segment_index']),
      details: { joint, value, min, max },
    };
  }

  private parseWorkspace(body: Record<string, unknown>): ValidationResult {
    const target = body['target'] as [number, number, number] | undefined;
    const posStr = target
      ? `(${target[0]}, ${target[1]}, ${target[2]})`
      : 'the target';

    return {
      category: 'workspace',
      message: `Target position ${posStr} is out of reach or in a singularity. Move the target closer to the robot base.`,
      segmentIndex: this.asOptionalNumber(body['segment_index']),
      details: { target },
    };
  }

  private parseCollision(body: Record<string, unknown>): ValidationResult {
    const segA = Number(body['segment_a']);
    const segB = Number(body['segment_b']);

    return {
      category: 'collision',
      message: `Collision detected between Segment ${segA} and Segment ${segB}. Adjust waypoints to avoid obstacles.`,
      segmentIndex: this.asOptionalNumber(body['segment_index']),
      details: { segment_a: segA, segment_b: segB },
    };
  }

  private parseVelocity(body: Record<string, unknown>): ValidationResult {
    const segN = this.asOptionalNumber(body['segment_index']);

    return {
      category: 'velocity',
      message: segN !== undefined
        ? `Velocity must be a number. Check segment ${segN}.`
        : 'Velocity must be a number. Check segment values.',
      segmentIndex: segN,
      details: {},
    };
  }

  private unknownResult(message: string, raw?: unknown): ValidationResult {
    return {
      category: 'unknown',
      message,
      details: raw ? { raw_error: raw } : {},
    };
  }

  /** Convert an unknown value to number | undefined, returning undefined for NaN. */
  private asOptionalNumber(val: unknown): number | undefined {
    if (typeof val !== 'number') return undefined;
    return isFinite(val) ? val : undefined;
  }
}
