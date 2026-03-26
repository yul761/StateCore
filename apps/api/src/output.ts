import type { z } from "zod";

export function parseOutput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown
): z.infer<TSchema> {
  return schema.parse(value);
}
