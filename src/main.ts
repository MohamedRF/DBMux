import { pino } from "pino";
import { loadConfig } from "./config/index.js";
import { Vault } from "./security/encryption.js";
import { Store } from "./storage/sqlite.js";
import { createApp } from "./server/http.js";
import { ConnectionManager } from "./database/manager.js";
import { Auth } from "./security/auth.js";
import { Gateway } from "./services/gateway.js";

const logger = pino({ redact: ["password", "token", "authorization", "key"] });
const config = loadConfig();
const store = new Store(config.DATA_DIR, new Vault(config.key));
const manager = new ConnectionManager(store, config);
const gateway = new Gateway(
  manager,
  new Auth(store),
  config.TRANSACTION_TIMEOUT_SECONDS,
  (id) => logger.error({ transactionId: id }, "Transaction cleanup failed"),
);
const server = createApp(gateway, config).listen(config.PORT, () =>
  logger.info({ port: config.PORT }, "DBMux listening"),
);
server.requestTimeout = 120000;
server.headersTimeout = 15000;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      logger.error("Shutdown deadline exceeded");
      process.exit(1);
    }, 30000);
    deadline.unref();
    server.close(() => {
      void gateway
        .close()
        .then(() => {
          store.close();
          clearTimeout(deadline);
          process.exit(0);
        })
        .catch(() => {
          logger.error("Shutdown cleanup failed");
          process.exit(1);
        });
    });
    server.closeIdleConnections();
  });
