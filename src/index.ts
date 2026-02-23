import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";
import { healthRoutes } from "./routes/health";
import { statsRoutes } from "./routes/stats";
import { slotsRoutes } from "./routes/slots";
import { transactionsRoutes } from "./routes/transactions";
import { accountsRoutes } from "./routes/accounts";
import { tokensRoutes } from "./routes/tokens";
import { programsRoutes } from "./routes/programs";
import { bridgeRoutes } from "./routes/bridge";

async function main() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  await app.register(cors, { origin: "*" });

  // Register routes
  await app.register(healthRoutes);
  await app.register(statsRoutes);
  await app.register(slotsRoutes);
  await app.register(transactionsRoutes);
  await app.register(accountsRoutes);
  await app.register(tokensRoutes);
  await app.register(programsRoutes);
  await app.register(bridgeRoutes);

  // Root redirect
  app.get("/", async (_req, reply) => {
    return reply.send({
      name: "Mythic L2 Explorer API",
      version: "1.0.0",
      endpoints: [
        "/health",
        "/stats",
        "/slots",
        "/slot/:slot",
        "/transactions",
        "/tx/:signature",
        "/account/:address",
        "/account/:address/transactions",
        "/tokens",
        "/token/:mint",
        "/programs",
        "/bridge/stats",
        "/bridge/transactions",
      ],
    });
  });

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`Mythic Explorer API listening on port ${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
