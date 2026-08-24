import { NextResponse } from 'next/server'
import type { ApiResponse } from '#types'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export function ok<T>(data: T, init: ResponseInit = {}): NextResponse<ApiResponse<T>> {
  return NextResponse.json<ApiResponse<T>>(
    { success: true, data },
    { ...init, headers: { ...NO_STORE, ...(init.headers ?? {}) } },
  )
}

export function fail(error: string, status = 400, init: ResponseInit = {}): NextResponse<ApiResponse<never>> {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error },
    { ...init, status, headers: { ...NO_STORE, ...(init.headers ?? {}) } },
  )
}

/** Error carrying an HTTP status, to abort a handler. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
