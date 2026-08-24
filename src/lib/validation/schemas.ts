import { z } from 'zod'
import { validateHostAddress } from '#lib/validation/host-address'

/**
 * Host address: IPv4, IPv6 or a name. Validated for real, not just for its
 * character set: "192.168.1.300" and "192.168.1" look right and are useless.
 */
const hostAddress = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(253)
  .superRefine((value, ctx) => {
    const result = validateHostAddress(value)
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.reason })
    }
  })

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(64, 'At most 64 characters')
  .regex(/^[a-z0-9._-]+$/i, 'Only letters, digits, dot, hyphen and underscore')

export const passwordSchema = z
  .string()
  .min(12, 'At least 12 characters')
  .max(1024, 'At most 1024 characters')

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(1024),
})

const remoteUserSchema = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(64)
  .regex(/^[A-Za-z0-9._@\-]+$/, 'Invalid remote user')

/**
 * Alias of a Host block. Wildcards and spaces are rejected: the application
 * only ever writes blocks with a single literal pattern.
 */
export const aliasSchema = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(64, 'At most 64 characters')
  .regex(/^[A-Za-z0-9._-]+$/, 'Only letters, digits, dot, hyphen and underscore')

/** File name of a key inside the mounted directory. */
const identityFileSchema = z
  .string()
  .trim()
  .max(255)
  .regex(/^[A-Za-z0-9._/-]*$/, 'Invalid file name')
  .refine((value) => !value.split('/').includes('..'), 'Path not allowed')

export const hostCreateSchema = z.object({
  alias: aliasSchema,
  hostname: hostAddress,
  port: z.coerce.number().int().min(1).max(65535).default(22),
  user: remoteUserSchema,
  identityFile: identityFileSchema.optional(),
})

export const hostUpdateSchema = z.object({
  hostname: hostAddress.optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  user: remoteUserSchema.optional(),
  identityFile: identityFileSchema.optional(),
})

export const idSchema = z.uuid('Invalid identifier')

export const openSessionSchema = z.object({
  alias: aliasSchema,
  cols: z.coerce.number().int().min(20).max(500).default(80),
  rows: z.coerce.number().int().min(5).max(200).default(24),
  // These travel as far as the handshake. They are only stored when the user
  // ticks "remember" and the encrypted vault is unlocked.
  password: z.string().max(1024).optional(),
  passphrase: z.string().max(1024).optional(),
  remember: z.boolean().optional(),
})

// Messages the browser sends over the terminal WebSocket.
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(8192) }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(20).max(500),
    rows: z.number().int().min(5).max(200),
  }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('close') }),
])

export type LoginInput = z.infer<typeof loginSchema>
export type HostCreateInput = z.infer<typeof hostCreateSchema>
export type HostUpdateInput = z.infer<typeof hostUpdateSchema>
export type ClientMessage = z.infer<typeof clientMessageSchema>
