import { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";

const BRIDGE_L2 = new PublicKey(
  "MythBrdgL2111111111111111111111111111111111"
);

interface BridgeStats {
  totalLocked: { SOL: number; MYTH: number; USDC: number };
  totalBridged24h: number;
  pendingWithdrawals: number;
}

interface BridgeTx {
  type: "deposit" | "withdrawal";
  asset: string;
  amount: number;
  status: string;
  l1Tx: string | null;
  l2Tx: string;
  timestamp: number | null;
}

export async function bridgeRoutes(app: FastifyInstance) {
  app.get("/bridge/stats", async (_req, reply) => {
    const cached = cacheGet<BridgeStats>("bridge:stats");
    if (cached) return reply.send(cached);

    try {
      // Get bridge program accounts to compute locked values
      let totalLocked = { SOL: 0, MYTH: 0, USDC: 0 };
      let pendingWithdrawals = 0;

      try {
        const bridgeAccounts = await connection.getProgramAccounts(BRIDGE_L2);
        for (const acct of bridgeAccounts) {
          totalLocked.SOL += acct.account.lamports / 1e9;
        }
      } catch {
        // Bridge may not be deployed
      }

      // Count recent bridge transactions
      let totalBridged24h = 0;
      try {
        const sigs = await connection.getSignaturesForAddress(BRIDGE_L2, {
          limit: 100,
        });
        const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
        const recent = sigs.filter(
          (s) => s.blockTime && s.blockTime > oneDayAgo
        );
        totalBridged24h = recent.length;
      } catch {
        // ignore
      }

      const stats: BridgeStats = {
        totalLocked,
        totalBridged24h,
        pendingWithdrawals,
      };

      cacheSet("bridge:stats", stats);
      return reply.send(stats);
    } catch (err) {
      app.log.error(err, "Failed to fetch bridge stats");
      return reply.status(500).send({ error: "Failed to fetch bridge stats" });
    }
  });

  app.get<{
    Querystring: { limit?: string; before?: string };
  }>("/bridge/transactions", async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);

    const cacheKey = `bridge:txs:${limit}`;
    const cached = cacheGet<BridgeTx[]>(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const sigs = await connection.getSignaturesForAddress(BRIDGE_L2, {
        limit,
      });

      const txs: BridgeTx[] = sigs.map((sig) => ({
        type: "deposit" as const, // Would need to parse instruction data for real type
        asset: "SOL",
        amount: 0,
        status: sig.err ? "failed" : "confirmed",
        l1Tx: null,
        l2Tx: sig.signature,
        timestamp: sig.blockTime ?? null,
      }));

      cacheSet(cacheKey, txs);
      return reply.send(txs);
    } catch (err) {
      app.log.error(err, "Failed to fetch bridge transactions");
      return reply
        .status(500)
        .send({ error: "Failed to fetch bridge transactions" });
    }
  });
}
