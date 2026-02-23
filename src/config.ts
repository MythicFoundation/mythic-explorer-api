import dotenv from "dotenv";
dotenv.config();

export const config = {
  rpcUrl: process.env.L2_RPC_URL || "http://127.0.0.1:8899",
  port: parseInt(process.env.PORT || "4000", 10),
  cacheTtlMs: parseInt(process.env.CACHE_TTL_MS || "5000", 10),
  logLevel: process.env.LOG_LEVEL || "info",
  dbPath: process.env.DB_PATH || "./data/explorer-cache.db",
};

export const KNOWN_PROGRAMS: Record<string, string> = {
  MythBrdg11111111111111111111111111111111111: "Bridge L1",
  MythBrdgL2111111111111111111111111111111111: "Bridge L2",
  MythSwap1111111111111111111111111111111111: "MythicSwap AMM",
  HAqTmZbovDrPJP7Ry2httL9rL7hWE2GvJqjMUuxXfy1x: "MythicSwap AMM (deployed)",
  MythPad111111111111111111111111111111111111: "MythicPad Launchpad",
  "6JEsSV6shtnjDeyiNns3wXLDVxe9STiJVBW2yZQhKt5q": "MythicPad (deployed)",
  MythSett1ement11111111111111111111111111111: "Settlement",
  MythToken1111111111111111111111111111111111: "MYTH Token",
  MythCompute111111111111111111111111111111111: "Compute Market",
};
