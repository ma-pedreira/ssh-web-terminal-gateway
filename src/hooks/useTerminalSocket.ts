'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type LinkState = 'connecting' | 'online' | 'suspended' | 'closed' | 'error'

interface Options {
  readonly sessionId: string
  readonly onOutput: (chunk: Uint8Array) => void
  readonly onNotice: (message: string) => void
}

interface Api {
  readonly state: LinkState
  readonly send: (data: string) => void
  readonly resize: (cols: number, rows: number) => void
  readonly close: () => void
}

/**
 * Link to the terminal gateway.
 * Binary frames are shell output; text frames are status events.
 */
export function useTerminalSocket({ sessionId, onOutput, onNotice }: Options): Api {
  const socketRef = useRef<WebSocket | null>(null)
  const [state, setState] = useState<LinkState>('connecting')

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(
      `${scheme}://${window.location.host}/api/terminal?session=${encodeURIComponent(sessionId)}`,
    )
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket

    socket.onopen = () => setState('online')

    socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (typeof event.data !== 'string') {
        onOutput(new Uint8Array(event.data))
        return
      }
      try {
        const payload = JSON.parse(event.data) as
          | { type: 'status'; status: string }
          | { type: 'error'; message: string }
          | { type: 'exit'; code: number | null }
          | { type: 'hostkey'; keyType: string; fingerprint: string }

        if (payload.type === 'status') {
          setState(payload.status === 'active' ? 'online' : 'suspended')
        } else if (payload.type === 'error') {
          setState('error')
          onNotice(payload.message)
        } else if (payload.type === 'hostkey') {
          onNotice(
            `First connection to this host: its key (${payload.keyType} ${payload.fingerprint}) ` +
              'was saved in known_hosts. Check it matches the server if you can.',
          )
        } else if (payload.type === 'exit') {
          setState('closed')
          onNotice(`The remote shell exited with code ${payload.code ?? 0}`)
        }
      } catch {
        // Unrecognised text frame: ignored.
      }
    }

    socket.onclose = (event) => {
      setState((current) => (current === 'error' ? current : 'closed'))
      if (event.reason) onNotice(event.reason)
    }

    socket.onerror = () => setState('error')

    return () => {
      socketRef.current = null
      // Closing the WebSocket does not close the SSH session: it suspends.
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }
  }, [sessionId, onOutput, onNotice])

  const post = useCallback((payload: unknown): void => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }, [])

  const send = useCallback((data: string) => post({ type: 'input', data }), [post])
  const resize = useCallback((cols: number, rows: number) => post({ type: 'resize', cols, rows }), [post])
  const close = useCallback(() => post({ type: 'close' }), [post])

  return { state, send, resize, close }
}
