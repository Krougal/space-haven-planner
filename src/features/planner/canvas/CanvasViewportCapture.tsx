import { useEffect, useRef } from 'react'
import { CanvasViewport as BaseCanvasViewport } from './CanvasViewport'

/**
 * Bridge legacy mouse handlers across the canvas boundary.
 *
 * CanvasViewport intentionally works in tile coordinates that may become negative
 * for hull-edge structures whose exterior exclusion zones extend off-grid. Its
 * existing React mouse handlers stop receiving movement as soon as the pointer
 * leaves the canvas, though. This wrapper keeps forwarding an active mouse drag
 * back to that canvas until mouse-up so those negative coordinates are reachable.
 */
export function CanvasViewport() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let activeCanvas: HTMLCanvasElement | null = null
    let forwarding = false

    const forward = (type: 'mousemove' | 'mouseup', source: MouseEvent) => {
      if (!activeCanvas || forwarding) return

      forwarding = true
      activeCanvas.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          detail: source.detail,
          screenX: source.screenX,
          screenY: source.screenY,
          clientX: source.clientX,
          clientY: source.clientY,
          ctrlKey: source.ctrlKey,
          shiftKey: source.shiftKey,
          altKey: source.altKey,
          metaKey: source.metaKey,
          button: source.button,
          buttons: source.buttons,
          relatedTarget: source.relatedTarget,
        })
      )
      forwarding = false
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (forwarding || (event.button !== 0 && event.button !== 2)) return
      const target = event.target
      if (target instanceof HTMLCanvasElement && root.contains(target)) {
        activeCanvas = target
      }
    }

    const handleMouseOut = (event: MouseEvent) => {
      if (!activeCanvas || forwarding || event.target !== activeCanvas) return

      // CanvasViewport's onMouseLeave currently cancels the drag. Suppress only
      // this one boundary transition while a mouse button is still held.
      if (event.buttons !== 0) {
        event.stopImmediatePropagation()
      }
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!activeCanvas || forwarding || event.target === activeCanvas) return

      if (event.buttons === 0) {
        // Recover gracefully if mouse-up happened outside the browser window.
        forward('mouseup', event)
        activeCanvas = null
        return
      }

      forward('mousemove', event)
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (!activeCanvas || forwarding) return

      const canvas = activeCanvas
      if (event.target !== canvas) {
        forward('mouseup', event)
      }
      activeCanvas = null
    }

    const clearCapture = () => {
      activeCanvas = null
    }

    // Capture phase runs before React's delegated mouse event handling.
    window.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mouseout', handleMouseOut, true)
    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', handleMouseUp, true)
    window.addEventListener('blur', clearCapture)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('mouseout', handleMouseOut, true)
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
      window.removeEventListener('blur', clearCapture)
    }
  }, [])

  return (
    <div ref={rootRef} style={{ display: 'contents' }}>
      <BaseCanvasViewport />
    </div>
  )
}
