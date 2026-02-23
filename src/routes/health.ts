import { FastifyInstance } from "fastify";
import { connection } from "../rpc";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async (_req, reply) => {
    try {
      const slot = await connection.getSlot();
      return reply.send({ status: "ok", slot, rpc: "connected" });
    } catch (err) {
      return reply.status(503).send({
        status: "error",
        slot: 0,
        rpc: "disconnected",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });
}
