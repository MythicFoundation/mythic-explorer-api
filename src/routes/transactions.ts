import { FastifyInstance } from "fastify";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";

interface TxSummary {
  signature: string;
  slot: number;
  blockTime: number | null;
  status: string;
  fee: number;
  accounts: string[];
}

export async function transactionsRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { limit?: string; before?: string };
  }>("/transactions", async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const before = req.query.before || undefined;

    try {
      const cacheKey = `txs:${limit}:${before || "latest"}`;
      const cached = cacheGet<TxSummary[]>(cacheKey);
      if (cached) return reply.send(cached);

      // Get recent signatures from the current slot range
      const currentSlot = await connection.getSlot();
      const sigs = await connection.getSignaturesForAddress(
        // Use the vote account or system program to get recent txs
        (await connection.getVoteAccounts()).current[0]
          ? await (async () => {
              const { PublicKey } = await import("@solana/web3.js");
              return new PublicKey(
                (await connection.getVoteAccounts()).current[0].votePubkey
              );
            })()
          : await (async () => {
              const { PublicKey } = await import("@solana/web3.js");
              return new PublicKey("11111111111111111111111111111111");
            })(),
        {
          limit,
          before: before || undefined,
        }
      );

      const txs: TxSummary[] = sigs.map((sig) => ({
        signature: sig.signature,
        slot: sig.slot,
        blockTime: sig.blockTime ?? null,
        status: sig.err ? "failed" : "success",
        fee: 0,
        accounts: [],
      }));

      cacheSet(cacheKey, txs);
      return reply.send(txs);
    } catch (err) {
      app.log.error(err, "Failed to fetch transactions");
      return reply.status(500).send({ error: "Failed to fetch transactions" });
    }
  });

  app.get<{ Params: { signature: string } }>(
    "/tx/:signature",
    async (req, reply) => {
      const { signature } = req.params;

      const cacheKey = `tx:${signature}`;
      const cached = cacheGet<unknown>(cacheKey);
      if (cached) return reply.send(cached);

      try {
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx) {
          return reply.status(404).send({ error: "Transaction not found" });
        }

        const accounts = tx.transaction.message
          .getAccountKeys()
          .staticAccountKeys.map((k) => k.toBase58());

        const instructions = tx.transaction.message.compiledInstructions.map(
          (ix) => ({
            programId: accounts[ix.programIdIndex] || "unknown",
            accounts: ix.accountKeyIndexes.map((i) => accounts[i] || "unknown"),
            data: Buffer.from(ix.data).toString("base64"),
          })
        );

        const result = {
          signature,
          slot: tx.slot,
          blockTime: tx.blockTime,
          status: tx.meta?.err ? "failed" : "success",
          fee: tx.meta?.fee ?? 0,
          instructions,
          accounts,
          logs: tx.meta?.logMessages ?? [],
        };

        // Cache confirmed transactions longer (they won't change)
        cacheSet(cacheKey, result, 60_000);
        return reply.send(result);
      } catch (err) {
        app.log.error(err, "Failed to fetch transaction");
        return reply.status(500).send({ error: "Failed to fetch transaction" });
      }
    }
  );
}
