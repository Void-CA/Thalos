/**
 * Vitest utilities for ECharts-in-jsdom tests (S2.5): a no-op 2D canvas
 * context, forced element dimensions (jsdom does no layout), and a
 * ResizeObserver stub. ECharts only touches the DOM at init/resize, so a
 * `getContext('2d')` that answers every method call is enough to mount a real
 * ECharts instance and exercise the wrapper lifecycle.
 */

type Ctx2D = Record<string, unknown>

interface GradientLike {
  addColorStop: () => void
}

function create2DContext(): Ctx2D {
  const gradient: GradientLike = { addColorStop: () => {} }
  const base: Ctx2D = {
    measureText: (text: string) => ({
      width: String(text).length * 7,
      actualBoundingBoxAscent: 7,
      actualBoundingBoxDescent: 0,
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }),
    putImageData: () => {},
    drawImage: () => {},
  }
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return Reflect.get(target, prop)
      if (typeof prop === 'string') return () => {}
      return undefined
    },
    set(target, prop, value) {
      target[prop as string] = value
      return true
    },
  })
}

/** The most recently created ResizeObserver mock — lets tests fire resize
 *  callbacks on the observer the wrapper registered. */
let lastResizeObserver: { observed: Element[]; fire: () => void } | null = null

export function lastResizeObserverMock() {
  return lastResizeObserver
}

/** Installs canvas + layout + ResizeObserver shims for jsdom tests. */
export function installCanvasMock(): void {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: function getContext(this: HTMLCanvasElement, kind: string) {
      return kind === '2d' ? create2DContext() : null
    },
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value: () => 'data:image/png;base64,AAAA',
  })
  // jsdom performs no layout: force a container size so ECharts does not
  // render at 0x0 (which it treats as "can't get DOM size").
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 640,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 320,
  })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 640,
      bottom: 320,
      width: 640,
      height: 320,
      toJSON: () => ({}),
    }),
  })
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverMock {
      observed: Element[] = []
      private readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        lastResizeObserver = this as unknown as { observed: Element[]; fire: () => void }
      }
      observe(el: Element) {
        this.observed.push(el)
      }
      unobserve() {}
      disconnect() {
        this.observed = []
      }
      fire() {
        this.callback(
          this.observed.map(
            (el) => ({ target: el, contentRect: el.getBoundingClientRect() }) as ResizeObserverEntry,
          ),
          this as unknown as ResizeObserver,
        )
      }
    }
    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
  }
}
