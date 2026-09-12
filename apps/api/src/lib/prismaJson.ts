import type { Prisma } from '../../prisma/generated/client/index.js'

// Prisma's generated InputJsonValue type requires an index signature that plain
// TS interfaces (BoundingBox, our Record<string, unknown> metadata bags, etc) don't
// structurally satisfy, even though they're perfectly valid JSON at runtime. This
// cast is the narrow, intentional escape hatch for exactly that mismatch — never use
// it to smuggle a non-JSON-serializable value (Buffers, class instances, etc) into a
// Prisma Json field.
export function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue
}
