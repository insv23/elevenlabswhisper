import path from "node:path";
import { environment } from "@raycast/api";

// Centralized paths used across the extension.
export const RECORDINGS_DIR = path.join(environment.supportPath, "Recordings");
