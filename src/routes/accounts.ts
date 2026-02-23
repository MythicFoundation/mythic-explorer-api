import { FastifyInstance } from "fastify";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";

export async function accountsRoutes(app: FastifyInstance) {
  app.get<{ Params: { address: string } }>(
    "/account/:address",
    async (req, reply) => {
      const { address } = req.params;

      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(address);
      } catch {
        return reply.status(400).send({ error: "Invalid address" });
      }

      const cacheKey = `account:${address}`;
      const cached = cacheGet<unknown>(cacheKey);
      if (cached) return reply.send(cached);

      try {
        const info = await connection.getAccountInfo(pubkey);
        if (!info) {
          return reply.status(404).send({ error: "Account not found" });
        }

        // Try to find token accounts
        let tokenAccounts: unknown[] = [];
        try {
          const tokenProgramId = new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          );
          const tokens = await connection.getTokenAccountsByOwner(pubkey, {
            programId: tokenProgramId,
          });
          tokenAccounts = tokens.value.map((ta) => ({
            address: ta.pubkey.toBase58(),
            lamports: ta.account.lamports,
          }));
        } catch {
          // Token program may not exist on L2
        }

        const result = {
          address,
          lamports: info.lamports,
          owner: info.owner.toBase58(),
          executable: info.executable,
          data: info.data.length > 1024
            ? `<${info.data.length} bytes>`
            : info.data.toString("base64"),
          tokenAccounts,
        };

        cacheSet(cacheKey, result);
        return reply.send(result);
      } catch (err) {
        app.log.error(err, "Failed to fetch account");
        return reply.status(500).send({ error: "Failed to fetch account" });
      }
    }
  );

  app.get<{
    Params: { address: string };
    Querystring: { limit?: string; before?: string };
  }>("/account/:address/transactions", async (req, reply) => {
    const { address } = req.params;
    const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
    const before = req.query.before || undefined;

    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(address);
    } catch {
      return reply.status(400).send({ error: "Invalid address" });
    }

    const cacheKey = `account-txs:${address}:${limit}:${before || "latest"}`;
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const sigs = await connection.getSignaturesForAddress(pubkey, {
        limit,
        before: before || undefined,
      });

      const txs = sigs.map((sig) => ({
        signature: sig.signature,
        slot: sig.slot,
        blockTime: sig.blockTime ?? null,
        status: sig.err ? "failed" : "success",
      }));

      cacheSet(cacheKey, txs);
      return reply.send(txs);
    } catch (err) {
      app.log.error(err, "Failed to fetch account transactions");
      return reply
        .status(500)
        .send({ error: "Failed to fetch account transactions" });
    }
  });
}
