import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RobotDownloadPopup } from './robot-download-popup';
import type { RobotMetadataDto } from '../../robot-api.types';

describe('RobotDownloadPopup', () => {
  const mockRobot: RobotMetadataDto = {
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
  };

  it('should render model name, URDF badge, and placeholder size', () => {
    TestBed.configureTestingModule({
      providers: [RobotDownloadPopup],
    });

    const fixture = TestBed.createComponent(RobotDownloadPopup);
    fixture.componentRef.setInput('robot', mockRobot);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('Delta Robot');
    expect(el.textContent).toContain('URDF');
    expect(el.textContent).toContain('~12 KB');
  });

  it('should show "Próximamente" after download click', () => {
    TestBed.configureTestingModule({
      providers: [RobotDownloadPopup],
    });

    const fixture = TestBed.createComponent(RobotDownloadPopup);
    fixture.componentRef.setInput('robot', mockRobot);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const button = el.querySelector<HTMLButtonElement>('.download-action');

    expect(button).not.toBeNull();
    expect(el.textContent).not.toContain('Próximamente');

    button!.click();
    fixture.detectChanges();

    expect(el.textContent).toContain('Próximamente');
  });
});
