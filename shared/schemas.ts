import { z } from "zod";

export const PersonaSchema = z.enum(["friendly"]);

export const SegmentInSchema = z.object({
  tag: z.number().int().min(1).max(500),
  key: z.string().max(2000),
  hasNew: z.boolean(),
  announced: z.boolean(),
  vetoed: z.boolean(),
  memoryText: z.string().max(600).optional(),
});

export const ReminderInSchema = z.object({
  tag: z.number().int().min(1).max(500),
  key: z.string().max(2000),
  previousHints: z.array(z.string().max(600)).max(6),
});

export const CheckRequestSchema = z.object({
  image: z.string().max(3_000_000),
  segments: z.array(SegmentInSchema).min(1).max(80),
  crops: z
    .record(z.string(), z.string().max(1_500_000))
    .refine((c) => Object.keys(c).length <= 12, "too many crops"),
  lastIssue: z.string().max(600),
  persona: PersonaSchema,
  reminders: z.array(ReminderInSchema).max(12).optional(),
});

export type CheckRequestParsed = z.infer<typeof CheckRequestSchema>;

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(1500),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2500) }))
    .max(12),
  pdf: z.object({ name: z.string().max(200), data: z.string().max(3_700_000) }).optional(),
  canvas: z.string().max(1_000_000).optional(),
  focusPage: z.number().int().min(1).max(500).optional(),
  pageCount: z.number().int().min(1).max(500).optional(),
  persona: PersonaSchema,
});
export type ChatRequestParsed = z.infer<typeof ChatRequestSchema>;
