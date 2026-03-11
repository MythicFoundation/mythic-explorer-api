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
      const cacheKey = `slots:${currentSlot}:${limit}`;

      const cached = cacheGet<SlotSummary[]>(cacheKey);
      if (cached) return reply.send(cached);

      // Get estimated block time from performance samples
      let msPerSlot = 400;
      try {
        const perfSamples = await connection.getRecentPerformanceSamples(1);
        const sample = perfSamples?.[0];
        if (sample?.numSlots > 0) {
          msPerSlot = (sample.samplePeriodSecs * 1000) / sample.numSlots;
        }
      } catch {}

      const nowSec = Math.floor(Date.now() / 1000);
      const realBlocks = new Map<number, SlotSummary>();

      // Try getBlock for a subset of slots (limit attempts to avoid timeout)
      const maxAttempts = Math.min(limit * 2, 40);
      for (let i = 0; i < maxAttempts && realBlocks.size < limit; i++) {
        const s = currentSlot - i;
        if (s < 0) break;
        try {
          const block = await connection.getBlock(s, {
            maxSupportedTransactionVersion: 0,
            transactionDetails: "full",
            rewards: false,
          });
          if (block) {
            realBlocks.set(s, {
              slot: s,
              blockTime: block.blockTime,
              txCount: block.transactions.length,
              leader: null,
              hash: block.blockhash,
            });
          }
        } catch {
          // Slot unavailable on Firedancer
        }
      }

      // Build final list: real blocks where available, synthetic otherwise
      const slots: SlotSummary[] = [];
      for (let i = 0; i < limit; i++) {
        const s = currentSlot - i;
        if (s < 0) break;
        const real = realBlocks.get(s);
        if (real) {
          slots.push(real);
        } else {
          slots.push({
            slot: s,
            blockTime: Math.floor(nowSec - (i * msPerSlot / 1000)),
            txCount: 0,
            leader: null,
            hash: "",
          });
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

      if (block) {
        const transactions = block.transactions.map((tx) => {
          const sig = tx.transaction.signatures[0];
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
      }

      // Firedancer fallback: return minimal slot info with estimated time
      const currentSlot = await connection.getSlot();
      if (slot <= currentSlot) {
        let msPerSlot = 400;
        try {
          const perfSamples = await connection.getRecentPerformanceSamples(1);
          const sample = perfSamples?.[0];
          if (sample?.numSlots > 0) {
            msPerSlot = (sample.samplePeriodSecs * 1000) / sample.numSlots;
          }
        } catch {}
        const nowSec = Math.floor(Date.now() / 1000);
        const estimatedBlockTime = Math.floor(nowSec - ((currentSlot - slot) * msPerSlot / 1000));

        const result = {
          slot,
          blockTime: estimatedBlockTime,
          transactions: [],
          parentSlot: slot > 0 ? slot - 1 : 0,
          blockhash: "",
        };
        cacheSet(cacheKey, result);
        return reply.send(result);
      }

      return reply.status(404).send({ error: "Slot not found or skipped" });
    } catch (err) {
      app.log.error(err, "Failed to fetch slot");
      return reply.status(500).send({ error: "Failed to fetch slot" });
    }
  });
}
