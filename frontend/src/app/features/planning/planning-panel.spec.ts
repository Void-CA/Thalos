import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { PlanningPanel } from './planning-panel';
import { PlanningStore } from './planning.store';
import { PlanValidationService } from './services/plan-validation.service';
import { SceneApiService } from '../scene/services/scene-api.service';
import { SceneStore } from '../scene/store/scene.store';

describe('PlanningPanel — velocity pre-validation', () => {
  let fixture: ComponentFixture<PlanningPanel>;
  let component: PlanningPanel;
  let mockApi: { previewPlan: ReturnType<typeof vi.fn> };
  let planningStore: PlanningStore;

  beforeEach(async () => {
    localStorage.clear();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('1-a-b-c-d');

    // Mock RuntimeStateResponse-like object
    const mockApiResponse = {
      robot: {
        id: 'test_robot',
        display_name: 'Test Robot',
        dof: 6,
        joints: [
          { name: 'j1', kind: 'revolute', min: -6.283, max: 6.283 },
          { name: 'j2', kind: 'revolute', min: -6.283, max: 6.283 },
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
      generated_at: '2024-01-01T00:00:00Z',
    };

    mockApi = {
      previewPlan: vi.fn().mockReturnValue(of(mockApiResponse)),
    };

    const mockSceneStore = {
      state: vi.fn().mockReturnValue({
        data: null,
        runtime: {
          robot: { id: 'test_robot', display_name: 'Test Robot', dof: 6, joints: [] },
        },
        liveTransforms: [],
        execution: null,
        ikResult: null,
        solvedQ: null,
        ikTarget: null,
        activePlan: null,
        ui: { loading: false, error: null },
      }),
      applySnapshot: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [PlanningPanel],
      providers: [
        PlanningStore,
        PlanValidationService,
        { provide: SceneApiService, useValue: mockApi },
        { provide: SceneStore, useValue: mockSceneStore },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(PlanningPanel);
    component = fixture.componentInstance;
    planningStore = TestBed.inject(PlanningStore);
    fixture.detectChanges();
  });

  // ── Spec: Reject string velocity ──
  //
  //  Scenario: Reject string velocity
  //    GIVEN the velocity field contains "default"
  //    WHEN the user clicks "Preview"
  //    THEN the field shows a red border and "Velocity must be a number."

  it('should set error when velocity is string "default" and NOT call the API', () => {
    // Add a MoveJ segment
    component['addSegment']('movej');
    // Set its velocity to the non-numeric string "default"
    component['updateField'](0, 'velocityStr', 'default');

    component['previewPlan']();

    // API should NOT be called — pre-validation blocks it
    expect(mockApi.previewPlan).not.toHaveBeenCalled();

    // A segment error should be stored
    expect(planningStore.segmentErrors()).toHaveLength(1);
    expect(planningStore.segmentErrors()[0].category).toBe('velocity');
    expect(planningStore.segmentErrors()[0].message).toContain('Velocity must be a number');

    // The component error signal should show the message
    expect(component['error']()).not.toBeNull();
    expect(component['error']()!).toContain('Velocity must be a number');
  });

  // ── Spec: Accept numeric velocity ──
  //
  //  Scenario: Accept numeric velocity
  //    GIVEN the velocity field contains "0.5"
  //    WHEN the user clicks "Preview"
  //    THEN the request is sent with velocity 0.5 as a number

  it('should call the API when velocity is numeric string "0.5" and clear errors', () => {
    // Add a MoveJ segment
    component['addSegment']('movej');
    // Set its velocity to a valid number
    component['updateField'](0, 'velocityStr', '0.5');

    component['previewPlan']();

    // API should be called
    expect(mockApi.previewPlan).toHaveBeenCalledTimes(1);

    // No errors should be set
    expect(component['error']()).toBeNull();
    expect(planningStore.segmentErrors()).toEqual([]);
  });

  // ── Edge case: empty velocity (omitted, use defaults) ──

  it('should call the API when velocity is empty string (use backend default)', () => {
    component['addSegment']('movej');
    // velocityStr defaults to '' in createSegment — no user input
    component['previewPlan']();

    expect(mockApi.previewPlan).toHaveBeenCalledTimes(1);
    expect(component['error']()).toBeNull();
  });

  // ── Edge case: no segments at all ──

  it('should do nothing when no segments exist', () => {
    component['previewPlan']();
    expect(mockApi.previewPlan).not.toHaveBeenCalled();
    expect(component['error']()).toBeNull();
  });
});
