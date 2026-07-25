import * as v from "valibot";

export const MessageSchema = v.object({
  message: v.pipe(v.string(), v.minLength(1)),
  model: v.optional(
    v.object({
      provider: v.string(),
      modelId: v.string(),
    }),
  ),
  thinkingLevel: v.optional(
    v.picklist(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
  ),
});

export const CwdSchema = v.object({
  cwd: v.pipe(v.string(), v.minLength(1)),
});

export const SessionPathSchema = v.object({
  sessionPath: v.pipe(v.string(), v.minLength(1)),
});

export const DirQuerySchema = v.object({
  path: v.pipe(v.string(), v.minLength(1)),
});

export const IntentSchema = v.picklist([
  "change-cwd",
  "switch-session",
  "new-session",
  "prompt",
  "steer",
  "follow-up",
  "abort",
]);
