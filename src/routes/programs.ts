import { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";
import { KNOWN_PROGRAMS } from "../config";

interface ProgramInfo {
  address: string;
  name: string;
  txCount: number;
  deploySlot: number | null;
}

export async function programsRoutes(app: FastifyInstance) {
  app.get("/programs", async (_req, reply) => {
    const cached = cacheGet<ProgramInfo[]>("programs");
    if (cached) return reply.send(cached);

    try {
      const programs: ProgramInfo[] = [];

      for (const [address, name] of Object.entries(KNOWN_PROGRAMS)) {
        try {
          const pubkey = new PublicKey(address);
          const info = await connection.getAccountInfo(pubkey);

          if (info && info.executable) {
            // Try to get recent transaction count
            let txCount = 0;
            try {
              const sigs = await connection.getSignaturesForAddress(pubkey, {
                limit: 100,
              });
              txCount = sigs.length;
            } catch {
              // ignore
            }

            programs.push({
              address,
              name,
              txCount,
              deploySlot: null,
            });
          } else {
            // Program not deployed yet, still include it
            programs.push({
              address,
              name,
              txCount: 0,
              deploySlot: null,
            });
          }
        } catch {
          programs.push({
            address,
            name,
            txCount: 0,
            deploySlot: null,
          });
        }
      }

      cacheSet("programs", programs, 30_000);
      return reply.send(programs);
    } catch (err) {
      app.log.error(err, "Failed to fetch programs");
      return reply.status(500).send({ error: "Failed to fetch programs" });
    }
  });
}
