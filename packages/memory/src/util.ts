import { randomUUID } from "node:crypto";

export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();
