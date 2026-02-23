import { Connection } from "@solana/web3.js";
import { config } from "./config";

export const connection = new Connection(config.rpcUrl, "confirmed");

export async function rpcHealthy(): Promise<boolean> {
  try {
    await connection.getSlot();
    return true;
  } catch {
    return false;
  }
}
