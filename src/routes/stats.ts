import { FastifyInstance } from "fastify";
import { connection } from "../rpc";
import { cacheGet, cacheSet } from "../cache";

interface StatsResponse {
  slot: number;
  blockTime: number;
  tps: number;
  totalTransactions: number;
  validatorCount: number;
  version: string;
  genesisHash: string;
  epoch: number;
  epochProgress: number;
}

export async function statsRoutes(app: FastifyInstance) {
  app.get("/stats", async (_req, reply) => {
    const cached = cacheGet<StatsResponse>("stats");
    if (cached) return reply.send(cached);

    try {
      const [slot, epochInfo, version, voteAccounts, perfSamples, genesisHash] =
        await Promise.all([
          connection.getSlot(),
          connection.getEpochInfo(),
          connection.getVersion(),
          connection.getVoteAccounts(),
          connection.getRecentPerformanceSamples(1),
          connection.getGenesisHash(),
        ]);

      const sample = perfSamples[0];
      const tps = sample
        ? Math.round(sample.numTransactions / sample.samplePeriodSecs)
        : 0;
      const blockTime = sample && sample.numSlots > 0
        ? Math.round((sample.samplePeriodSecs * 1000) / sample.numSlots)
        : 400;

      const totalValidators =
        voteAccounts.current.length + voteAccounts.delinquent.length;

      const epochProgress =
        epochInfo.slotsInEpoch > 0
          ? parseFloat((epochInfo.slotIndex / epochInfo.slotsInEpoch).toFixed(4))
          : 0;

      const stats: StatsResponse = {
        slot,
        blockTime,
        tps,
        totalTransactions: epochInfo.transactionCount ?? 0,
        validatorCount: totalValidators,
        version: version["solana-core"],
        genesisHash,
        epoch: epochInfo.epoch,
        epochProgress,
      };

      cacheSet("stats", stats);
      return reply.send(stats);
    } catch (err) {
      app.log.error(err, "Failed to fetch stats");
      return reply.status(500).send({ error: "Failed to fetch chain stats" });
    }
  });
}
