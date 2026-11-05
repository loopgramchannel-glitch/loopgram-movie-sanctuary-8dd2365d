import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// Old Videos page address: the video feed is now the home page.
export const Route = createFileRoute("/posts")({
  validateSearch: z.object({ c: z.string().max(40).optional() }),
  beforeLoad: ({ search }) => { throw redirect({ to: "/", search: search.c ? { c: search.c } : {}, statusCode: 301 }); },
});
