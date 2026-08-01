import { z } from "zod";
const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
export const klinePayloadSchema = z.object({ e: z.literal("kline"), E: z.number().int(), s: z.string(), k: z.object({
  t: z.number().int(), T: z.number().int(), s: z.string(), i: z.string(), f: z.number().int(), L: z.number().int(),
  o: decimal, c: decimal, h: decimal, l: decimal, v: decimal, n: z.number().int().nonnegative(), x: z.boolean(),
  q: decimal, V: decimal, Q: decimal, B: z.string().optional(),
}) });
export const combinedKlineSchema = z.object({ stream: z.string(), data: klinePayloadSchema });
