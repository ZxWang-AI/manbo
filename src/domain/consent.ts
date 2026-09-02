import { z } from "zod";

export const consentSnapshotSchema = z.strictObject({
  version: z.string().min(1),
  saveCase: z.boolean(),
  externalSharing: z.boolean(),
  confirmedFieldPaths: z.array(z.string().min(1)),
});

export type ConsentSnapshot = z.infer<typeof consentSnapshotSchema>;
