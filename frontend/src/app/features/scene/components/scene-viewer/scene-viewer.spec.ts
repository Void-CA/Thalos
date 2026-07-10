import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SceneViewer } from './scene-viewer';
import { SceneStore } from '../../store/scene.store';
import { ThreeRendererService } from '../../services/three-renderer.service';
import { WorkspaceStore } from '../../../workspace/store/workspace.store';
import { ModeStore } from '../../../../shared/store/mode.store';

function createDropEvent(files: File[]): DragEvent {
  const dataTransfer = {
    files: files as unknown as FileList,
    items: [] as DataTransferItem[],
    types: [] as string[],
    getData: () => '',
    setData: () => {},
    clearData: () => {},
  };
  const event = new Event('drop', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event as DragEvent;
}

function createDragOverEvent(): DragEvent {
  const event = new Event('dragover', { bubbles: true });
  return event as DragEvent;
}

function createDragLeaveEvent(relatedTarget: EventTarget | null, currentTarget: EventTarget): DragEvent {
  const event = new Event('dragleave', { bubbles: true });
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
  Object.defineProperty(event, 'currentTarget', { value: currentTarget });
  return event as DragEvent;
}

describe('SceneViewer', () => {
  let fixture: ComponentFixture<SceneViewer>;
  let component: SceneViewer;
  let mockSceneStore: {
    state: ReturnType<typeof vi.fn>;
    loadRobotFromUrdf: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockSceneStore = {
      state: vi.fn().mockReturnValue({
        data: null,
        runtime: null,
        liveTransforms: [],
        execution: null,
        ikResult: null,
        solvedQ: null,
        ikTarget: null,
        activePlan: null,
        ui: { loading: false, error: null },
      }),
      loadRobotFromUrdf: vi.fn(),
    };

    const mockRenderer = {
      init: vi.fn(),
      registerOverlay: vi.fn(),
      applyScene: vi.fn(),
      fitToView: vi.fn(),
      syncTransforms: vi.fn(),
      clear: vi.fn(),
      clearBase: vi.fn(),
      clearManipulability: vi.fn(),
      clearSingularity: vi.fn(),
      showBase: vi.fn(),
      showManipulability: vi.fn(),
      showSingularity: vi.fn(),
      setBaseCloud: vi.fn(),
      setManipulabilityCloud: vi.fn(),
      setSingularityCloud: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SceneViewer],
      providers: [
        { provide: SceneStore, useValue: mockSceneStore },
        { provide: ThreeRendererService, useValue: mockRenderer },
        {
          provide: WorkspaceStore,
          useValue: {
            pointCloud: vi.fn().mockReturnValue(null),
            showBaseCloud: vi.fn().mockReturnValue(false),
            showManipulability: vi.fn().mockReturnValue(false),
            showSingularity: vi.fn().mockReturnValue(false),
            manipulability: vi.fn().mockReturnValue(null),
            singularity: vi.fn().mockReturnValue(null),
          },
        },
        { provide: ModeStore, useValue: { mode: vi.fn().mockReturnValue('analysis') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SceneViewer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('file validation', () => {
    function awaitFileReader(): Promise<void> {
      // FileReader.readAsText schedules an onload callback via macrotask.
      // Use a short delay to let the event loop process it.
      return new Promise(resolve => setTimeout(resolve, 10));
    }

    it('should call loadRobotFromUrdf when a .urdf file is dropped', async () => {
      const file = new File(['dummy'], 'robot.urdf', { type: 'text/xml' });
      const event = createDropEvent([file]);

      component['onDrop'](event);
      await awaitFileReader();

      expect(mockSceneStore.loadRobotFromUrdf).toHaveBeenCalledWith('dummy');
    });

    it('should call loadRobotFromUrdf when a .xml file is dropped', async () => {
      const file = new File(['content'], 'robot.xml', { type: 'text/xml' });
      const event = createDropEvent([file]);

      component['onDrop'](event);
      await awaitFileReader();

      expect(mockSceneStore.loadRobotFromUrdf).toHaveBeenCalledWith('content');
    });

    it('should set dropError when a .png file is dropped and NOT call store', () => {
      const file = new File(['fake'], 'image.png', { type: 'image/png' });
      const event = createDropEvent([file]);

      component['onDrop'](event);

      expect(component['dropError']()).toBe('Only .urdf/.xml files accepted');
      expect(mockSceneStore.loadRobotFromUrdf).not.toHaveBeenCalled();
    });

    it('should process only the first .urdf file from multiple files', async () => {
      const png = new File(['fake'], 'image.png', { type: 'image/png' });
      const urdf = new File(['content'], 'robot.urdf', { type: 'text/xml' });
      const event = createDropEvent([png, urdf]);

      component['onDrop'](event);
      await awaitFileReader();

      expect(mockSceneStore.loadRobotFromUrdf).toHaveBeenCalledWith('content');
    });

    it('should process the first .urdf when multiple valid files are dropped', async () => {
      const first = new File(['first'], 'a.urdf', { type: 'text/xml' });
      const second = new File(['second'], 'b.urdf', { type: 'text/xml' });
      const event = createDropEvent([first, second]);

      component['onDrop'](event);
      await awaitFileReader();

      expect(mockSceneStore.loadRobotFromUrdf).toHaveBeenCalledTimes(1);
      expect(mockSceneStore.loadRobotFromUrdf).toHaveBeenCalledWith('first');
    });
  });

  describe('drag visual feedback', () => {
    it('should set isDragOver on dragover and prevent default', () => {
      const event = createDragOverEvent();
      vi.spyOn(event, 'preventDefault');

      component['onDragOver'](event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component['isDragOver']()).toBe(true);
    });

    it('should clear isDragOver on dragleave when leaving the drop zone', () => {
      component['isDragOver'].set(true);

      const dropZone = document.createElement('div');
      const event = createDragLeaveEvent(null, dropZone);

      component['onDragLeave'](event);

      expect(component['isDragOver']()).toBe(false);
    });
  });

  describe('drop error auto-dismiss', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should clear dropError after 4 seconds', () => {
      const file = new File(['fake'], 'image.png', { type: 'image/png' });
      const event = createDropEvent([file]);

      component['onDrop'](event);

      expect(component['dropError']()).toBe('Only .urdf/.xml files accepted');

      vi.advanceTimersByTime(4000);

      expect(component['dropError']()).toBeNull();
    });
  });
});
