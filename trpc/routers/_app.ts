import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/trpc/init";

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => {
    return { ok: true };
  }),
  hello: publicProcedure
    .input(
      z.object({
        text: z.string().min(1).default("world"),
      }),
    )
    .query(({ input }) => {
      return {
        greeting: `hello ${input.text}`,
      };
    }),
});

export type AppRouter = typeof appRouter;
