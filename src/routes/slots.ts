import { FastifyInstance } from "fastify";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";

interface SlotSummary {
  slot: number;
  blockTime: number | null;
  txCount: number;
  leader: string | null;
  hash: string;
}

export async function slotsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { limit?: string; before?: string };
  }>("/slots", async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const beforeSlot = req.query.before
      ? parseInt(req.query.before, 10)
      : undefined;

    try {
      const currentSlot = beforeSlot ?? (await connection.getSlot());
      const startSlot = Math.max(0, currentSlot - limit + 1);
      const cacheKey = `slots:${startSlot}:${currentSlot}`;

      const cached = cacheGet<SlotSummary[]>(cacheKey);
      if (cached) return reply.send(cached);

      const slots: SlotSummary[] = [];

      for (let s = currentSlot; s >= startSlot && slots.length < limit; s--) {
        try {
          const block = await connection.getBlock(s, {
            maxSupportedTransactionVersion: 0,
            transactionDetails: "full",
            rewards: false,
          });
          if (block) {
            slots.push({
              slot: s,
              blockTime: block.blockTime,
              txCount: block.transactions.length,
              leader: null,
              hash: block.blockhash,
            });
          }
        } catch {
          // Slot may be skipped, continue
        }
      }

      cacheSet(cacheKey, slots);
      return reply.send(slots);
    } catch (err) {
      app.log.error(err, "Failed to fetch slots");
      return reply.status(500).send({ error: "Failed to fetch slots" });
    }
  });

  app.get<{ Params: { slot: string } }>("/slot/:slot", async (req, reply) => {
    const slot = parseInt(req.params.slot, 10);
    if (isNaN(slot)) {
      return reply.status(400).send({ error: "Invalid slot number" });
    }

    const cacheKey = `slot:${slot}`;
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const block = await connection.getBlock(slot, {
        maxSupportedTransactionVersion: 0,
        transactionDetails: "full",
        rewards: false,
      });

      if (!block) {
        return reply.status(404).send({ error: "Slot not found or skipped" });
      }

      const transactions = block.transactions.map((tx) => {
        const sig =
          tx.transaction.signatures[0];
        return {
          signature: sig,
          fee: tx.meta?.fee ?? 0,
          status: tx.meta?.err ? "failed" : "success",
          accounts: tx.transaction.message.getAccountKeys().staticAccountKeys.map(
            (k) => k.toBase58()
          ),
        };
      });

      const result = {
        slot,
        blockTime: block.blockTime,
        transactions,
        parentSlot: block.parentSlot,
        blockhash: block.blockhash,
      };

      cacheSet(cacheKey, result);
      return reply.send(result);
    } catch (err) {
      app.log.error(err, "Failed to fetch slot");
      return reply.status(500).send({ error: "Failed to fetch slot" });
    }
  });
}
