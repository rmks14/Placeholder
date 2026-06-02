import { z } from "zod";

export const roleSchema = z.enum(["viewer", "operator", "admin"]);

export const loginBodySchema = z
  .object({
    identifier: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(512),
  })
  .strict();

export const roleBodySchema = z.object({ role: roleSchema }).strict();

export const alertUpdateBodySchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const systemActionBodySchema = z
  .object({
    action: z.enum(["run-audit", "clear-cache", "maintenance-check"]),
  })
  .strict();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown) {
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
