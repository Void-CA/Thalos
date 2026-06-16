import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ModeStore } from './mode.store';

describe('ModeStore', () => {
  let store: ModeStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ModeStore],
    });
    store = TestBed.inject(ModeStore);
  });

  it('should start with analysis mode', () => {
    expect(store.mode()).toBe('analysis');
  });

  describe('setMode()', () => {
    it('should set mode to planning', () => {
      store.setMode('planning');
      expect(store.mode()).toBe('planning');
    });

    it('should set mode to execution', () => {
      store.setMode('execution');
      expect(store.mode()).toBe('execution');
    });

    it('should set mode back to analysis', () => {
      store.setMode('planning');
      store.setMode('analysis');
      expect(store.mode()).toBe('analysis');
    });
  });

  describe('toggle()', () => {
    it('should cycle from analysis to planning', () => {
      store.toggle();
      expect(store.mode()).toBe('planning');
    });

    it('should cycle from planning to execution', () => {
      store.setMode('planning');
      store.toggle();
      expect(store.mode()).toBe('execution');
    });

    it('should cycle from execution to analysis', () => {
      store.setMode('execution');
      store.toggle();
      expect(store.mode()).toBe('analysis');
    });

    it('should cycle through the full cycle: analysis → planning → execution → analysis', () => {
      expect(store.mode()).toBe('analysis');
      store.toggle();
      expect(store.mode()).toBe('planning');
      store.toggle();
      expect(store.mode()).toBe('execution');
      store.toggle();
      expect(store.mode()).toBe('analysis');
    });
  });
});
